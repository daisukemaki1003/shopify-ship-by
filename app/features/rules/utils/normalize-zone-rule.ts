import {parsePositiveInt} from "../../../shared/utils/validation.js";
import type {ProductRule} from "./rule-types";

// クライアントから受け取る生ペイロード
export type ZoneRulePayload = {
  zoneKey: string;
  base: {id: string | null; days: string};
  productRules: ProductRule[];
};

// 入力値を検証し、DB保存に使える形へ正規化
export const normalizeZoneRulePayload = (
  payload: ZoneRulePayload | null,
  expectedZoneKey: string,
): {ok: false; message: string} | {ok: true; baseDays: number | null; productRules: ProductRule[]} => {
  if (!payload || payload.zoneKey !== expectedZoneKey) {
    return {ok: false, message: "配送エリアが一致しません"};
  }

  const errors: string[] = [];
  const rawBaseDays = String(payload.base.days ?? "").trim();
  let parsedBaseDays: number | null = null;
  if (rawBaseDays !== "") {
    parsedBaseDays = parsePositiveInt(rawBaseDays);
    if (!parsedBaseDays) {
      errors.push("基本設定の出荷日数は1以上の整数で入力してください");
    }
  }

  const normalizedProductRules: ProductRule[] = payload.productRules.map((rule, idx) => {
    const parsedDays = parsePositiveInt(rule.days);

    if (!rule.productIds || rule.productIds.length === 0) {
      errors.push(`商品別設定${idx + 1}: 商品を選択してください`);
    }
    if (!parsedDays) {
      errors.push(`商品別設定${idx + 1}: 出荷日数は1以上の整数で入力してください`);
    }
    return {...rule, days: parsedDays ?? 1};
  });

  if (errors.length > 0) {
    return {ok: false, message: errors.join(" / ")};
  }

  return {
    ok: true,
    baseDays: parsedBaseDays,
    productRules: normalizedProductRules,
  };
};
