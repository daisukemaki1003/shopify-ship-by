# 全体設定

## 目的
出荷日計算の基準値と、お届け希望日の取得方法、保存先（タグ）を設定する。

## 保存項目（ShopSetting）
- `defaultLeadDays` : 必須。1以上の整数。
- `deliverySource` : `metafield` / `attributes` のいずれか（必須）。
- `deliveryKey` : 取得キー（必須）。
- `deliveryFormat` : 日付パースフォーマット（任意、未入力時は `YYYY-MM-DD` を適用）。
- `saveTag` : タグ保存の ON/OFF（任意）。
- `saveTagFormat` : タグ保存フォーマット（未入力時は既定フォーマット）。
- `saveMetafield` : UI からは常に `true` で保存（メタフィールド保存は常時有効）。

## 取得設定の動作
- メタフィールド選択時、ORDER のメタフィールド定義候補を GraphQL で取得し Autocomplete に表示。
- 候補外のキーを入力すると「未検出」として警告表示。
- 注文属性（attributes）を選択した場合はキー入力のみ。
- フォーマットはプリセット選択と手入力に対応。サンプル値を入力すると解析結果を表示。

## バリデーション
- `defaultLeadDays` が 1 以上の整数でない場合はエラー。
- `deliverySource` と `deliveryKey` が未入力の場合はエラー。
- エラーはバナーとフィールドエラーで表示され、保存は実行されない。

## 補足
- `defaultLeadDays` が未設定の場合、出荷ルール画面の操作は無効化される。

