import assert from "node:assert/strict";
import test from "node:test";

import { normalizeZoneRulePayload } from "../utils/normalize-zone-rule.js";

const basePayload = {
  zoneKey: "tokyo",
  base: { id: null, days: "" },
  productRules: [],
};

test("normalizeZoneRulePayload: zoneKey不一致でエラーになる", () => {
  const result = normalizeZoneRulePayload(
    { ...basePayload, zoneKey: "osaka" },
    "tokyo",
  );

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.message, "配送エリアが一致しません");
});

test("normalizeZoneRulePayload: 基本設定が未入力でも成功する", () => {
  const result = normalizeZoneRulePayload(
    {
      ...basePayload,
      productRules: [{ id: null, productIds: ["gid://shopify/Product/1"], days: 2 }],
    },
    "tokyo",
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.baseDays, null);
  assert.equal(result.productRules[0]?.days, 2);
});

test("normalizeZoneRulePayload: 基本設定と商品別設定のエラーを結合して返す", () => {
  const result = normalizeZoneRulePayload(
    {
      ...basePayload,
      base: { id: null, days: "0" },
      productRules: [{ id: null, productIds: [], days: 0 }],
    },
    "tokyo",
  );

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.message, /基本設定の出荷リードタイムは1以上の整数/);
  assert.match(result.message, /商品別設定1: 商品を選択してください/);
  assert.match(result.message, /商品別設定1: 出荷リードタイムは1以上の整数/);
});
