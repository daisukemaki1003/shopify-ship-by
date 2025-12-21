/* eslint-env node */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const shopId = "dev-shop.myshopify.com";

async function main() {
  await prisma.shop.upsert({
    where: { id: shopId },
    update: { shopDomain: shopId, scope: "read_orders,write_orders" },
    create: {
      id: shopId,
      shopDomain: shopId,
      scope: "read_orders,write_orders",
      installedAt: new Date(),
    },
  });

  await prisma.shopSetting.upsert({
    where: { shopId },
    update: {},
    create: {
      shopId,
      deliverySource: "metafield",
      deliveryKey: "shipping.requested_date",
      deliveryFormat: "YYYY-MM-DD",
      saveMetafield: false,
      saveTag: true,
      saveTagFormat: "ship-by-{YYYY}-{MM}-{DD}",
      language: "ja",
      shippingRates: [
        {
          shippingRateId: "sr_yamato_cool",
          handle: "yamato_cool",
          title: "ヤマト クール便",
          zoneName: "Japan",
        },
        {
          shippingRateId: "sr_sagawa_regular",
          handle: "sagawa_regular",
          title: "佐川 通常便",
          zoneName: "Japan",
        },
      ],
    },
  });

  await prisma.holiday.upsert({
    where: { shopId },
    update: {},
    create: {
      shopId,
      holidays: [],
      weeklyHolidays: ["sun"],
    },
  });

  const ruleAll = await prisma.rule.upsert({
    where: { id: "rule-all" },
    update: { days: 2, targetType: "all", targetId: null, shopId },
    create: {
      id: "rule-all",
      shopId,
      targetType: "all",
      targetId: null,
      days: 2,
    },
  });

  await prisma.ruleShippingRate.upsert({
    where: {
      shopId_ruleId_shippingRateId: {
        shopId,
        ruleId: ruleAll.id,
        shippingRateId: "sr_yamato_cool",
      },
    },
    update: {},
    create: {
      shopId,
      ruleId: ruleAll.id,
      shippingRateId: "sr_yamato_cool",
      shippingRateShopId: shopId,
    },
  });

  const ruleProduct = await prisma.rule.upsert({
    where: { id: "rule-shipping-cool" },
    update: {
      days: 3,
      targetType: "product",
      targetId: "sample-product-id",
      shopId,
    },
    create: {
      id: "rule-shipping-cool",
      shopId,
      targetType: "product",
      targetId: "sample-product-id",
      days: 3,
    },
  });

  await prisma.ruleShippingRate.upsert({
    where: {
      shopId_ruleId_shippingRateId: {
        shopId,
        ruleId: ruleProduct.id,
        shippingRateId: "sr_yamato_cool",
      },
    },
    update: {},
    create: {
      shopId,
      ruleId: ruleProduct.id,
      shippingRateId: "sr_yamato_cool",
      shippingRateShopId: shopId,
    },
  });
}

main()
  .catch((e) => {
    console.error("Seed failed", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
