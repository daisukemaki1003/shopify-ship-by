import assert from "node:assert/strict";
import test from "node:test";

import {
  adjustForHolidays,
  calculateShipBy,
  detectShippingRate,
  parseDeliveryDate,
  pickAdoptedRule,
  toISODate,
} from "../server/ship-by.server.js";

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

test("お届け希望日の取得設定が未入力ならmissing_settingエラーになる", () => {
  const result = parseDeliveryDate(
    { attributes: [] },
    { deliverySource: null, deliveryKey: null },
  );

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error, "missing_setting");
});

test("お届け希望日が見つからない場合はdelivery_value_not_foundエラーになる", () => {
  const result = parseDeliveryDate(
    { attributes: [] },
    {
      deliverySource: "attributes",
      deliveryKey: "requested_date",
      deliveryFormat: "YYYY-MM-DD",
    },
  );

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error, "delivery_value_not_found");
});

test("不正な日付ならinvalid_delivery_formatエラーになる", () => {
  const result = parseDeliveryDate(
    {
      metafields: [
        { namespace: "shipping", key: "requested_date", value: "2025-02-30" },
      ],
    },
    {
      deliverySource: "metafield",
      deliveryKey: "shipping.requested_date",
      deliveryFormat: "YYYY-MM-DD",
    },
  );

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error, "invalid_delivery_format");
});

test("属性の数値でもお届け希望日をパースできる", () => {
  const result = parseDeliveryDate(
    {
      attributes: [{ name: "requested_date", value: 20251224 }],
    },
    {
      deliverySource: "attributes",
      deliveryKey: "requested_date",
      deliveryFormat: "YYYYMMDD",
    },
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(toISODate(result.value), "2025-12-24");
});

test("配送ケースが未設定ならshipping_rate_not_configuredエラーになる", () => {
  const result = detectShippingRate(
    { shipping_lines: [{ code: "yamato_cool" }] },
    { shippingRates: [] },
  );

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error, "shipping_rate_not_configured");
});

test("配送ケースが一致しない場合はshipping_rate_not_foundエラーになる", () => {
  const result = detectShippingRate(
    { shipping_lines: [{ code: "yamato_cool" }] },
    {
      shippingRates: [
        { shippingRateId: "sr_other", handle: "sagawa", title: "Sagawa" },
      ],
    },
  );

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error, "shipping_rate_not_found");
});

test("最大日数が同じルールはmatchedRuleIdsに全件含まれる", () => {
  const result = pickAdoptedRule({
    shippingRateId: "sr_yamato_cool",
    productIds: ["111"],
    rules: [
      {
        id: "candidate-a",
        targetType: "product",
        targetId: "111",
        shippingRateIds: ["sr_yamato_cool"],
        days: 3,
      },
      {
        id: "candidate-b",
        targetType: "product",
        targetId: "111",
        shippingRateIds: ["sr_yamato_cool"],
        days: 3,
      },
      {
        id: "lower",
        targetType: "all",
        targetId: null,
        shippingRateIds: [],
        days: 1,
      },
    ],
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.days, 3);
  assert.deepEqual(result.value.ruleIds, ["candidate-a", "candidate-b"]);
});

test("休業日が全曜日ならholiday_never_resolvesエラーになる", () => {
  const result = adjustForHolidays(new Date(Date.UTC(2025, 0, 1)), {
    holidays: [],
    weeklyHolidays: ["sun", "mon", "tue", "wed", "thu", "fri", "sat"],
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error, "holiday_never_resolves");
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
