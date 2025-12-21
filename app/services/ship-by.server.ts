import type { DeliverySource, RuleTargetType } from "@prisma/client";

type ShippingRateLike = {
  shippingRateId: string;
  handle?: string | null;
  title?: string | null;
  zoneName?: string | null;
};

export type ShopSettingLike = {
  deliverySource?: DeliverySource | null;
  deliveryKey?: string | null;
  deliveryFormat?: string | null;
  defaultLeadDays?: number | null;
  shippingRates?: ShippingRateLike[] | null;
  language?: string | null;
};

export type RuleLike = {
  id: string;
  shopId?: string;
  targetType: RuleTargetType;
  targetId: string | null;
  shippingRateIds: string[];
  days: number;
};

export type HolidayLike = {
  holidays?: unknown;
  weeklyHolidays?: unknown;
};

export type ShopifyOrderLike = {
  id?: string | number;
  attributes?: Array<{ name?: string | null; value?: unknown }>;
  metafields?: Array<{ namespace?: string | null; key?: string | null; value?: unknown }>;
  shipping_lines?: Array<{
    code?: string | null;
    title?: string | null;
    delivery_category?: string | null;
    shipping_rate_handle?: string | null;
    id?: string | number | null;
  }>;
  line_items?: Array<{ product_id?: number | string | null }>;
};

type Ok<T> = { ok: true; value: T };
type Err = { ok: false; error: CalculationError; message: string };

export type CalculationError =
  | "missing_setting"
  | "delivery_value_not_found"
  | "invalid_delivery_format"
  | "shipping_rate_not_found"
  | "shipping_rate_not_configured"
  | "no_rule"
  | "holiday_never_resolves";

export type CalculationResult =
  | (Ok<{
      shipBy: Date;
      deliveryDate: Date;
      adoptDays: number;
      shippingRateId: string;
      matchedRuleIds: string[];
      adjustedFrom: Date;
    }> & { error?: never })
  | (Err & { value?: never });

const WEEKDAY_CODES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
const DEFAULT_FORMAT = "YYYY-MM-DD";

const normalizeKey = (value: string) =>
  value.trim().toLowerCase().replace(/[\s-]+/g, "_");

const ensureArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const buildFormatRegex = (format: string) => {
  const escaped = format.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
  const pattern = escaped
    .replace(/YYYY/g, "(?<year>\\d{4})")
    .replace(/MM/g, "(?<month>\\d{1,2})")
    .replace(/DD/g, "(?<day>\\d{1,2})");
  return new RegExp(`^${pattern}$`);
};

const dateFromParts = (year: number, month: number, day: number) => {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
};

const parseDateWithFormat = (raw: string, format: string) => {
  const regex = buildFormatRegex(format);
  const match = regex.exec(raw.trim());
  if (!match?.groups) return null;

  const year = Number.parseInt(match.groups.year ?? "", 10);
  const month = Number.parseInt(match.groups.month ?? "", 10);
  const day = Number.parseInt(match.groups.day ?? "", 10);

  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return null;
  }

  return dateFromParts(year, month, day);
};

const getDeliveryValue = (
  order: ShopifyOrderLike,
  source: DeliverySource,
  deliveryKey: string,
) => {
  if (source === "metafield") {
    const [namespace, key] = deliveryKey.split(".");
    if (!namespace || !key) {
      return null;
    }

    return order.metafields?.find(
      (mf) =>
        mf?.namespace?.trim() === namespace &&
        mf?.key?.trim() === key &&
        typeof mf?.value === "string",
    )?.value as string | null | undefined;
  }

  const attribute = order.attributes?.find(
    (attr) => attr?.name?.trim() === deliveryKey,
  );

  if (typeof attribute?.value === "string") {
    return attribute.value;
  }
  if (
    typeof attribute?.value === "number" &&
    Number.isFinite(attribute.value)
  ) {
    return String(attribute.value);
  }

  return null;
};

