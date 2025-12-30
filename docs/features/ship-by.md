# 出荷日計算（ship-by）

## 目的
注文データから出荷期限日（ship-by date）を算出し、メタフィールド・タグ・分析用レコードに保存する。

## 計算フロー
1. お届け希望日の取得
2. 配送ケースの特定
3. ルールの採用（該当なしは全体設定にフォールバック）
4. 休業日の補正（前営業日に繰り下げ）

### 1. お届け希望日の取得
- `ShopSetting.deliverySource` が `metafield` の場合は `namespace.key` を参照。
- `attributes` の場合は注文属性（attributes）を参照。
- フォーマットは `deliveryFormat` を使用し、未設定の場合は `YYYY-MM-DD`。

エラー:
- `missing_setting` : 取得元/キーが未設定
- `delivery_value_not_found` : 注文に値が見つからない
- `invalid_delivery_format` : フォーマット不一致

### 2. 配送ケースの特定
- `ShopSetting.shippingRates` に保存された配送ケース一覧から一致を探す。
- 参照候補は `shipping_lines` の `shipping_rate_handle / code / delivery_category / title / id` と
  `metafields / attributes` の文字列値。
- 正規化は `trim + lower + 空白/ハイフン -> _`。

エラー:
- `shipping_rate_not_configured` : 配送ケースが未設定
- `shipping_rate_not_found` : 候補に一致なし

### 3. ルールの採用（優先順位）
優先順位は以下の順で最初に一致した集合から「最大 days」を採用。
1. `product` かつ `shippingRate` 指定あり
2. `product` かつ `shippingRate` 指定なし
3. `all` かつ `shippingRate` 指定あり
4. `all` かつ `shippingRate` 指定なし

- `RuleLike.targetId` は文字列として扱われ、商品IDと完全一致した場合のみ一致とみなす。
- ルールが見つからない場合は `no_rule`。

### 4. 休業日の補正
- `Holiday.holidays`（単発）と `Holiday.weeklyHolidays`（曜日）を参照。
- 該当する場合は 1 日ずつ遡る。
- 366 日探索して解決しない場合は `holiday_never_resolves`。

## フォールバック
- `defaultLeadDays` が設定されている場合、ルール不一致や配送ケース不一致時にフォールバック適用。

## 保存（orders/create）
- 成功時:
  - `ShipByRecord` を upsert
  - `saveMetafield !== false` の場合、`shipping.ship_by` を `YYYY-MM-DD` で保存
  - `saveTag === true` の場合、タグを保存（既定: `ship-by-{YYYY}-{MM}-{DD}`）
- 失敗時:
  - `ErrorLog` に記録（`reason` と `rawData`）

## 付随処理
- `afterAuth` フックで ship-by メタフィールド定義を作成。

