import type { DeliverySource, RuleTargetType } from "@prisma/client";

type ShippingMethodSettings = Record<
  string,
  { title?: string; enabled?: boolean; price?: string; currency?: string | null }
>;

export type ShopSettingLike = {
  deliverySource?: DeliverySource | null;
  deliveryKey?: string | null;
  deliveryFormat?: string | null;
  shippingMethodSettings?: ShippingMethodSettings | null;
};

export type RuleLike = {
  id: string;
  shopId?: string;
  targetType: RuleTargetType;
  targetId: string | null;
  prefectures: unknown;
  days: number;
  enabled: boolean;
};

export type HolidayLike = {
  holidays?: unknown;
  weeklyHolidays?: unknown;
};

export type ShopifyOrderLike = {
  id?: string | number;
  attributes?: Array<{ name?: string | null; value?: unknown }>;
  metafields?: Array<{ namespace?: string | null; key?: string | null; value?: unknown }>;
  shipping_lines?: Array<{ code?: string | null; title?: string | null }>;
  shipping_address?: {
    province?: string | null;
    province_code?: string | null;
  };
  line_items?: Array<{ product_id?: number | string | null }>;
};

type Ok<T> = { ok: true; value: T };
type Err = { ok: false; error: CalculationError; message: string };

export type CalculationError =
  | "missing_setting"
  | "delivery_value_not_found"
  | "invalid_delivery_format"
  | "shipping_method_not_found"
  | "shipping_method_disabled"
  | "shipping_method_not_configured"
  | "prefecture_missing"
  | "no_rule"
  | "holiday_never_resolves";

export type CalculationResult =
  | (Ok<{
      shipBy: Date;
      deliveryDate: Date;
      adoptDays: number;
      shippingMethod: string;
      matchedRuleIds: string[];
      adjustedFrom: Date;
    }> & { error?: never })
  | (Err & { value?: never });

const PREF_CODE_TO_SLUG: Record<string, string> = {
  "JP-01": "hokkaido",
  "JP-02": "aomori",
  "JP-03": "iwate",
  "JP-04": "miyagi",
  "JP-05": "akita",
  "JP-06": "yamagata",
  "JP-07": "fukushima",
  "JP-08": "ibaraki",
  "JP-09": "tochigi",
  "JP-10": "gunma",
  "JP-11": "saitama",
  "JP-12": "chiba",
  "JP-13": "tokyo",
  "JP-14": "kanagawa",
  "JP-15": "niigata",
  "JP-16": "toyama",
  "JP-17": "ishikawa",
  "JP-18": "fukui",
  "JP-19": "yamanashi",
  "JP-20": "nagano",
  "JP-21": "gifu",
  "JP-22": "shizuoka",
  "JP-23": "aichi",
  "JP-24": "mie",
  "JP-25": "shiga",
  "JP-26": "kyoto",
  "JP-27": "osaka",
  "JP-28": "hyogo",
  "JP-29": "nara",
  "JP-30": "wakayama",
  "JP-31": "tottori",
  "JP-32": "shimane",
  "JP-33": "okayama",
  "JP-34": "hiroshima",
  "JP-35": "yamaguchi",
  "JP-36": "tokushima",
  "JP-37": "kagawa",
  "JP-38": "ehime",
  "JP-39": "kochi",
  "JP-40": "fukuoka",
  "JP-41": "saga",
  "JP-42": "nagasaki",
  "JP-43": "kumamoto",
  "JP-44": "oita",
  "JP-45": "miyazaki",
  "JP-46": "kagoshima",
  "JP-47": "okinawa",
};

const WEEKDAY_CODES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

const DEFAULT_FORMAT = "YYYY-MM-DD";

const normalizeKey = (value: string) =>
  value.trim().toLowerCase().replace(/[\s-]+/g, "_");

const normalizePrefecture = (value: string | null | undefined) => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const isoSlug = PREF_CODE_TO_SLUG[trimmed.toUpperCase()];
  if (isoSlug) return isoSlug;

  const slug = trimmed.toLowerCase().replace(/[^a-z]/g, "");
  return slug || null;
};

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