export const parseDeliveryDate = (
  order: ShopifyOrderLike,
  shopSetting: ShopSettingLike,
): Ok<Date> | Err => {
  const source = shopSetting.deliverySource;
  const key = shopSetting.deliveryKey;
  const format = shopSetting.deliveryFormat || DEFAULT_FORMAT;

  if (!source || !key) {
    return {
      ok: false,
      error: "missing_setting",
      message: "delivery source or key is not configured",
    };
  }

  const rawValue = getDeliveryValue(order, source, key);
  if (!rawValue) {
    return {
      ok: false,
      error: "delivery_value_not_found",
      message: "delivery date value not found on order",
    };
  }

  const parsed = parseDateWithFormat(rawValue, format);
  if (!parsed) {
    return {
      ok: false,
      error: "invalid_delivery_format",
      message: `delivery date does not match format ${format}`,
    };
  }

  return { ok: true, value: parsed };
};

const buildShippingRateLookup = (shippingRates: ShippingRateLike[] | null | undefined) => {
  const all = new Map<string, ShippingRateLike>();

  (shippingRates ?? []).forEach((rate) => {
    if (!rate) return;
    const keys = new Set<string>();
    if (rate.shippingRateId) keys.add(normalizeKey(rate.shippingRateId));
    if (rate.handle) keys.add(normalizeKey(rate.handle));
    if (rate.title) keys.add(normalizeKey(rate.title));

    keys.forEach((key) => {
      all.set(key, rate);
    });
  });

  return { all };
};

export const detectShippingRate = (
  order: ShopifyOrderLike,
  shopSetting: ShopSettingLike,
): Ok<string> | Err => {
  const lookup = buildShippingRateLookup(shopSetting.shippingRates);
  const candidates: string[] = [];

  order.shipping_lines?.forEach((line) => {
    if (line?.shipping_rate_handle) candidates.push(line.shipping_rate_handle);
    if (line?.code) candidates.push(line.code);
    if (line?.delivery_category) candidates.push(line.delivery_category);
    if (line?.title) candidates.push(line.title);
    if (line?.id != null) candidates.push(String(line.id));
  });

  order.metafields?.forEach((mf) => {
    if (typeof mf?.value === "string") {
      candidates.push(mf.value);
    }
  });

  order.attributes?.forEach((attr) => {
    if (typeof attr?.value === "string") {
      candidates.push(attr.value);
    }
  });

  for (const candidate of candidates) {
    const normalized = normalizeKey(candidate);
    const canonical = lookup.all.get(normalized);
    if (canonical) {
      return { ok: true, value: canonical.shippingRateId };
    }
  }

  if (lookup.all.size > 0) {
    return {
      ok: false,
      error: "shipping_rate_not_found",
      message: "shipping rate not found on order",
    };
  }

  return {
    ok: false,
    error: "shipping_rate_not_configured",
    message: "no shipping rates are configured",
  };
};

const getProductIds = (order: ShopifyOrderLike) =>
  (order.line_items ?? [])
    .map((item) => (item?.product_id != null ? String(item.product_id) : null))
    .filter((id): id is string => Boolean(id));

const normalizeIdList = (value: unknown) =>
  (Array.isArray(value) ? value : []).map((v) => normalizeKey(String(v)));

export const pickAdoptedRule = (
  params: {
    rules: RuleLike[];
    shippingRateId: string;
    productIds: string[];
  },
): Ok<{ days: number; ruleIds: string[] }> | Err => {
  const { rules, shippingRateId, productIds } = params;
  const normalizedProductIds = productIds.map((p) => String(p));

  const matchesProduct = (rule: RuleLike) =>
    rule.targetType === "all" ||
    (rule.targetId ? normalizedProductIds.includes(String(rule.targetId)) : false);

  const matchesShippingRate = (rule: RuleLike) => {
    const rateIds = normalizeIdList(rule.shippingRateIds);
    if (rateIds.length === 0) return true;
    return rateIds.includes(normalizeKey(shippingRateId));
  };

  const hasRateConstraint = (rule: RuleLike) =>
    normalizeIdList(rule.shippingRateIds).length > 0;

  const tiers: Array<(rule: RuleLike) => boolean> = [
    (rule) =>
      rule.targetType === "product" &&
      hasRateConstraint(rule) &&
      matchesProduct(rule) &&
      matchesShippingRate(rule),
    (rule) =>
      rule.targetType === "product" &&
      !hasRateConstraint(rule) &&
      matchesProduct(rule),
    (rule) =>
      rule.targetType === "all" &&
      hasRateConstraint(rule) &&
      matchesShippingRate(rule),
    (rule) => rule.targetType === "all" && !hasRateConstraint(rule),
  ];

  for (const tier of tiers) {
    const candidates = rules.filter((rule) => tier(rule));
    if (candidates.length === 0) continue;

    let adoptDays = -Infinity;
    const matchedRuleIds: string[] = [];
    candidates.forEach((rule) => {
      if (rule.days > adoptDays) {
        adoptDays = rule.days;
      }
    });
    candidates.forEach((rule) => {
      if (rule.days === adoptDays) {
        matchedRuleIds.push(rule.id);
      }
    });

    return { ok: true, value: { days: adoptDays, ruleIds: matchedRuleIds } };
  }

  return { ok: false, error: "no_rule", message: "no matching rule found" };
};

