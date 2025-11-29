import assert from "node:assert/strict";
import test from "node:test";

import { calculateShipBy, toISODate } from "./ship-by.server.js";

const baseSetting = {
  deliverySource: "metafield" as const,
  deliveryKey: "shipping.requested_date",
  deliveryFormat: "YYYY-MM-DD",
  shippingMethodSettings: {
    yamato_cool: { title: "Yamato Cool", enabled: true },
    sagawa_regular: { title: "Sagawa Regular", enabled: false },
  },
};

test("配送方法ルールで最大daysを採用してship-byを計算する", () => {
  const order = {
    id: 1,
    shipping_lines: [{ code: "yamato_cool" }],
    shipping_address: { province_code: "JP-01" },
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
      id: "all-products",
      targetType: "all_products" as const,
      targetId: null,
      prefectures: ["hokkaido"],
      days: 2,
      enabled: true,
    },
    {
      id: "shipping-specific",
      targetType: "shipping_method" as const,
      targetId: "yamato_cool",
      prefectures: ["hokkaido"],
      days: 3,
      enabled: true,
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
  assert.deepEqual(result.value.matchedRuleIds, ["shipping-specific"]);
  assert.equal(toISODate(result.value.shipBy), "2025-05-07");
});

test("週次と単発の休業日を考慮して前営業日に繰り下げる", () => {
  const order = {
    id: 2,
    shipping_lines: [{ code: "yamato_cool" }],
    shipping_address: { province_code: "JP-13" },
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
      id: "tokyo-all",
      targetType: "all_products" as const,
      targetId: null,
      prefectures: ["tokyo"],
      days: 1,
      enabled: true,
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
    shipping_lines: [{ code: "yamato_cool" }],
    shipping_address: { province_code: "JP-01" },
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
      id: "hokkaido-all",
      targetType: "all_products" as const,
      targetId: null,
      prefectures: ["hokkaido"],
      days: 1,
      enabled: true,
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

test("設定で配送方法が無効ならエラーにする", () => {
  const order = {
    id: 4,
    shipping_lines: [{ code: "sagawa_regular" }],
    shipping_address: { province_code: "JP-12" },
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
      id: "chiba-all",
      targetType: "all_products" as const,
      targetId: null,
      prefectures: ["chiba"],
      days: 2,
      enabled: true,
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
  assert.equal(result.error, "shipping_method_disabled");
});

test("都道府県が合致しない場合はno_ruleエラー", () => {
  const order = {
    id: 5,
    shipping_lines: [{ code: "yamato_cool" }],
    shipping_address: { province_code: "JP-47" },
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
      id: "kantou",
      targetType: "all_products" as const,
      targetId: null,
      prefectures: ["tokyo", "kanagawa"],
      days: 1,
      enabled: true,
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
