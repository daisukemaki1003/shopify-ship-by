import assert from "node:assert/strict";
import test from "node:test";

import { extractRates } from "./utils/shipping-rate-normalize.js";

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

test("extractRates: zone without rates generates pseudo rate", () => {
  const rates = extractRates([zoneWithNoRates]);

  assert.equal(rates.length, 1);
  assert.equal(rates[0]?.shippingRateId, "zone:123");
  assert.equal(rates[0]?.handle, "北海道");
  assert.equal(rates[0]?.title, "北海道");
  assert.equal(rates[0]?.zoneName, "北海道");
});

test("extractRates: normalize rate values and de-duplicate by id", () => {
  const rates = extractRates([zoneWithRates]);

  assert.equal(rates.length, 1);
  assert.equal(rates[0]?.shippingRateId, "456");
  assert.equal(rates[0]?.handle, "exp");
  assert.equal(rates[0]?.title, "Express");
  assert.equal(rates[0]?.zoneName, "本州");
});
