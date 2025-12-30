# 配送ケース同期とキャッシュ

## 目的
Shopify の配送ゾーン/配送ケースを取得し、出荷ルールと計算に使える形でキャッシュする。

## 取得・キャッシュの流れ
- `getShippingRates(shop)`
  - `ShopSetting.shippingRates` のキャッシュを優先。
  - `updatedAt` が 6 時間以内ならキャッシュを返す。
  - キャッシュが古い場合は Shopify から再同期し、失敗時はキャッシュ/DB にフォールバック。
- `syncShippingRates(shop)`
  - Shopify Admin REST `shipping_zones.json` を取得。
  - `ShippingRate` と `ShopSetting.shippingRates` を更新。

## 正規化ルール
- `shippingRateId` は `id / code / service_code / name` の順で決定。
- `handle` と `title` も空文字を避けて補完。
- 配送ゾーンに配送ケースがない場合は疑似レートを生成:
  - `shippingRateId = zone:{zoneId or zoneName}`
  - `title / handle = zoneName`

## デバッグ
- `DEBUG_SHIPPING_RATES=1` でログ出力。

