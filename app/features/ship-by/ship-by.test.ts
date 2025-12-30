import assert from "node:assert/strict";
import test from "node:test";

import { calculateShipBy, toISODate } from "./server/ship-by.server.js";

const baseSetting = {
  deliverySource: "metafield" as const,
  deliveryKey: "shipping.requested_date",
  deliveryFormat: "YYYY-MM-DD",
  shippingRates: [
    { shippingRateId: "sr_yamato_cool", handle: "yamato_cool", title: "Yamato Cool" },
    { shippingRateId: "sr_sagawa_regular", handle: "sagawa_regular", title: "Sagawa Regular" },
  ],
};

test("配送ケース優先順位で商品×ShippingRateの最大daysを採用する", () => {
  const order = {
    id: 1,
    shipping_lines: [{ code: "yamato_cool", id: "sr_yamato_cool" }],
    metafields: [
      {
        namespace: "shipping",
        key: "requested_date",
        value: "2025-05-10",
      },
    ],
    line_items: [{ product_id: 111 }],
  };

  const rules = [
    {
      id: "all-open",
      targetType: "all" as const,
      targetId: null,
      shippingRateIds: [],
      days: 1,
    },
    {
      id: "product-only",
      targetType: "product" as const,
      targetId: "111",
      shippingRateIds: [],
      days: 2,
    },
    {
      id: "product-with-rate",
      targetType: "product" as const,
      targetId: "111",
      shippingRateIds: ["sr_yamato_cool"],
      days: 3,
    },
  ];

  const result = calculateShipBy({
    order,
    rules,
    shopSetting: baseSetting,
    holiday: { holidays: [], weeklyHolidays: [] },
  });

  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("calculation failed");

  assert.equal(result.value.adoptDays, 3);
  assert.deepEqual(result.value.matchedRuleIds, ["product-with-rate"]);
  assert.equal(toISODate(result.value.shipBy), "2025-05-07");
});

test("週次と単発の休業日を考慮して前営業日に繰り下げる", () => {
  const order = {
    id: 2,
    shipping_lines: [{ code: "yamato_cool", id: "sr_yamato_cool" }],
    metafields: [
      {
        namespace: "shipping",
        key: "requested_date",
        value: "2025-05-05",
      },
    ],
    line_items: [{ product_id: 222 }],
  };

  const rules = [
    {
      id: "all-yamato",
      targetType: "all" as const,
      targetId: null,
      shippingRateIds: ["sr_yamato_cool"],
      days: 1,
    },
  ];

  const result = calculateShipBy({
    order,
    rules,
    shopSetting: baseSetting,
    holiday: { holidays: ["2025-05-03"], weeklyHolidays: ["sun"] },
  });

  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("calculation failed");

  assert.equal(toISODate(result.value.adjustedFrom), "2025-05-04");
  assert.equal(toISODate(result.value.shipBy), "2025-05-02");
});

test("お届け日フォーマット不一致ならエラーを返す", () => {
  const order = {
    id: 3,
    shipping_lines: [{ code: "yamato_cool", id: "sr_yamato_cool" }],
    metafields: [
      {
        namespace: "shipping",
        key: "requested_date",
        value: "05/10/2025",
      },
    ],
  };

  const rules = [
    {
      id: "all-yamato",
      targetType: "all" as const,
      targetId: null,
      shippingRateIds: ["sr_yamato_cool"],
      days: 1,
    },
  ];

  const result = calculateShipBy({
    order,
    rules,
    shopSetting: baseSetting,
    holiday: { holidays: [], weeklyHolidays: [] },
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error, "invalid_delivery_format");
});

test("配送ケース不一致ならno_ruleエラー", () => {
  const order = {
    id: 4,
    shipping_lines: [{ code: "yamato_cool", id: "sr_yamato_cool" }],
    metafields: [
      {
        namespace: "shipping",
        key: "requested_date",
        value: "2025-05-10",
      },
    ],
  };

  const rules = [
    {
      id: "different-rate",
      targetType: "all" as const,
      targetId: null,
      shippingRateIds: ["sr_other"],
      days: 1,
    },
  ];

  const result = calculateShipBy({
    order,
    rules,
    shopSetting: baseSetting,
    holiday: { holidays: [], weeklyHolidays: [] },
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error, "no_rule");
});

test("ルールがない場合は全体設定の日数を採用する", () => {
  const order = {
    id: 5,
    shipping_lines: [{ code: "yamato_cool", id: "sr_yamato_cool" }],
    metafields: [
      {
        namespace: "shipping",
        key: "requested_date",
        value: "2025-05-10",
      },
    ],
  };

  const result = calculateShipBy({
    order,
    rules: [],
    shopSetting: {
      ...baseSetting,
      defaultLeadDays: 2,
    },
    holiday: { holidays: [], weeklyHolidays: [] },
  });

  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("calculation failed");

  assert.equal(result.value.adoptDays, 2);
  assert.deepEqual(result.value.matchedRuleIds, []);
  assert.equal(toISODate(result.value.shipBy), "2025-05-08");
});
