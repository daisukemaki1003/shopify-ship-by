import type { Holiday, Rule, RuleShippingRate, ShopSetting } from "@prisma/client";

import prisma from "../db.server";
import { apiVersion } from "../shopify.server";
import { getAdminClient } from "./admin-client.server";
import {
  calculateShipBy,
  toISODate,
  type HolidayLike,
  type RuleLike,
  type ShopifyOrderLike,
  type ShopSettingLike,
} from "./ship-by.server";

const METAFIELD_NAMESPACE = "ship_by";
const METAFIELD_KEY = "deadline";
const DEFAULT_TAG_FORMAT = "ship-by-{YYYY}-{MM}-{DD}";
const DEFAULT_NOTE_FORMAT = "出荷期限：{YYYY}-{MM}-{DD}";

const parseOrderId = (value: unknown): { id: string | number | null; bigInt: bigint } => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return { id: value, bigInt: BigInt(value) };
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    return { id: value, bigInt: BigInt(value) };
  }
  return { id: null, bigInt: BigInt(0) };
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

  return {
    id: obj.id as ShopifyOrderLike["id"],
    attributes: Array.isArray(obj.attributes)
      ? (obj.attributes as ShopifyOrderLike["attributes"])
      : [],
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

const saveMetafield = async (
  shop: string,
  orderId: string | number,
  shipBy: Date,
) => {
  const { admin, withRetry } = await getAdminClient(shop);
  const ownerId = `gid://shopify/Order/${orderId}`;
  const value = toISODate(shipBy);

  const response = (await withRetry(
    () =>
      admin.graphql(
        `#graphql
        mutation setShipByMetafield($metafields: [MetafieldsSetInput!]!) {
          metafieldsSet(metafields: $metafields) {
            userErrors {
              field
              message
            }
          }
        }`,
        {
          variables: {
            metafields: [
              {
                ownerId,
                namespace: METAFIELD_NAMESPACE,
                key: METAFIELD_KEY,
                type: "date",
                value,
              },
            ],
          },
        },
      ),
    { action: "metafieldsSet" },
  )) as Response;

  const body = (await response.json()) as {
    data?: { metafieldsSet?: { userErrors?: Array<{ message?: string }> } };
    errors?: Array<{ message?: string }>;
  };

  const userErrors = body.data?.metafieldsSet?.userErrors ?? [];
  if ((body.errors && body.errors.length > 0) || userErrors.length > 0) {
    const message =
      body.errors?.map((e) => e.message).join("; ") ||
      userErrors.map((e) => e.message).join("; ") ||
      "metafieldsSet failed";
    throw new Error(message);
  }
};

const saveTagsAndNote = async ({
  shop,
  orderId,
  shipBy,
  payload,
  tagFormat,
  noteFormat,
  enableTag,
  enableNote,
}: {
  shop: string;
  orderId: string | number;
  shipBy: Date;
  payload: unknown;
  tagFormat: string | null | undefined;
  noteFormat: string | null | undefined;
  enableTag: boolean;
  enableNote: boolean;
}) => {
  if (!enableTag && !enableNote) return;

  const { session, withRetry } = await getAdminClient(shop);
  const newTag = enableTag
    ? formatWithTokens(tagFormat ?? DEFAULT_TAG_FORMAT, shipBy)
    : null;
  const existingTags = extractTags(payload);
  const nextTags =
    newTag && !existingTags.includes(newTag)
      ? [...existingTags, newTag]
      : existingTags;

  const nextNote = enableNote
    ? formatWithTokens(noteFormat ?? DEFAULT_NOTE_FORMAT, shipBy)
    : undefined;

  const body: { order: Record<string, unknown> } = { order: { id: orderId } };
  if (enableTag) {
    body.order.tags = nextTags.join(", ");
  }
  if (enableNote) {
    body.order.note = nextNote;
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
      await recordError(shop, orderId, calcResult.message, { payload });
      return;
    }

    const shipBy = calcResult.value.shipBy;
    const saveMetafieldEnabled = setting?.saveMetafield !== false;
    const saveTagEnabled = setting?.saveTag === true;
    const saveNoteEnabled = setting?.saveNote === true;

    if (saveMetafieldEnabled) {
      await saveMetafield(shop, orderId, shipBy);
    }

    if (saveTagEnabled || saveNoteEnabled) {
      await saveTagsAndNote({
        shop,
        orderId,
        shipBy,
        payload,
        tagFormat: setting?.saveTagFormat,
        noteFormat: setting?.saveNoteFormat,
        enableTag: saveTagEnabled,
        enableNote: saveNoteEnabled,
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
