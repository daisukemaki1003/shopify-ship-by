import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";

import prisma from "../../../db.server";
import { getShippingRates } from "../../shipping/server/shipping-rates.server";
import type { ShippingRateEntry } from "../../shipping/utils/shipping-rate-normalize";
import { parseTargetIds, collectUniqueProductIds } from "../utils/rules";
import { toFallbackProduct, FALLBACK_PRODUCT_TITLE } from "../utils/products";
import type {
  ProductRule,
  ProductRuleWithProducts,
  ProductSummary,
} from "../utils/rule-types";
import { RuleTargetType } from "@prisma/client";
import { toZoneKey } from "../utils/shipping-zones";
import {
  normalizeZoneRulePayload,
  type ZoneRulePayload,
} from "../utils/normalize-zone-rule";

// 配送エリアのルール詳細に必要なデータ
export type ZoneRuleDetailData = {
  zone: { key: string; name: string | null };
  rates: ShippingRateEntry[];
  base: { id: string; days: number } | null;
  productRules: ProductRuleWithProducts[];
  defaultLeadDays: number | null;
};

// 配列を指定サイズで分割するユーティリティ
const chunkArray = <T>(items: T[], size: number): T[][] => {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size));
  }
  return result;
};

// GraphQLから商品サマリーを取得し、IDをキーにMapで返す
export const fetchProductSummaries = async (
  admin: AdminApiContext,
  ids: string[],
): Promise<Map<string, ProductSummary>> => {
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
  const map = new Map<string, ProductSummary>();

  if (uniqueIds.length === 0) return map;

  const chunks = chunkArray(uniqueIds, 20);

  for (const chunk of chunks) {
    try {
      const response = await admin.graphql(
        `#graphql
        query ProductSummaries($ids: [ID!]!) {
          nodes(ids: $ids) {
            __typename
            ... on Product {
              id
              title
              featuredImage { url altText }
              images(first: 1) { nodes { url altText } }
            }
          }
        }
        `,
        { variables: { ids: chunk } },
      );

      const json = await response.json();
      const nodes = Array.isArray(json?.data?.nodes)
        ? (json.data.nodes as Array<{
            __typename?: string;
            id?: string;
            title?: string;
            featuredImage?: { url?: string | null } | null;
            images?: { nodes?: Array<{ url?: string | null }> | null } | null;
          }>)
        : [];

      nodes.forEach((node) => {
        if (!node || node.__typename !== "Product" || !node.id) return;

        const primaryImage =
          node.featuredImage?.url ?? node.images?.nodes?.[0]?.url ?? null;

        map.set(node.id, {
          id: String(node.id),
          title: node.title ?? FALLBACK_PRODUCT_TITLE,
          imageUrl: primaryImage ? String(primaryImage) : null,
        });
      });
    } catch (error) {
      console.error("Failed to fetch product summaries", error);
    }
  }

  return map;
};

const resolveZoneRates = async ({
  shopId,
  zoneKey,
}: {
  shopId: string;
  zoneKey: string;
}): Promise<{
  zoneKey: string;
  zoneName: string | null;
  rates: ShippingRateEntry[];
}> => {
  const rates = await getShippingRates(shopId);
  const ratesInZone = rates.filter(
    (rate) => toZoneKey(rate.zoneName) === zoneKey,
  );
  if (ratesInZone.length === 0) {
    throw new Response("Not found", { status: 404 });
  }
  return {
    zoneKey,
    zoneName: ratesInZone[0]?.zoneName ?? null,
    rates: ratesInZone,
  };
};

// 配送エリアに紐づくルール・商品情報を取得する
export const loadZoneRuleDetail = async ({
  shopId,
  zoneKey,
  admin,
}: {
  shopId: string;
  zoneKey: string;
  admin: AdminApiContext;
}): Promise<ZoneRuleDetailData> => {
  const { zoneName, rates } = await resolveZoneRates({ shopId, zoneKey });
  const rateIds = rates.map((rate) => rate.shippingRateId);

  const ruleLinks = await prisma.ruleShippingRate.findMany({
    where: {
      shopId,
      shippingRateId: { in: rateIds },
      shippingRateShopId: shopId,
    },
    include: { rule: true },
    orderBy: { createdAt: "desc" },
  });

  const rulesById = new Map<string, (typeof ruleLinks)[number]["rule"]>();
  ruleLinks.forEach((link) => {
    if (!link?.rule?.id) return;
    if (!rulesById.has(link.rule.id)) {
      rulesById.set(link.rule.id, link.rule);
    }
  });
  const rules = Array.from(rulesById.values());
  const setting = await prisma.shopSetting.findUnique({
    where: { shopId },
    select: { defaultLeadDays: true },
  });

  const baseRule = rules
    .filter((rule) => rule.targetType === RuleTargetType.all)
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0];

  const productRulePayloads: ProductRule[] = rules
    .filter((rule) => rule.targetType === RuleTargetType.product)
    .map((rule) => ({
      id: rule.id,
      productIds: parseTargetIds(rule.targetId),
      days: rule.days,
    }));

  const allProductIds = collectUniqueProductIds(productRulePayloads);

  const productSummaryMap =
    allProductIds.length > 0
      ? await fetchProductSummaries(admin, allProductIds)
      : new Map<string, ProductSummary>();

  const productRules: ProductRuleWithProducts[] = productRulePayloads.map(
    (rule) => ({
      ...rule,
      products: rule.productIds.map(
        (id) => productSummaryMap.get(id) ?? toFallbackProduct(id),
      ),
    }),
  );

  return {
    zone: { key: zoneKey, name: zoneName },
    rates,
    base: baseRule ? { id: baseRule.id, days: baseRule.days } : null,
    productRules,
    defaultLeadDays: setting?.defaultLeadDays ?? null,
  };
};

