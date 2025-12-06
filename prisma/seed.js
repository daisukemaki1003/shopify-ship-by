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
      saveMetafield: true,
      saveTag: true,
      saveTagFormat: "ship-by-{YYYY}-{MM}-{DD}",
      saveNote: true,
      saveNoteFormat: "出荷期限：{YYYY}-{MM}-{DD}",
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

  await prisma.rule.createMany({
    skipDuplicates: true,
    data: [
      {
        id: "rule-all",
        shopId,
        targetType: "all",
        targetId: null,
        shippingRateIds: ["sr_yamato_cool"],
        days: 2,
      },
      {
        id: "rule-shipping-cool",
        shopId,
        targetType: "product",
        targetId: "sample-product-id",
        shippingRateIds: ["sr_yamato_cool"],
        days: 3,
      },
    ],
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
