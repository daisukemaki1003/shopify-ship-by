import type {ProductRule} from "./rule-types";

// 商品別設定・日数の初期値
export const DEFAULT_PRODUCT_DAYS = 1;

// 文字列化された targetId を配列の文字列 ID に戻す
export const parseTargetIds = (value: string | null): string[] => {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.map((v) => String(v)).filter(Boolean);
    }
  } catch {
    // fall through
  }
  return [value].filter(Boolean);
};

// ProductRuleの配列からユニークな商品IDを抽出する
export const collectUniqueProductIds = (rules: ProductRule[]): string[] => {
  return Array.from(new Set(rules.flatMap((rule) => rule.productIds)));
};
