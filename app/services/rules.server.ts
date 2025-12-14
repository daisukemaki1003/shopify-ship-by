import type {AdminApiContext} from "@shopify/shopify-app-react-router/server";

import prisma from "../db.server";
import {getShippingRates, type ShippingRateEntry} from "./shipping-rates.server";
import {parseTargetIds, collectUniqueProductIds} from "../utils/rules";
import {toFallbackProduct, FALLBACK_PRODUCT_TITLE} from "../utils/products";
import type {ProductRule, ProductRuleWithProducts, ProductSummary} from "../utils/rule-types";
import {parsePositiveInt} from "../utils/validation";
import {RuleTargetType} from "@prisma/client";

// 配送レートのルール詳細に必要なデータ
export type RuleDetailData = {
  rate: ShippingRateEntry;
  base: {id: string; days: number} | null;
  productRules: ProductRuleWithProducts[];
};

// 配列を指定サイズで分割するユーティリティ
const chunkArray = <T,>(items: T[], size: number): T[][] => {
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
        {variables: {ids: chunk}},
      );

      const json = await response.json();
      const nodes = (json?.data?.nodes ?? []) as any[];

      nodes.forEach((node) => {
        if (!node || node.__typename !== "Product" || !node.id) return;

        const primaryImage =
          node.featuredImage?.url ??
          node.images?.nodes?.[0]?.url ??
          null;

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

// 配送レートに紐づくルール・商品情報を取得する
export const loadRuleDetail = async ({
  shopId,
  rateId,
  admin,
}: {
  shopId: string;
  rateId: string;
  admin: AdminApiContext;
}): Promise<RuleDetailData> => {
  const [rates, ruleLinks, dbRate] = await Promise.all([
    getShippingRates(shopId),
    prisma.ruleShippingRate.findMany({
      where: {
        shopId,
        shippingRateId: rateId,
        shippingRateShopId: shopId,
      },
      include: {rule: true},
      orderBy: {createdAt: "desc"},
    }),
    prisma.shippingRate.findFirst({
      where: {shopId, shippingRateId: rateId},
      select: {shippingRateId: true, handle: true, title: true, zoneName: true},
    }),
  ]);

  const rate =
    rates.find((r) => r.shippingRateId === rateId) ??
    (dbRate
      ? {
        shippingRateId: dbRate.shippingRateId,
        handle: dbRate.handle,
        title: dbRate.title,
        zoneName: dbRate.zoneName,
      }
      : null);
  if (!rate) {
    throw new Response("Not found", {status: 404});
  }

  const rules = ruleLinks.map((link) => link.rule);

  const baseRule = rules.find((rule) => rule.targetType === RuleTargetType.all);

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
    rate,
    base: baseRule ? {id: baseRule.id, days: baseRule.days} : null,
    productRules,
  };
};

// クライアントから受け取る生ペイロード
export type RulePayload = {
  rateId: string;
  base: {id: string | null; days: string};
  productRules: ProductRule[];
};

// 入力値を検証し、DB保存に使える形へ正規化
export const normalizeRulePayload = (
  payload: RulePayload | null,
  expectedRateId: string,
): {ok: false; message: string} | {ok: true; baseDays: number; productRules: ProductRule[]} => {
  if (!payload || payload.rateId !== expectedRateId) {
    return {ok: false, message: "配送ケースが一致しません"};
  }

  const errors: string[] = [];
  const parsedBaseDays = parsePositiveInt(payload.base.days);
  if (!parsedBaseDays) {
    errors.push("基本設定の出荷リードタイムは1以上の整数で入力してください");
  }

  const normalizedProductRules: ProductRule[] = payload.productRules.map((rule, idx) => {
    const parsedDays = parsePositiveInt(rule.days);

    if (!rule.productIds || rule.productIds.length === 0) {
      errors.push(`商品別設定${idx + 1}: 商品を選択してください`);
    }
    if (!parsedDays) {
      errors.push(`商品別設定${idx + 1}: 出荷リードタイムは1以上の整数で入力してください`);
    }
    return {...rule, days: parsedDays ?? 1};
  });

  if (errors.length > 0) {
    return {ok: false, message: errors.join(" / ")};
  }

  return {
    ok: true,
    baseDays: parsedBaseDays ?? 1,
    productRules: normalizedProductRules,
  };
};

// 検証済みペイロードをDBへ保存する
export const persistRulePayload = async ({
  shopId,
  rateId,
  baseId,
  baseDays,
  productRules,
}: {
  shopId: string;
  rateId: string;
  baseId: string | null;
  baseDays: number;
  productRules: ProductRule[];
}) => {
  const linkUniqueWhere = (ruleId: string) => ({
    shopId_ruleId_shippingRateId: {shopId, ruleId, shippingRateId: rateId},
  });

  if (baseId) {
    await prisma.rule.updateMany({where: {id: baseId, shopId}, data: {days: baseDays}});
    await prisma.ruleShippingRate.upsert({
      where: linkUniqueWhere(baseId),
      update: {},
      create: {
        shopId,
        ruleId: baseId,
        shippingRateId: rateId,
        shippingRateShopId: shopId,
      },
    });
  } else {
    const created = await prisma.rule.create({
      data: {
        shopId,
        targetType: "all",
        targetId: null,
        days: baseDays,
      },
    });

    await prisma.ruleShippingRate.create({
      data: {
        shopId,
        ruleId: created.id,
        shippingRateId: rateId,
        shippingRateShopId: shopId,
      },
    });
  }

  const incomingIds = new Set(productRules.map((r) => r.id).filter(Boolean) as string[]);

  // レートに紐づく削除対象の商品別ルールを洗い出し
  const existingProductRuleLinks = await prisma.ruleShippingRate.findMany({
    where: {
      shopId,
      shippingRateId: rateId,
      shippingRateShopId: shopId,
      rule: {targetType: RuleTargetType.product},
    },
    select: {ruleId: true},
  });

  const deleteIds = existingProductRuleLinks
    .map((link) => link.ruleId)
    .filter((id) => !incomingIds.has(id));

  if (deleteIds.length > 0) {
    await prisma.ruleShippingRate.deleteMany({
      where: {shopId, shippingRateId: rateId, shippingRateShopId: shopId, ruleId: {in: deleteIds}},
    });
    await prisma.rule.deleteMany({
      where: {shopId, id: {in: deleteIds}},
    });
  }

  // 商品別ルールをUpsert
  for (const rule of productRules) {
    const targetId = JSON.stringify(rule.productIds);
    if (rule.id) {
      await prisma.rule.updateMany({
        where: {id: rule.id, shopId},
        data: {
          targetType: "product",
          targetId,
          days: rule.days,
        },
      });

      await prisma.ruleShippingRate.upsert({
        where: linkUniqueWhere(rule.id),
        update: {},
        create: {
          shopId,
          ruleId: rule.id,
          shippingRateId: rateId,
          shippingRateShopId: shopId,
        },
      });
    } else {
      const created = await prisma.rule.create({
        data: {
          shopId,
          targetType: "product",
          targetId,
          days: rule.days,
        },
      });

      await prisma.ruleShippingRate.create({
        data: {
          shopId,
          ruleId: created.id,
          shippingRateId: rateId,
          shippingRateShopId: shopId,
        },
      });
    }
  }
};