const buildShippingMethodLookup = (settings: ShippingMethodSettings | null | undefined) => {
  const all = new Map<string, string>();
  const enabled = new Map<string, string>();

  Object.entries(settings ?? {}).forEach(([key, value]) => {
    const normalized = normalizeKey(key);
    all.set(normalized, key);
    if (value?.enabled !== false) {
      enabled.set(normalized, key);
    }
  });

  return { all, enabled };
};

export const detectShippingMethod = (
  order: ShopifyOrderLike,
  shopSetting: ShopSettingLike,
): Ok<string> | Err => {
  const settings = shopSetting.shippingMethodSettings ?? {};
  const lookup = buildShippingMethodLookup(settings);
  const candidates: string[] = [];

  order.shipping_lines?.forEach((line) => {
    if (line?.code) candidates.push(line.code);
    else if (line?.title) candidates.push(line.title);
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
      if (!lookup.enabled.has(normalized)) {
        return {
          ok: false,
          error: "shipping_method_disabled",
          message: `shipping method ${canonical} is disabled`,
        };
      }
      return { ok: true, value: canonical };
    }
  }

  if (lookup.all.size > 0) {
    return {
      ok: false,
      error: "shipping_method_not_found",
      message: "shipping method not found on order",
    };
  }

  return {
    ok: false,
    error: "shipping_method_not_configured",
    message: "no shipping methods are configured",
  };
};

const getProductIds = (order: ShopifyOrderLike) =>
  (order.line_items ?? [])
    .map((item) => (item?.product_id != null ? String(item.product_id) : null))
    .filter((id): id is string => Boolean(id));

const normalizePrefectureCandidates = (order: ShopifyOrderLike) =>
  normalizePrefecture(
    order.shipping_address?.province_code ?? order.shipping_address?.province,
  );

const ensureArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.map((v) => String(v)) : [];

export const pickAdoptedRule = (
  params: {
    rules: RuleLike[];
    shippingMethod: string;
    shopSetting: ShopSettingLike;
    prefecture: string | null;
    productIds: string[];
  },
): Ok<{ days: number; ruleIds: string[] }> | Err => {
  const { rules, shippingMethod, prefecture, productIds, shopSetting } = params;
  if (!prefecture) {
    return {
      ok: false,
      error: "prefecture_missing",
      message: "shipping address prefecture is missing",
    };
  }

  const enabledShipping = buildShippingMethodLookup(
    shopSetting.shippingMethodSettings ?? {},
  ).enabled;

  const candidates = rules.filter((rule) => {
    if (!rule.enabled) return false;

    const prefectureList = ensureArray(rule.prefectures).map((p) =>
      normalizePrefecture(String(p)),
    );
    if (
      prefectureList.length > 0 &&
      !prefectureList.includes(prefecture)
    ) {
      return false;
    }

    if (rule.targetType === "all_products") return true;

    if (rule.targetType === "product") {
      return rule.targetId ? productIds.includes(String(rule.targetId)) : false;
    }

    if (rule.targetType === "shipping_method") {
      const normalizedTarget = normalizeKey(rule.targetId ?? "");
      return (
        normalizedTarget === normalizeKey(shippingMethod) &&
        enabledShipping.has(normalizedTarget)
      );
    }

    return false;
  });

  if (candidates.length === 0) {
    return { ok: false, error: "no_rule", message: "no matching rule found" };
  }

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
    ensureArray(holiday?.weeklyHolidays).map((day) => day.toLowerCase()),
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

  const shippingMethodResult = detectShippingMethod(
    input.order,
    input.shopSetting,
  );
  if (!shippingMethodResult.ok) return shippingMethodResult;

  const prefecture = normalizePrefectureCandidates(input.order);
  const productIds = getProductIds(input.order);

  const ruleResult = pickAdoptedRule({
    rules: input.rules,
    shippingMethod: shippingMethodResult.value,
    shopSetting: input.shopSetting,
    prefecture,
    productIds,
  });

  if (!ruleResult.ok) return ruleResult;

  const baseShipBy = addDays(deliveryResult.value, -ruleResult.value.days);
  const adjustedResult = adjustForHolidays(baseShipBy, input.holiday);
  if (!adjustedResult.ok) return adjustedResult;

  return {
    ok: true,
    value: {
      shipBy: adjustedResult.value,
      deliveryDate: deliveryResult.value,
      adoptDays: ruleResult.value.days,
      shippingMethod: shippingMethodResult.value,
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
