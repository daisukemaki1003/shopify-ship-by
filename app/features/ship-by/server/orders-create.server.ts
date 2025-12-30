import type { Holiday, Rule, RuleShippingRate, ShopSetting } from "@prisma/client";

import prisma from "../../db.server";
import { apiVersion } from "../../shopify.server";
import { getAdminClient } from "../../server/admin-client.server";
import {
  calculateShipBy,
  toISODate,
  type HolidayLike,
  type RuleLike,
  type ShopifyOrderLike,
  type ShopSettingLike,
} from "./ship-by.server";
import { buildShipByMetafieldInput } from "./ship-by-metafield.server";

const DEFAULT_TAG_FORMAT = "ship-by-{YYYY}-{MM}-{DD}";

const parseOrderId = (value: unknown): { id: string | number | null; bigInt: bigint } => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return { id: value, bigInt: BigInt(value) };
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    return { id: value, bigInt: BigInt(value) };
  }
  return { id: null, bigInt: BigInt(0) };
};

const resolveOrderGid = (payload: unknown, orderId: string | number) => {
  const raw = (payload as { admin_graphql_api_id?: unknown } | null | undefined)
    ?.admin_graphql_api_id;
  if (typeof raw === "string" && raw.startsWith("gid://")) {
    return { gid: raw, fallback: false };
  }
  return { gid: `gid://shopify/Order/${orderId}`, fallback: true };
};

const extractShopSetting = (setting: ShopSetting | null): ShopSettingLike => ({
  deliverySource: setting?.deliverySource ?? null,
  deliveryKey: setting?.deliveryKey ?? null,
  deliveryFormat: setting?.deliveryFormat ?? null,
  defaultLeadDays: setting?.defaultLeadDays ?? null,
  shippingRates: (setting?.shippingRates ?? []) as ShopSettingLike["shippingRates"],
  language: setting?.language ?? null,
});

const extractHoliday = (holiday: Holiday | null): HolidayLike =>
  holiday ?? { holidays: [], weeklyHolidays: [] };

const extractRules = (links: Array<RuleShippingRate & { rule: Rule }>): RuleLike[] => {
  const map = new Map<string, RuleLike>();

  links.forEach((link) => {
    const { rule } = link;
    const existing = map.get(rule.id);
    if (existing) {
      existing.shippingRateIds.push(link.shippingRateId);
      return;
    }

    map.set(rule.id, {
      id: rule.id,
      shopId: rule.shopId,
      targetType: rule.targetType,
      targetId: rule.targetId,
      shippingRateIds: [link.shippingRateId],
      days: rule.days,
    });
  });

  return Array.from(map.values());
};

const formatWithTokens = (template: string | null | undefined, date: Date) => {
  const iso = toISODate(date);
  const [YYYY, MM, DD] = iso.split("-");
  const table: Record<string, string> = {
    "{YYYY}": YYYY,
    "{MM}": MM,
    "{DD}": DD,
  };

  return (template || "").replace(/\{YYYY\}|\{MM\}|\{DD\}/g, (token) => table[token] ?? token);
};

const coerceOrder = (payload: unknown): ShopifyOrderLike => {
  const obj = (payload ?? {}) as Record<string, unknown>;
  const attributes: ShopifyOrderLike["attributes"] = [];

  if (Array.isArray(obj.attributes)) {
    attributes.push(...(obj.attributes as ShopifyOrderLike["attributes"]));
  }
  if (Array.isArray(obj.note_attributes)) {
    attributes.push(...(obj.note_attributes as ShopifyOrderLike["attributes"]));
  }
  if (Array.isArray(obj.noteAttributes)) {
    attributes.push(...(obj.noteAttributes as ShopifyOrderLike["attributes"]));
  }

  return {
    id: obj.id as ShopifyOrderLike["id"],
    attributes,
    metafields: Array.isArray(obj.metafields)
      ? (obj.metafields as ShopifyOrderLike["metafields"])
      : [],
    shipping_lines: Array.isArray(obj.shipping_lines)
      ? (obj.shipping_lines as ShopifyOrderLike["shipping_lines"])
      : [],
    line_items: Array.isArray(obj.line_items)
      ? (obj.line_items as ShopifyOrderLike["line_items"])
      : [],
  };
};

const ensureArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.map((v: unknown) => String(v)) : [];

const extractTags = (payload: unknown): string[] => {
  const obj = (payload ?? {}) as Record<string, unknown>;

  if (Array.isArray(obj.tags)) {
    return ensureArray(obj.tags)
      .map((t: string) => t.trim())
      .filter(Boolean);
  }
  if (typeof obj.tags === "string") {
    return obj.tags
      .split(",")
      .map((t: string) => t.trim())
      .filter(Boolean);
  }
  return [];
};

