# 🔧 **出荷期限マネージャー｜エンジニア向け簡易仕様書**

（実装者が必要な情報だけを抽出した技術仕様。現状の実装進捗は Phase 2 までで、以下はこれから実装する仕様を含みます）

---

# 1. **全体概要**

**目的：**
注文作成（orders/create）時に「出荷期限（ship-by date）」を自動計算し、
Order Metafield / タグ / メモへ保存するアプリ。

**技術スタック：**

- Remix
- Shopify Admin API
- Shopify Webhooks
- Polaris（管理 UI）
- DB：SQLite（開発・本番ともデフォルト構成を使用）

**マルチテナント：**

- shop_id で全データ分離

---

# 2. **データモデル（最重要）**

## 2.1 **Rule（出荷ルール）**

```
id: string (PK)
shop_id: string
target_type: "product" | "all_products" | "shipping_method"
target_id: string | null  // product_id or shipping_method_id
prefectures: string[]     // "tokyo", "hokkaido" など
days: number              // 出荷日数
enabled: boolean
created_at: Date
updated_at: Date
```

---

## 2.2 **Holiday（休業日）**

```
shop_id: string
holidays: Date[]               // 単発
weekly_holidays: string[]      // ["sun", "sat"]
```

---

## 2.3 **ErrorLog**

```
id: string (PK)
shop_id: string
order_id: number
reason: string
raw_data: JSON
memo: string | null
resolved: boolean
created_at: Date
```

---

## 2.4 **ShopSetting**

```
shop_id: string (PK)
delivery_source: "metafield" | "attributes"
delivery_key: string            // metafield key または attributes key
delivery_format: string         // パース用フォーマット（管理者入力）
save_tag: boolean
save_tag_format: string         // "ship-by-{YYYY}-{MM}-{DD}"
save_note: boolean
save_note_format: string
save_metafield: boolean
shipping_method_settings: JSON  // code/title に対して ON/OFF
created_at: Date
updated_at: Date
```

---

# 3. **出荷期限計算フロー（核心）**

### ① Webhook `orders/create` を受信

↓

### ② お届け希望日を取得

- ソース：

  - order.metafields
  - order.attributes

- パース：管理者設定のフォーマットでパース
  （例：`YYYY/MM/DD`, `MM-DD-YYYY` など）

↓

### ③ 配送方法を判定

優先順：

1. Shipping Line の `code`
2. Order metafields（設定ありの場合）
3. Order attributes（設定ありの場合）

↓

### ④ 出荷ルール抽出

一致条件：

- 商品 ID
- 全商品
- 配送方法マスタ（ON になっているもの）
- 都道府県（shipping_address.province_code）

複数一致した場合
👉 **最大 days（最も大きい日数）** を採用

↓

### ⑤ 出荷期限を計算

```
ship_by = delivery_date - days
```

↓

### ⑥ 休業日考慮

```
while (ship_by が休業日)
  ship_by = ship_by - 1 day
```

↓

### ⑦ 保存（設定に応じて ON/OFF）

- Metafield（date 型）
- タグ
- メモ

↓

### ⑧ 保存に失敗 or 日付取得失敗 → ErrorLog に記録

---

# 4. **Shopify API 利用箇所**

## 4.1 Admin API

```
GET /admin/api/2023-10/orders/{id}.json
PUT /admin/api/2023-10/orders/{id}.json  // タグ・メモ変更
PUT /admin/api/2023-10/orders/{id}/metafields.json
GET /admin/api/2023-10/products.json
GET /admin/api/2023-10/shipping_zones.json
```

## 4.2 Webhook

- `orders/create`
- HMAC 検証必須

---

# 5. **画面仕様（簡易版）**

## 5.1 出荷ルール

- 一覧
- 編集
- 複製
- 削除
- 最大 20 件程度想定

---

## 5.2 休業日カレンダー

- カレンダークリック → 休業日トグル
- 毎週 ○ 曜日休み → チェックボックス

---

## 5.3 エラー一覧

- order 番号
- お届け希望日
- エラー理由
- 再計算ボタン
- メモ
- 除外

---

## 5.4 設定

- お届け希望日取得元（metafield / attributes）
- 取得キー
- 日付フォーマット
- 保存先 ON/OFF
- タグ形式／メモ形式
- 配送方法マスタ ON/OFF

---

# 6. **メタフィールド仕様（確定）**

```
namespace: ship_by
key: deadline
type: date
value: YYYY-MM-DD
```

---

# 7. **注意ポイント（実装落とし穴まとめ）**

- Shipping Rates の code はショップごとにバラバラ
- order.attributes は配列形式
- お届け希望日フォーマットは店舗ごとに違う
- 日本時間で計算する必要あり（TZ 固定）
- 休業日が連続するケースは while ループ
- Webhook は重複受信することがある（idempotent 必須）
- タグ保存時の既存タグ上書き注意
- 注文メモは文字列結合に注意（改行あり）

---

# 8. **v1 必須機能まとめ（実装範囲）**

- orders/create 時の出荷期限自動計算
- 日数ルール登録（商品／配送方法／全商品 × 都道府県）
- お届け希望日パース
- 休業日カレンダー（単発＋毎週）
- 出荷期限保存（メタフィールド／タグ／メモ）
- エラー一覧（再計算付き）
- メタフィールドの注文詳細表示（標準 UI）

More actions の手動再計算は **v2**。

---

# 9. **Remix ディレクトリ構成（推奨）**

```
/app
  /routes
    /rules
    /calendar
    /errors
    /settings
  /components
  /models
  /services
    calculateShipBy.ts
    parseDeliveryDate.ts
    applyHolidays.ts
    saveResults.ts
  /utils
  /webhooks
    ordersCreate.ts

/prisma
  schema.prisma

/server
  shopify.server.ts   // OAuth, API client
```

---

# 10. **今後実装する場合の次ステップ**

- Prisma schema 作成
- Webhook エンドポイント実装
- 日付パースロジック作成
- 休業日計算
- 出荷期限保存ロジック
- ルール管理 UI（Polaris）
- エラー一覧
