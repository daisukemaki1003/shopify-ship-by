export type RawShippingRate = {
  code?: string | null;
  name?: string | null;
  service_code?: string | null;
  id?: number | string | null;
  price?: string | null;
  currency?: string | null;
};

export type RawShippingZone = {
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

export const parseShippingRates = (value: unknown): ShippingRateEntry[] => {
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

export const normalizeRate = (
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

export const extractRates = (zones: RawShippingZone[]): ShippingRateEntry[] => {
  const map = new Map<string, ShippingRateEntry>();

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

  return Array.from(map.values());
};
