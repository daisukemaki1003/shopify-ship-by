-- Create junction table for Rule and ShippingRate, migrate existing data, drop shippingRateIds column.

PRAGMA foreign_keys=OFF;

CREATE TABLE "RuleShippingRate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "shippingRateId" TEXT NOT NULL,
    "shippingRateShopId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RuleShippingRate_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "Rule" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RuleShippingRate_shippingRate_fkey" FOREIGN KEY ("shippingRateShopId", "shippingRateId") REFERENCES "ShippingRate" ("shopId", "shippingRateId") ON DELETE CASCADE ON UPDATE CASCADE
);

-- 移行: 既存の shippingRateIds 配列から中間テーブルを生成
INSERT INTO "RuleShippingRate" ("id", "shopId", "ruleId", "shippingRateId", "shippingRateShopId", "createdAt", "updatedAt")
SELECT
    printf('rsr_%s_%s_%s', r."id", r."shopId", json_each.value) AS id,
    r."shopId",
    r."id",
    json_each.value AS shippingRateId,
    r."shopId" AS shippingRateShopId,
    COALESCE(r."createdAt", CURRENT_TIMESTAMP),
    COALESCE(r."updatedAt", CURRENT_TIMESTAMP)
FROM "Rule" r
JOIN json_each(r."shippingRateIds")
WHERE json_valid(r."shippingRateIds")
  AND json_type(r."shippingRateIds") = 'array'
  AND json_each.value IS NOT NULL;

-- RuleテーブルからshippingRateIdsカラムを除去するため再作成
CREATE TABLE "Rule_new" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "days" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

INSERT INTO "Rule_new" ("id", "shopId", "targetType", "targetId", "days", "createdAt", "updatedAt")
SELECT "id", "shopId", "targetType", "targetId", "days", "createdAt", "updatedAt" FROM "Rule";

DROP TABLE "Rule";
ALTER TABLE "Rule_new" RENAME TO "Rule";

CREATE INDEX "Rule_shopId_idx" ON "Rule"("shopId");

CREATE INDEX "RuleShippingRate_shopId_idx" ON "RuleShippingRate"("shopId");
CREATE INDEX "RuleShippingRate_ruleId_idx" ON "RuleShippingRate"("ruleId");
CREATE INDEX "RuleShippingRate_shippingRateId_idx" ON "RuleShippingRate"("shippingRateId");
CREATE UNIQUE INDEX "RuleShippingRate_shop_rule_rate_key" ON "RuleShippingRate"("shopId", "ruleId", "shippingRateId");

PRAGMA foreign_keys=ON;
