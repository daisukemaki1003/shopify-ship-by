-- CreateTable
CREATE TABLE "Rule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "prefectures" TEXT NOT NULL,
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
    "shippingMethodSettings" TEXT,
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

-- CreateIndex
CREATE INDEX "Rule_shopId_idx" ON "Rule"("shopId");

-- CreateIndex
CREATE INDEX "ErrorLog_shopId_idx" ON "ErrorLog"("shopId");

-- CreateIndex
CREATE INDEX "ErrorLog_shopId_orderId_idx" ON "ErrorLog"("shopId", "orderId");

-- CreateIndex
CREATE UNIQUE INDEX "Shop_shopDomain_key" ON "Shop"("shopDomain");
