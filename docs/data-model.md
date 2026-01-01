# データモデル（SQLite / Prisma）

現行スキーマの要約です。正確な型は `prisma/schema.prisma` を参照してください。

## Enum
- `RuleTargetType`: `product` | `all`
- `DeliverySource`: `metafield` | `attributes`

---

## Session（セッション保持）
目的: Shopify OAuth で発行されるセッション情報（アクセストークン等）を保存。

| カラム | 型 | 説明 |
| --- | --- | --- |
| id | String (PK) | セッションID |
| shop | String | ショップドメイン |
| state | String | OAuth state |
| accessToken | String | Admin API アクセストークン |
| expires | DateTime? | 有効期限（オンラインセッション等） |
| isOnline | Boolean | オンラインセッションか |
| scope, userId, firstName, lastName, email, accountOwner, locale, collaborator, emailVerified | (各種) | Shopify 提供のユーザー情報 |

インデックス: なし（PK のみ）

---

## Shop（店舗メタ）
目的: 店舗メタデータ・インストール状態を保存。

| カラム | 型 | 説明 |
| --- | --- | --- |
| id | String (PK) | 店舗ID（shopドメインと同一） |
| shopDomain | String? (UNIQUE) | ドメイン |
| accessToken | String? | Admin API アクセストークン |
| scope | String? | インストール時スコープ |
| installedAt / uninstalledAt | DateTime? | インストール／アンインストール日時 |
| createdAt / updatedAt | DateTime | timestamps |

インデックス: `shopDomain` (UNIQUE)

---

## ShopSetting（店舗設定）
目的: お届け希望日の取得方法、出荷日数の基準、保存先、Shipping Rate キャッシュ。

| カラム | 型 | 説明 |
| --- | --- | --- |
| shopId | String (PK) | 店舗ID |
| deliverySource | DeliverySource? | `metafield` or `attributes` |
| deliveryKey | String? | 取得キー（例: `shipping.requested_date`） |
| deliveryFormat | String? | 日付パースフォーマット（例: `YYYY-MM-DD`） |
| defaultLeadDays | Int? | 設定の出荷リードタイム |
| saveTag | Boolean | タグ保存 ON/OFF |
| saveTagFormat | String? | タグ保存フォーマット |
| saveNote / saveNoteFormat | Boolean / String? | 現状 UI では未使用（スキーマに残置） |
| saveMetafield | Boolean | メタフィールド保存 ON/OFF（UI からは常に true） |
| language | String? | UI言語 |
| shippingRates | Json | Shipping Rate キャッシュ（`shippingRateId/handle/title/zoneName` の配列） |
| createdAt / updatedAt | DateTime | timestamps |

インデックス: なし（PK のみ）

---

## Rule（出荷ルール）
目的: 出荷日数を決めるルール（商品/全商品）。

| カラム | 型 | 説明 |
| --- | --- | --- |
| id | String (PK, cuid) | ルールID |
| shopId | String (idx) | 店舗ID |
| targetType | RuleTargetType | `product` / `all` |
| targetId | String? | `product` の場合は商品ID配列の JSON 文字列 |
| days | Int | 出荷日数（到着日の何日前に発送するか） |
| createdAt / updatedAt | DateTime | timestamps |

インデックス: `shopId`

---

## RuleShippingRate（ルールと配送ケースの中間テーブル）
目的: ルールと ShippingRate を正規化して関連付け、参照整合性を確保する。

| カラム | 型 | 説明 |
| --- | --- | --- |
| id | String (PK, cuid) | 中間レコードID |
| shopId | String (idx) | 店舗ID |
| ruleId | String | Rule への外部キー |
| shippingRateId | String | ShippingRate の business ID |
| shippingRateShopId | String | ShippingRate の shopId（複合FK用） |
| createdAt / updatedAt | DateTime | timestamps |

インデックス: `shopId`, `ruleId`, `shippingRateId`, `shopId + ruleId + shippingRateId (unique)`

---

## ShippingRate（配送ケースキャッシュ）
目的: `read_shipping` で取得した配送ケースを保存し、ルール作成で使用する。

| カラム | 型 | 説明 |
| --- | --- | --- |
| id | String (PK, cuid) | レコードID |
| shopId | String (idx) | 店舗ID |
| shippingRateId | String | Shopify の Shipping Rate ID |
| title | String | 表示名 |
| handle | String | code / handle |
| zoneName | String? | 所属配送ゾーン |
| syncedAt | DateTime | 同期日時 |
| createdAt / updatedAt | DateTime | timestamps |

インデックス: `shopId`, `shopId + shippingRateId (unique)`

---

## Holiday（休業日）
目的: 単発休業日・毎週休業日の設定。

| カラム | 型 | 説明 |
| --- | --- | --- |
| shopId | String (PK) | 店舗ID |
| holidays | Json | 単発休業日配列（例: `["2025-12-31"]`） |
| weeklyHolidays | Json | 曜日コード配列（例: `["sun","sat"]`） |
| createdAt / updatedAt | DateTime | timestamps |

インデックス: なし（PK のみ）

---

## ShipByRecord（出荷日記録）
目的: 出荷日計算結果を保存し、分析に利用する。

| カラム | 型 | 説明 |
| --- | --- | --- |
| id | String (PK, cuid) | レコードID |
| shopId | String (idx) | 店舗ID |
| orderId | BigInt (unique) | 注文ID |
| shipByDate | DateTime | 出荷期限日 |
| deliveryDate | DateTime? | お届け希望日 |
| createdAt / updatedAt | DateTime | timestamps |

インデックス: `shopId + orderId (unique)`, `shopId + shipByDate`

---

## ErrorLog（エラー記録）
目的: ship-by 計算や保存に失敗した際の記録。

| カラム | 型 | 説明 |
| --- | --- | --- |
| id | String (PK, cuid) | エラーID |
| shopId | String (idx) | 店舗ID |
| orderId | BigInt (複合idx) | 注文ID |
| reason | String | エラー理由（メッセージ） |
| rawData | Json? | 失敗時の入力ペイロード等の記録 |
| memo | String? | 手動メモ |
| resolved | Boolean | 解消済みフラグ |
| createdAt / updatedAt | DateTime | timestamps |

インデックス: `shopId`, `shopId + orderId`

