export const UNKNOWN_ZONE_KEY = "__unknown__";

export const toZoneKey = (zoneName: string | null | undefined): string => {
  const normalized = zoneName?.trim();
  return normalized ? normalized : UNKNOWN_ZONE_KEY;
};

export const toZoneLabel = (zoneName: string | null | undefined): string => {
  const normalized = zoneName?.trim();
  return normalized ? normalized : "（不明）";
};

