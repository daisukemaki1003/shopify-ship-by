import prisma from "../../../db.server";
import { apiVersion } from "../../../shopify.server";
import { getAdminClient } from "../../../server/admin-client.server";

type RawShippingRate = {
  code?: string | null;
  name?: string | null;
  service_code?: string | null;
  id?: number | string | null;
  price?: string | null;
  currency?: string | null;
};

type RawShippingZone = {
  id?: number | string | null;
  name?: string | null;
  carrier_shipping_rate_providers?: Array<Record<string, unknown>> | null;
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

const shouldDebugShippingRates = () => process.env.DEBUG_SHIPPING_RATES === "1";

const debugShippingRates = (...args: unknown[]) => {
  if (!shouldDebugShippingRates()) return;
  // eslint-disable-next-line no-console
  console.log("[shipping-rates]", ...args);
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
    rate.code ?? rate.service_code ?? rate.name ?? shippingRateId ?? "";

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

  debugShippingRates(
    "extractRates zones",
    zones.map((z) => ({
      id: z?.id ?? null,
      name: z?.name ?? null,
      carrier_shipping_rate_providers: Array.isArray(z?.carrier_shipping_rate_providers)
        ? z.carrier_shipping_rate_providers.length
        : 0,
      shipping_rates: Array.isArray(z?.shipping_rates)
        ? z.shipping_rates.length
        : 0,
      price_based_shipping_rates: Array.isArray(z?.price_based_shipping_rates)
        ? z.price_based_shipping_rates.length
        : 0,
      weight_based_shipping_rates: Array.isArray(z?.weight_based_shipping_rates)
        ? z.weight_based_shipping_rates.length
        : 0,
    })),
  );

  zones.forEach((zone) => {
    const zoneName = zone?.name ?? null;
    const candidates = [
      ...(zone.shipping_rates ?? []),
      ...(zone.price_based_shipping_rates ?? []),
      ...(zone.weight_based_shipping_rates ?? []),
    ];

    if (candidates.length === 0) {
      const name = zoneName?.trim();
      if (!name) return;

      const zoneId =
        typeof zone?.id === "number"
          ? String(zone.id)
          : typeof zone?.id === "string"
            ? zone.id
            : null;

      const pseudo: ShippingRateEntry = {
        shippingRateId: zoneId ? `zone:${zoneId}` : `zone:${name}`,
        handle: name,
        title: name,
        zoneName: name,
      };

      if (!map.has(pseudo.shippingRateId)) {
        map.set(pseudo.shippingRateId, pseudo);
      }
      return;
    }

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

  const rates = Array.from(map.values());
  debugShippingRates("extractRates result", {
    rates: rates.length,
    distinctZones: Array.from(new Set(rates.map((r) => r.zoneName ?? null))),
  });
  return rates;
};

export async function fetchShippingRates(shop: string) {
  const { session, withRetry } = await getAdminClient(shop);
  const url = `https://${session.shop}/admin/api/${apiVersion}/shipping_zones.json`;

  debugShippingRates("fetchShippingRates start", { shop: session.shop, url });

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

  const body = (await response.json()) as {
    shipping_zones?: RawShippingZone[];
  };
  const zones = Array.isArray(body.shipping_zones) ? body.shipping_zones : [];

  debugShippingRates("fetchShippingRates response", {
    shipping_zones: zones.length,
    zoneNames: zones.map((z) => z?.name ?? null),
  });

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

export async function getShippingRates(
  shop: string,
  options?: { maxAgeMs?: number },
): Promise<ShippingRateEntry[]> {
  const maxAgeMs = options?.maxAgeMs ?? 1000 * 60 * 60 * 6; // 6 hours
  const setting = await prisma.shopSetting.findUnique({
    where: { shopId: shop },
    select: { shippingRates: true, updatedAt: true },
  });
  const cached = parseShippingRates(setting?.shippingRates);
  const isFresh = Boolean(
    setting?.updatedAt &&
      Date.now() - new Date(setting.updatedAt).getTime() <= maxAgeMs,
  );

  if (cached.length > 0 && isFresh) {
    debugShippingRates("getShippingRates cache hit", {
      shop,
      cached: cached.length,
      updatedAt: setting?.updatedAt ?? null,
    });
    return cached;
  }

  if (cached.length > 0) {
    debugShippingRates("getShippingRates cache stale; will sync", {
      shop,
      cached: cached.length,
      updatedAt: setting?.updatedAt ?? null,
      maxAgeMs,
    });
  }

  const dbRates = await prisma.shippingRate.findMany({
    where: { shopId: shop },
  });
  const dbNormalized = dbRates.map<ShippingRateEntry>((r) => ({
    shippingRateId: r.shippingRateId,
    handle: r.handle,
    title: r.title,
    zoneName: r.zoneName,
  }));

  if (dbRates.length > 0) {
    await prisma.shopSetting.upsert({
      where: { shopId: shop },
      create: { shopId: shop, shippingRates: dbNormalized },
      update: { shippingRates: dbNormalized },
    });
  }

  try {
    return await syncShippingRates(shop);
  } catch (error) {
    debugShippingRates(
      "getShippingRates sync failed; fallback to cached/db",
      error,
    );
    if (cached.length > 0) return cached;
    if (dbNormalized.length > 0) return dbNormalized;
    return [];
  }
}

export async function syncShippingRates(shop: string) {
  const rates = await fetchShippingRates(shop);
  await writeShippingRateCache(shop, rates);

  return rates;
}
