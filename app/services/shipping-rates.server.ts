import prisma from "../db.server";
import { apiVersion } from "../shopify.server";
import { getAdminClient } from "./admin-client.server";

type RawShippingRate = {
  code?: string | null;
  name?: string | null;
  service_code?: string | null;
  id?: number | string | null;
  price?: string | null;
  currency?: string | null;
};

type RawShippingZone = {
  name?: string | null;
  shipping_rates?: RawShippingRate[] | null;
  price_based_shipping_rates?: RawShippingRate[] | null;
  weight_based_shipping_rates?: RawShippingRate[] | null;
};

export type ShippingRateEntry = {
  shippingRateId: string;
  handle: string;
  title: string;
  zoneName: string | null;
};

const parseShippingRates = (value: unknown): ShippingRateEntry[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const obj = item as Partial<ShippingRateEntry>;
      if (!obj) return null;
      const shippingRateId = obj.shippingRateId ?? obj.handle ?? obj.title;
      if (!shippingRateId) return null;
      return {
        shippingRateId: String(shippingRateId),
        handle: String(obj.handle ?? shippingRateId),
        title: String(obj.title ?? obj.handle ?? shippingRateId),
        zoneName: obj.zoneName ? String(obj.zoneName) : null,
      };
    })
    .filter((v): v is ShippingRateEntry => Boolean(v));
};

const normalizeRate = (
  rate: RawShippingRate,
  zoneName: string | null,
): ShippingRateEntry | null => {
  const shippingRateId =
    (typeof rate.id === "string" ? rate.id : null) ??
    (typeof rate.id === "number" ? String(rate.id) : null) ??
    rate.code ??
    rate.service_code ??
    rate.name;

  const handle =
    rate.code ?? rate.service_code ?? rate.name ?? (shippingRateId ?? "");

  const title = (rate.name ?? handle ?? shippingRateId ?? "").trim();

  const id = (shippingRateId ?? "").trim();
  const handleNormalized = (handle ?? "").trim();

  if (!id && !handleNormalized) return null;

  return {
    shippingRateId: id || handleNormalized,
    handle: handleNormalized || id,
    title: title || handleNormalized || id,
    zoneName: zoneName?.trim() || null,
  };
};

const extractRates = (zones: RawShippingZone[]): ShippingRateEntry[] => {
  const map = new Map<string, ShippingRateEntry>();

  zones.forEach((zone) => {
    const zoneName = zone?.name ?? null;
    const candidates = [
      ...(zone.shipping_rates ?? []),
      ...(zone.price_based_shipping_rates ?? []),
      ...(zone.weight_based_shipping_rates ?? []),
    ];

    candidates.forEach((rate) => {
      const normalized = normalizeRate(rate, zoneName);
      if (!normalized) return;

      const key = normalized.shippingRateId || normalized.handle;
      if (!key) return;

      if (!map.has(key)) {
        map.set(key, normalized);
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

const writeShippingRateCache = async (
  shop: string,
  rates: ShippingRateEntry[],
) => {
  const rateIds = rates.map((r) => r.shippingRateId);

  await prisma.$transaction([
    ...rates.map((rate) =>
      prisma.shippingRate.upsert({
        where: {
          shopId_shippingRateId: {
            shopId: shop,
            shippingRateId: rate.shippingRateId,
          },
        },
        create: {
          shopId: shop,
          shippingRateId: rate.shippingRateId,
          title: rate.title,
          handle: rate.handle,
          zoneName: rate.zoneName,
        },
        update: {
          title: rate.title,
          handle: rate.handle,
          zoneName: rate.zoneName,
          syncedAt: new Date(),
        },
      }),
    ),
    prisma.shippingRate.deleteMany({
      where: { shopId: shop, shippingRateId: { notIn: rateIds } },
    }),
    prisma.shopSetting.upsert({
      where: { shopId: shop },
      create: { shopId: shop, shippingRates: rates },
      update: { shippingRates: rates },
    }),
  ]);
};

export async function getShippingRates(shop: string): Promise<ShippingRateEntry[]> {
  const setting = await prisma.shopSetting.findUnique({ where: { shopId: shop } });
  const cached = parseShippingRates(setting?.shippingRates);
  if (cached.length > 0) return cached;

  const dbRates = await prisma.shippingRate.findMany({ where: { shopId: shop } });
  if (dbRates.length > 0) {
    const normalized = dbRates.map<ShippingRateEntry>((r) => ({
      shippingRateId: r.shippingRateId,
      handle: r.handle,
      title: r.title,
      zoneName: r.zoneName,
    }));
    await prisma.shopSetting.upsert({
      where: { shopId: shop },
      create: { shopId: shop, shippingRates: normalized },
      update: { shippingRates: normalized },
    });
    return normalized;
  }
  return [];
}

export async function syncShippingRates(shop: string) {
  const rates = await fetchShippingRates(shop);
  const existing = await prisma.shippingRate.findMany({ where: { shopId: shop } });
  await writeShippingRateCache(shop, rates);

  return rates;
}
