/*
  Warnings:

  - You are about to alter the column `rawData` on the `ErrorLog` table. The data in that column could be lost. The data in that column will be cast from `String` to `Json`.
  - You are about to alter the column `holidays` on the `Holiday` table. The data in that column could be lost. The data in that column will be cast from `String` to `Json`.
  - You are about to alter the column `weeklyHolidays` on the `Holiday` table. The data in that column could be lost. The data in that column will be cast from `String` to `Json`.
  - You are about to drop the column `enabled` on the `ShippingRate` table. All the data in the column will be lost.
  - You are about to alter the column `shippingRates` on the `ShopSetting` table. The data in that column could be lost. The data in that column will be cast from `String` to `Json`.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ErrorLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "orderId" BIGINT NOT NULL,
    "reason" TEXT NOT NULL,
    "rawData" JSONB,
    "memo" TEXT,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_ErrorLog" ("createdAt", "id", "memo", "orderId", "rawData", "reason", "resolved", "shopId", "updatedAt") SELECT "createdAt", "id", "memo", "orderId", "rawData", "reason", "resolved", "shopId", "updatedAt" FROM "ErrorLog";
DROP TABLE "ErrorLog";
ALTER TABLE "new_ErrorLog" RENAME TO "ErrorLog";
CREATE INDEX "ErrorLog_shopId_idx" ON "ErrorLog"("shopId");
CREATE INDEX "ErrorLog_shopId_orderId_idx" ON "ErrorLog"("shopId", "orderId");
CREATE TABLE "new_Holiday" (
    "shopId" TEXT NOT NULL PRIMARY KEY,
    "holidays" JSONB NOT NULL DEFAULT [],
    "weeklyHolidays" JSONB NOT NULL DEFAULT [],
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Holiday" ("createdAt", "holidays", "shopId", "updatedAt", "weeklyHolidays") SELECT "createdAt", "holidays", "shopId", "updatedAt", "weeklyHolidays" FROM "Holiday";
DROP TABLE "Holiday";
ALTER TABLE "new_Holiday" RENAME TO "Holiday";
CREATE TABLE "new_RuleShippingRate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "shippingRateId" TEXT NOT NULL,
    "shippingRateShopId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RuleShippingRate_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "Rule" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RuleShippingRate_shippingRateShopId_shippingRateId_fkey" FOREIGN KEY ("shippingRateShopId", "shippingRateId") REFERENCES "ShippingRate" ("shopId", "shippingRateId") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_RuleShippingRate" ("createdAt", "id", "ruleId", "shippingRateId", "shippingRateShopId", "shopId", "updatedAt") SELECT "createdAt", "id", "ruleId", "shippingRateId", "shippingRateShopId", "shopId", "updatedAt" FROM "RuleShippingRate";
DROP TABLE "RuleShippingRate";
ALTER TABLE "new_RuleShippingRate" RENAME TO "RuleShippingRate";
CREATE INDEX "RuleShippingRate_shopId_idx" ON "RuleShippingRate"("shopId");
CREATE INDEX "RuleShippingRate_ruleId_idx" ON "RuleShippingRate"("ruleId");
CREATE INDEX "RuleShippingRate_shippingRateId_idx" ON "RuleShippingRate"("shippingRateId");
CREATE UNIQUE INDEX "RuleShippingRate_shopId_ruleId_shippingRateId_key" ON "RuleShippingRate"("shopId", "ruleId", "shippingRateId");
CREATE TABLE "new_ShippingRate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "shippingRateId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "zoneName" TEXT,
    "syncedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_ShippingRate" ("createdAt", "handle", "id", "shippingRateId", "shopId", "syncedAt", "title", "updatedAt", "zoneName") SELECT "createdAt", "handle", "id", "shippingRateId", "shopId", "syncedAt", "title", "updatedAt", "zoneName" FROM "ShippingRate";
DROP TABLE "ShippingRate";
ALTER TABLE "new_ShippingRate" RENAME TO "ShippingRate";
CREATE INDEX "ShippingRate_shopId_idx" ON "ShippingRate"("shopId");
CREATE UNIQUE INDEX "ShippingRate_shopId_shippingRateId_key" ON "ShippingRate"("shopId", "shippingRateId");
CREATE TABLE "new_ShopSetting" (
    "shopId" TEXT NOT NULL PRIMARY KEY,
    "deliverySource" TEXT,
    "deliveryKey" TEXT,
    "deliveryFormat" TEXT,
    "defaultLeadDays" INTEGER,
    "saveTag" BOOLEAN NOT NULL DEFAULT false,
    "saveTagFormat" TEXT,
    "saveNote" BOOLEAN NOT NULL DEFAULT false,
    "saveNoteFormat" TEXT,
    "saveMetafield" BOOLEAN NOT NULL DEFAULT true,
    "language" TEXT,
    "shippingRates" JSONB NOT NULL DEFAULT [],
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_ShopSetting" ("createdAt", "deliveryFormat", "deliveryKey", "deliverySource", "language", "saveMetafield", "saveNote", "saveNoteFormat", "saveTag", "saveTagFormat", "shippingRates", "shopId", "updatedAt") SELECT "createdAt", "deliveryFormat", "deliveryKey", "deliverySource", "language", "saveMetafield", "saveNote", "saveNoteFormat", "saveTag", "saveTagFormat", "shippingRates", "shopId", "updatedAt" FROM "ShopSetting";
DROP TABLE "ShopSetting";
ALTER TABLE "new_ShopSetting" RENAME TO "ShopSetting";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
