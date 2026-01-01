import assert from "node:assert/strict";
import test from "node:test";

import {
  extractRates,
  normalizeRate,
  parseShippingRates,
} from "../utils/shipping-rate-normalize.js";

const zoneWithNoRates = {
  id: 123,
  name: "北海道",
  shipping_rates: [],
  price_based_shipping_rates: [],
  weight_based_shipping_rates: [],
};

const zoneWithRates = {
  id: "zone-a",
  name: "本州",
  shipping_rates: [
    { id: 456, name: "Express", service_code: "exp" },
    { id: 456, name: "Express Duplicate", service_code: "exp" },
  ],
};

test("parseShippingRates: 配列以外は空配列になる", () => {
  const rates = parseShippingRates("invalid");
  assert.deepEqual(rates, []);
});

test("parseShippingRates: handleのみでもshippingRateIdに補完する", () => {
  const rates = parseShippingRates([{ handle: "fast", title: "Fast" }]);
  assert.equal(rates.length, 1);
  assert.equal(rates[0]?.shippingRateId, "fast");
  assert.equal(rates[0]?.handle, "fast");
  assert.equal(rates[0]?.title, "Fast");
});

test("extractRates: 配送ケースがないゾーンは疑似レートを生成する", () => {
  const rates = extractRates([zoneWithNoRates]);

  assert.equal(rates.length, 1);
  assert.equal(rates[0]?.shippingRateId, "zone:123");
  assert.equal(rates[0]?.handle, "北海道");
  assert.equal(rates[0]?.title, "北海道");
  assert.equal(rates[0]?.zoneName, "北海道");
});

test("extractRates: レート情報を正規化しIDで重複排除する", () => {
  const rates = extractRates([zoneWithRates]);

  assert.equal(rates.length, 1);
  assert.equal(rates[0]?.shippingRateId, "456");
  assert.equal(rates[0]?.handle, "exp");
  assert.equal(rates[0]?.title, "Express");
  assert.equal(rates[0]?.zoneName, "本州");
});

test("normalizeRate: idがなくてもnameから補完する", () => {
  const normalized = normalizeRate({ name: "Express" }, "関東");
  assert.ok(normalized);
  if (!normalized) return;
  assert.equal(normalized.shippingRateId, "Express");
  assert.equal(normalized.handle, "Express");
  assert.equal(normalized.title, "Express");
  assert.equal(normalized.zoneName, "関東");
});

test("extractRates: ゾーン名が空なら疑似レートを生成しない", () => {
  const rates = extractRates([
    { id: 999, name: "", shipping_rates: [], price_based_shipping_rates: [], weight_based_shipping_rates: [] },
  ]);

  assert.equal(rates.length, 0);
});
