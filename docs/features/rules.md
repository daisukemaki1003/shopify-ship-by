# 出荷ルール

## 目的
配送エリアごとに、出荷日数を設定する。

## データ構成
- `Rule` : 出荷日数の定義（`targetType=all|product`）
- `RuleShippingRate` : ルールと配送ケースの関連
- `ShippingRate` : 配送ケースキャッシュ（`shippingRateId/handle/title/zoneName`）

`targetType=product` の場合、`Rule.targetId` は商品ID配列を JSON 文字列化した値を保持する。

## 配送エリアと zoneKey
- `zoneKey` は `zoneName` をトリムして生成。
- `zoneName` が空の場合は `__unknown__` を使用。

## 一覧画面の集計
- `RuleShippingRate` と `ShippingRate` を突合し、配送エリアごとの件数を算出。
- 基本設定（日）は `targetType=all` の最新更新ルールを採用。
- 商品別設定の件数は `targetType=product` の件数をカウント。

## 詳細画面の保存
- 基本設定は未入力可。入力がある場合のみ `Rule(targetType=all)` を作成/更新する。
- 未入力の場合は、その配送エリアに紐づく `RuleShippingRate` を削除し、孤立した `Rule` を削除。
- 商品別設定は行ごとに `Rule(targetType=product)` を upsert。
- 保存時は「配送エリア内のすべての配送ケース」に対して `RuleShippingRate` を作成する。
- 画面で削除した商品別設定は `RuleShippingRate` を削除し、孤立した `Rule` を削除。

## 削除（一覧の一括削除）
- 選択した配送エリアに属する `RuleShippingRate` を削除。
- 他の配送エリアに紐づいていない `Rule` は削除する。

## UI 仕様
- 追加時の初期日数は `DEFAULT_PRODUCT_DAYS = 1`。
- 商品選択は Shopify Resource Picker を使用。
