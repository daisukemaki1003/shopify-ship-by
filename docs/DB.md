# データベース構造（SQLite / Prisma）

現行スキーマの要約です。「何のデータか」が分かるように用途と例を併記しています。正確な型は `prisma/schema.prisma` を参照してください。

### 型のメモ
- String / Int / BigInt / Boolean / DateTime / Json（SQLite では TEXT/BLOB にマッピング）
- timestamps = `createdAt @default(now())` / `updatedAt @updatedAt`

### Enum
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
目的: 店舗自体のメタデータ・インストール状態を保存。

| カラム | 型 | 説明 |
| --- | --- | --- |
| id | String (PK) | 店舗ID（shopドメインと同一を想定） |
| shopDomain | String? (UNIQUE) | ドメイン（例: `dev-shop.myshopify.com`） |
| accessToken | String? | Admin API アクセストークン（最新） |
| scope | String? | インストール時スコープ |
| installedAt / uninstalledAt | DateTime? | インストール／アンインストール日時 |
| createdAt / updatedAt | DateTime | timestamps |

インデックス: `shopDomain` (UNIQUE)

---

## ShopSetting（店舗設定）
目的: お届け希望日の取得方法や保存先設定、Shipping Rate キャッシュ（ON/OFF含む）。

| カラム | 型 | 説明 |
| --- | --- | --- |
| shopId | String (PK) | 店舗ID |
| deliverySource | DeliverySource? | `metafield` or `attributes` |
| deliveryKey | String? | 取得キー（例: `shipping.requested_date`） |
| deliveryFormat | String? | 日付パースフォーマット（例: `YYYY-MM-DD`） |
| saveTag / saveNote / saveMetafield | Boolean | タグ/メモ/メタフィールドへの保存ON/OFF |
| saveTagFormat / saveNoteFormat | String? | 保存フォーマット（例: `ship-by-{YYYY}-{MM}-{DD}`） |
| language | String? | UI言語 |
| shippingRates | Json | Shipping Rate キャッシュ（`id/handle/title/zoneName/enabled` の配列） |
| createdAt / updatedAt | DateTime | timestamps |

インデックス: なし（PK のみ）

---

## Rule（出荷ルール）
目的: 出荷日数を決めるルール（商品/全商品 × Shipping Rate）。

| カラム | 型 | 説明 |
| --- | --- | --- |
| id | String (PK, cuid) | ルールID |
| shopId | String (idx) | 店舗ID |
| targetType | RuleTargetType | `product` / `all` |
| targetId | String? | productId（全商品は null） |
| shippingRateIds | Json | Shipping Rate ID 配列（空配列なら配送ケース問わず適用） |
| days | Int | 出荷日数（到着日の何日前に発送するか） |
| enabled | Boolean | ルール有効フラグ |
| createdAt / updatedAt | DateTime | timestamps |

インデックス: `shopId`

---

## ShippingRate（配送ケースキャッシュ）
目的: `read_shipping` で取得した配送ケースを保存し、ルール作成で選択できるようにする。

| カラム | 型 | 説明 |
| --- | --- | --- |
| id | String (PK, cuid) | レコードID |
| shopId | String (idx) | 店舗ID |
| shippingRateId | String | Shopify の Shipping Rate ID |
| title | String | 表示名 |
| handle | String | code / handle |
| zoneName | String? | 所属配送ゾーン |
| enabled | Boolean | ルール選択時の有効フラグ |
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