export { normalizeZoneRulePayload };
export type { ZoneRulePayload };

// 検証済みペイロードをDBへ保存する
export const persistZoneRulePayload = async ({
  shopId,
  zoneKey,
  baseId,
  baseDays,
  productRules,
}: {
  shopId: string;
  zoneKey: string;
  baseId: string | null;
  baseDays: number | null;
  productRules: ProductRule[];
}) => {
  const { rates } = await resolveZoneRates({ shopId, zoneKey });
  const rateIds = rates.map((rate) => rate.shippingRateId);
  const linkUniqueWhere = (ruleId: string, shippingRateId: string) => ({
    shopId_ruleId_shippingRateId: { shopId, ruleId, shippingRateId },
  });

  const ensureLinksForAllRates = async (ruleId: string) => {
    await prisma.$transaction(
      rateIds.map((shippingRateId) =>
        prisma.ruleShippingRate.upsert({
          where: linkUniqueWhere(ruleId, shippingRateId),
          update: {},
          create: {
            shopId,
            ruleId,
            shippingRateId,
            shippingRateShopId: shopId,
          },
        }),
      ),
    );
  };

  if (baseDays != null) {
    if (baseId) {
      await prisma.rule.updateMany({
        where: { id: baseId, shopId },
        data: { days: baseDays },
      });
      await ensureLinksForAllRates(baseId);
    } else {
      const created = await prisma.rule.create({
        data: {
          shopId,
          targetType: "all",
          targetId: null,
          days: baseDays,
        },
      });

      await ensureLinksForAllRates(created.id);
    }
  } else if (baseId) {
    await prisma.ruleShippingRate.deleteMany({
      where: {
        shopId,
        shippingRateShopId: shopId,
        shippingRateId: { in: rateIds },
        ruleId: baseId,
      },
    });

    const remaining = await prisma.ruleShippingRate.findFirst({
      where: { shopId, ruleId: baseId },
      select: { ruleId: true },
    });
    if (!remaining) {
      await prisma.rule.deleteMany({ where: { shopId, id: baseId } });
    }
  }

  const incomingIds = new Set(
    productRules.map((r) => r.id).filter(Boolean) as string[],
  );

  // 配送エリアに紐づく削除対象の商品別ルールを洗い出し
  const existingProductRuleLinks = await prisma.ruleShippingRate.findMany({
    where: {
      shopId,
      shippingRateId: { in: rateIds },
      shippingRateShopId: shopId,
      rule: { targetType: RuleTargetType.product },
    },
    select: { ruleId: true },
  });

  const deleteIds = existingProductRuleLinks
    .map((link) => link.ruleId)
    .filter((id) => !incomingIds.has(id));

  if (deleteIds.length > 0) {
    await prisma.ruleShippingRate.deleteMany({
      where: {
        shopId,
        shippingRateId: { in: rateIds },
        shippingRateShopId: shopId,
        ruleId: { in: deleteIds },
      },
    });

    const externalLinks = await prisma.ruleShippingRate.findMany({
      where: {
        shopId,
        ruleId: { in: deleteIds },
        shippingRateId: { notIn: rateIds },
      },
      select: { ruleId: true },
    });
    const externalRuleIds = new Set(externalLinks.map((link) => link.ruleId));
    const safeToDelete = deleteIds.filter((id) => !externalRuleIds.has(id));
    if (safeToDelete.length > 0) {
      await prisma.rule.deleteMany({
        where: { shopId, id: { in: safeToDelete } },
      });
    }
  }

  // 商品別ルールをUpsert
  for (const rule of productRules) {
    const targetId = JSON.stringify(rule.productIds);
    if (rule.id) {
      await prisma.rule.updateMany({
        where: { id: rule.id, shopId },
        data: {
          targetType: "product",
          targetId,
          days: rule.days,
        },
      });

      await ensureLinksForAllRates(rule.id);
    } else {
      const created = await prisma.rule.create({
        data: {
          shopId,
          targetType: "product",
          targetId,
          days: rule.days,
        },
      });

      await ensureLinksForAllRates(created.id);
    }
  }
};
