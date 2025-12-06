-- CreateTable
CREATE TABLE "Rule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "shippingRateIds" TEXT NOT NULL DEFAULT '[]',
    "days" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Holiday" (
    "shopId" TEXT NOT NULL PRIMARY KEY,
    "holidays" TEXT NOT NULL DEFAULT '[]',
    "weeklyHolidays" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ErrorLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "orderId" BIGINT NOT NULL,
    "reason" TEXT NOT NULL,
    "rawData" TEXT,
    "memo" TEXT,
    "resolved" BOOLEAN NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ShopSetting" (
    "shopId" TEXT NOT NULL PRIMARY KEY,
    "deliverySource" TEXT,
    "deliveryKey" TEXT,
    "deliveryFormat" TEXT,
    "saveTag" BOOLEAN NOT NULL DEFAULT 0,
    "saveTagFormat" TEXT,
    "saveNote" BOOLEAN NOT NULL DEFAULT 0,
    "saveNoteFormat" TEXT,
    "saveMetafield" BOOLEAN NOT NULL DEFAULT 1,
    "language" TEXT,
    "shippingRates" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Shop" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopDomain" TEXT,
    "accessToken" TEXT,
    "scope" TEXT,
    "installedAt" DATETIME,
    "uninstalledAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "ShippingRate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "shippingRateId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "zoneName" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT 1,
    "syncedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
-- CreateIndex
CREATE INDEX "Rule_shopId_idx" ON "Rule"("shopId");

-- CreateIndex
CREATE INDEX "ErrorLog_shopId_idx" ON "ErrorLog"("shopId");

-- CreateIndex
CREATE INDEX "ErrorLog_shopId_orderId_idx" ON "ErrorLog"("shopId", "orderId");

-- CreateIndex
CREATE UNIQUE INDEX "Shop_shopDomain_key" ON "Shop"("shopDomain");
CREATE INDEX "ShippingRate_shopId_idx" ON "ShippingRate"("shopId");
CREATE UNIQUE INDEX "ShippingRate_shopId_shippingRateId_key" ON "ShippingRate"("shopId", "shippingRateId");
