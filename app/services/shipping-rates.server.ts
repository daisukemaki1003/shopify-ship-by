import prisma from "../db.server";
import { apiVersion } from "../shopify.server";
import { getAdminClient } from "./admin-client.server";

type RawShippingRate = {
  code?: string | null;
  name?: string | null;
  price?: string | null;
  currency?: string | null;
  service_code?: string | null;
  id?: number | string | null;
};

type RawShippingZone = {
  shipping_rates?: RawShippingRate[] | null;
  price_based_shipping_rates?: RawShippingRate[] | null;
  weight_based_shipping_rates?: RawShippingRate[] | null;
};

export interface ShippingRateCandidate {
  key: string;
  code: string;
  title: string;
  price: string;
  currency: string | null;
}

type ShippingMethodSettings = Record<
  string,
  {
    title: string;
    enabled: boolean;
    price: string;
    currency: string | null;
  }
>;

type ShopSettingDelegate = {
  findUnique: (...args: unknown[]) => Promise<unknown>;
  upsert: (...args: unknown[]) => Promise<unknown>;
};

const db = prisma as typeof prisma & { shopSetting: ShopSettingDelegate };
const EMPTY_SETTINGS: ShippingMethodSettings = {};

export async function getShippingMethodSettings(shopId: string) {
  const current = (await db.shopSetting.findUnique({
    where: { shopId },
  })) as { shippingMethodSettings?: ShippingMethodSettings } | null;

  return (current?.shippingMethodSettings as ShippingMethodSettings) ?? EMPTY_SETTINGS;
}

const normalizeRate = (rate: RawShippingRate): ShippingRateCandidate | null => {
  const codeCandidate =
    rate.code ??
    rate.service_code ??
    (typeof rate.id === "string" ? rate.id : null) ??
    (typeof rate.id === "number" ? String(rate.id) : null) ??
    rate.name;

  const code = (codeCandidate ?? "").trim();
  if (!code) return null;

  const title = (rate.name ?? code).trim();
  const price = (rate.price ?? "0").trim();
  const currency = rate.currency ?? null;

  return {
    key: code,
    code,
    title,
    price,
    currency,
  };
};

const extractRates = (zones: RawShippingZone[]): ShippingRateCandidate[] => {
  const map = new Map<string, ShippingRateCandidate>();

  zones.forEach((zone) => {
    const candidates = [
      ...(zone.shipping_rates ?? []),
      ...(zone.price_based_shipping_rates ?? []),
      ...(zone.weight_based_shipping_rates ?? []),
    ];

    candidates.forEach((rate) => {
      const normalized = normalizeRate(rate);
      if (!normalized) return;

      if (!map.has(normalized.key)) {
        map.set(normalized.key, normalized);
      }
    });
  });

  return Array.from(map.values());
};

export async function fetchShippingRates(shop: string) {
  const { session, withRetry } = await getAdminClient(shop);
  const url = `https://${session.shop}/admin/api/${apiVersion}/shipping_zones.json`;

  const response = (await withRetry(
    () =>
      fetch(url, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": session.accessToken ?? "",
        },
      }),
    { action: "shipping_zones" },
  )) as Response;

  if (!response.ok) {
    throw new Error(
      `Failed to fetch shipping zones: ${response.status} ${response.statusText}`,
    );
  }

  const body = (await response.json()) as { shipping_zones?: RawShippingZone[] };
  const zones = Array.isArray(body.shipping_zones) ? body.shipping_zones : [];

  return extractRates(zones);
}

export async function syncShippingMethodSettings(shop: string) {
  const rates = await fetchShippingRates(shop);

  const existing = await getShippingMethodSettings(shop);

  const merged: ShippingMethodSettings = {};

  rates.forEach((rate) => {
    const prev = existing[rate.key];
    merged[rate.key] = {
      title: rate.title,
      enabled: prev?.enabled ?? true,
      price: rate.price,
      currency: rate.currency,
    };
  });

  await db.shopSetting.upsert({
    where: { shopId: shop },
    create: {
      shopId: shop,
      shippingMethodSettings: merged,
    },
    update: {
      shippingMethodSettings: merged,
    },
  });

  return merged;
}

export async function setShippingMethodEnabled(
  shop: string,
  key: string,
  enabled: boolean,
) {
  const existing = await getShippingMethodSettings(shop);

  const next: ShippingMethodSettings = {
    ...existing,
    [key]: {
      title: existing[key]?.title ?? key,
      enabled,
      price: existing[key]?.price ?? "",
      currency: existing[key]?.currency ?? null,
    },
  };

  await db.shopSetting.upsert({
    where: { shopId: shop },
    create: { shopId: shop, shippingMethodSettings: next },
    update: { shippingMethodSettings: next },
  });

  return next;
}
