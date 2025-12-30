-- CreateTable
CREATE TABLE "ShipByRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "orderId" BIGINT NOT NULL,
    "shipByDate" DATETIME NOT NULL,
    "deliveryDate" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "ShipByRecord_shopId_shipByDate_idx" ON "ShipByRecord"("shopId", "shipByDate");

-- CreateIndex
CREATE UNIQUE INDEX "ShipByRecord_shopId_orderId_key" ON "ShipByRecord"("shopId", "orderId");