const addDays = (date: Date, days: number) => {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
};

const toSet = (value: unknown) => {
  const arr = ensureArray(value).map((v) => String(v));
  return new Set(arr);
};

export const adjustForHolidays = (
  date: Date,
  holiday: HolidayLike | null | undefined,
  ): Ok<Date> | Err => {
    const holidaySet = toSet(holiday?.holidays);
    const weeklySet = new Set(
    ensureArray(holiday?.weeklyHolidays).map((day) => String(day).toLowerCase()),
    );

  let cursor = new Date(date);
  for (let i = 0; i < 366; i++) {
    const iso = toISODate(cursor);
    const isWeekly = weeklySet.has(WEEKDAY_CODES[cursor.getUTCDay()]);
    if (!holidaySet.has(iso) && !isWeekly) {
      return { ok: true, value: cursor };
    }
    cursor = addDays(cursor, -1);
  }

  return {
    ok: false,
    error: "holiday_never_resolves",
    message: "could not find a working day within 1 year",
  };
};

export const calculateShipBy = (input: {
  order: ShopifyOrderLike;
  rules: RuleLike[];
  shopSetting: ShopSettingLike;
  holiday?: HolidayLike | null;
}): CalculationResult => {
  const deliveryResult = parseDeliveryDate(input.order, input.shopSetting);
  if (!deliveryResult.ok) return deliveryResult;

  const shippingRateResult = detectShippingRate(input.order, input.shopSetting);
  if (!shippingRateResult.ok) return shippingRateResult;

  const productIds = getProductIds(input.order);

  const ruleResult = pickAdoptedRule({
    rules: input.rules,
    shippingRateId: shippingRateResult.value,
    productIds,
  });

  if (!ruleResult.ok) {
    const fallbackDays = input.shopSetting.defaultLeadDays;
    if (ruleResult.error === "no_rule" && fallbackDays && fallbackDays > 0) {
      const baseShipBy = addDays(deliveryResult.value, -fallbackDays);
      const adjustedResult = adjustForHolidays(baseShipBy, input.holiday);
      if (!adjustedResult.ok) return adjustedResult;

      return {
        ok: true,
        value: {
          shipBy: adjustedResult.value,
          deliveryDate: deliveryResult.value,
          adoptDays: fallbackDays,
          shippingRateId: shippingRateResult.value,
          matchedRuleIds: [],
          adjustedFrom: baseShipBy,
        },
      };
    }
    return ruleResult;
  }

  const baseShipBy = addDays(deliveryResult.value, -ruleResult.value.days);
  const adjustedResult = adjustForHolidays(baseShipBy, input.holiday);
  if (!adjustedResult.ok) return adjustedResult;

  return {
    ok: true,
    value: {
      shipBy: adjustedResult.value,
      deliveryDate: deliveryResult.value,
      adoptDays: ruleResult.value.days,
      shippingRateId: shippingRateResult.value,
      matchedRuleIds: ruleResult.value.ruleIds,
      adjustedFrom: baseShipBy,
    },
  };
};

export const toISODate = (date: Date) =>
  `${date.getUTCFullYear().toString().padStart(4, "0")}-${(date
    .getUTCMonth() +
    1)
    .toString()
    .padStart(2, "0")}-${date.getUTCDate().toString().padStart(2, "0")}`;