const saveTags = async ({
  shop,
  orderId,
  shipBy,
  payload,
  tagFormat,
  enableTag,
}: {
  shop: string;
  orderId: string | number;
  shipBy: Date;
  payload: unknown;
  tagFormat: string | null | undefined;
  enableTag: boolean;
}) => {
  if (!enableTag) return;

  const { session, withRetry } = await getAdminClient(shop);
  const newTag = enableTag
    ? formatWithTokens(tagFormat ?? DEFAULT_TAG_FORMAT, shipBy)
    : null;
  const existingTags = extractTags(payload);
  const nextTags =
    newTag && !existingTags.includes(newTag)
      ? [...existingTags, newTag]
      : existingTags;

  const body: { order: Record<string, unknown> } = { order: { id: orderId } };
  if (enableTag) {
    body.order.tags = nextTags.join(", ");
  }

  const url = `https://${session.shop}/admin/api/${apiVersion}/orders/${orderId}.json`;
  const response = (await withRetry(
    () =>
      fetch(url, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": session.accessToken ?? "",
        },
        body: JSON.stringify(body),
      }),
    { action: "order_update" },
  )) as Response;

  if (!response.ok) {
    throw new Error(`Order update failed: ${response.status} ${response.statusText}`);
  }
};

const saveShipByMetafield = async ({
  shop,
  orderId,
  shipBy,
  payload,
}: {
  shop: string;
  orderId: string | number;
  shipBy: Date;
  payload: unknown;
}) => {
  const { admin, withRetry } = await getAdminClient(shop);
  const resolved = resolveOrderGid(payload, orderId);
  const metafields = [buildShipByMetafieldInput(resolved.gid, shipBy)];

  const response = (await withRetry(
    () =>
      admin.graphql(
        `#graphql
        mutation ShipByMetafieldSet($metafields: [MetafieldsSetInput!]!) {
          metafieldsSet(metafields: $metafields) {
            metafields {
              id
            }
            userErrors {
              field
              message
            }
          }
        }`,
        { variables: { metafields } },
      ),
    { action: "metafields_set" },
  )) as Response;

  if (!response.ok) {
    throw new Error(`metafieldsSet failed: ${response.status} ${response.statusText}`);
  }

  const json = await response.json();
  if (Array.isArray(json?.errors) && json.errors.length > 0) {
    throw new Error(`metafieldsSet graphql errors: ${JSON.stringify(json.errors)}`);
  }

  const userErrors = json?.data?.metafieldsSet?.userErrors ?? [];
  if (Array.isArray(userErrors) && userErrors.length > 0) {
    throw new Error(`metafieldsSet userErrors: ${JSON.stringify(userErrors)}`);
  }
};

const recordError = async (
  shop: string,
  orderId: string | number | null,
  reason: string,
  raw: unknown,
) => {
  try {
    const parsed = parseOrderId(orderId);
    await prisma.errorLog.create({
      data: {
        shopId: shop,
        orderId: parsed.bigInt,
        reason,
        rawData: raw as unknown as object,
      },
    });
  } catch (err) {
    console.error("[orders-create] failed to record error", err);
  }
};

const recordShipBy = async ({
  shop,
  orderId,
  shipBy,
  deliveryDate,
}: {
  shop: string;
  orderId: string | number | null;
  shipBy: Date;
  deliveryDate: Date;
}) => {
  if (!orderId) return;

  try {
    const parsed = parseOrderId(orderId);
    if (!parsed.id) return;

    await prisma.shipByRecord.upsert({
      where: { shopId_orderId: { shopId: shop, orderId: parsed.bigInt } },
      create: {
        shopId: shop,
        orderId: parsed.bigInt,
        shipByDate: shipBy,
        deliveryDate,
      },
      update: {
        shipByDate: shipBy,
        deliveryDate,
      },
    });
  } catch (err) {
    console.error("[orders-create] failed to record ship-by", err);
  }
};

export const handleOrdersCreate = async (shop: string, payload: unknown) => {
  const { id: orderId } = parseOrderId(
    (payload as { id?: string | number | null } | null | undefined)?.id,
  );

  try {
    if (!orderId) {
      await recordError(shop, orderId, "order id missing", { payload });
      return;
    }

    const [setting, holiday, ruleLinks] = await Promise.all([
      prisma.shopSetting.findUnique({ where: { shopId: shop } }),
      prisma.holiday.findUnique({ where: { shopId: shop } }),
      prisma.ruleShippingRate.findMany({
        where: { shopId: shop },
        include: { rule: true },
      }),
    ]);

    const calcResult = calculateShipBy({
      order: coerceOrder(payload),
      rules: extractRules(ruleLinks),
      shopSetting: extractShopSetting(setting),
      holiday: extractHoliday(holiday),
    });

    if (!calcResult.ok) {
      console.warn("[orders-create] shipping calculation failed", {
        shop,
        orderId,
        error: calcResult.error,
        message: calcResult.message,
      });
      await recordError(shop, orderId, calcResult.message, { payload });
      return;
    }

    const shipBy = calcResult.value.shipBy;
    const deliveryDate = calcResult.value.deliveryDate;
    const saveTagEnabled = setting?.saveTag === true;
    const saveMetafieldEnabled = setting?.saveMetafield !== false;

    await recordShipBy({
      shop,
      orderId,
      shipBy,
      deliveryDate,
    });

    if (saveMetafieldEnabled) {
      await saveShipByMetafield({
        shop,
        orderId,
        shipBy,
        payload,
      });
    }

    if (saveTagEnabled) {
      await saveTags({
        shop,
        orderId,
        shipBy,
        payload,
        tagFormat: setting?.saveTagFormat,
        enableTag: saveTagEnabled,
      });
    }
  } catch (error) {
    console.error("[orders-create] failed", error);
    await recordError(
      shop,
      orderId,
      error instanceof Error ? error.message : "unknown error",
      { payload },
    );
  }
};
