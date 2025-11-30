# 📘 **出荷期限マネージャー 要件定義書 v1.1（国際対応版）**

> 現在の実装進捗は Phase 2 までです。本書の機能要件は今後実装する範囲を含みます。

---

# **0. 目的・背景（Purpose）**

EC ショップ運営では、商品や配送方法の違い、倉庫の休業状況などにより
**出荷期限（Ship-by Date）** が個別に異なり、手動管理ではミスや遅延が発生しやすい。

さらに、海外配送が加わることで多様な配送ケース（Shipping Rate）が存在し、
**国／地域ごとの配送リードタイム管理がより複雑** になる。

本アプリでは Shopify の注文データと配送設定（Shipping Rates）を活用し、
**お届け希望日から逆算した最適な出荷期限を自動算出・保存する仕組み** を提供する。

---

# **1. アプリ概要（Overview）**

## **1.1 位置づけ**

Shopify の配送設定（Shipping Rates）に基づき
**配送ケース別の出荷リードタイム管理** を行うアプリ。

## **1.2 対象ユーザー**

- 日本国内および海外向け配送を扱う EC ショップ
- 物流担当者（出荷日判断を正確にしたい）
- 運用・オペレーションの標準化を進めたい管理者

## **1.3 解決する課題**

- 商品 × 配送方法 × 海外配送を含む配送ケースの煩雑管理
- 出荷期限計算ミス・遅延
- 倉庫休業日を跨ぐ計算の手間
- スタッフごとの判断ぶれ

## **1.4 用語定義**

- **お届け希望日（Delivery Date）**
  顧客が希望する到着日。Metafield または attributes から取得。

- **出荷期限（Ship-by Date）**
  この日までに倉庫が出荷する必要がある締切日。

- **日数ルール（Lead Time Rule）**
  到着日の ◯ 日前に出荷する、というリードタイム日数。

- **配送ケース（Shipping Rate）**
  Shopify が持つ配送設定単位。国内便・海外便・クール便など。

---

# **2. 機能要件（Functional Requirements）**

## **2.1 自動出荷期限計算（orders/create）**

Webhook `orders/create` の発火時に次を行う：

1. お届け希望日を取得（メタフィールド／attributes／note 属性など）
2. 配送方法を判定
   - Order の `shipping_lines` から配送ケース（Shipping Rate）を特定

3. 商品または配送ケースに該当する日数ルールを検索
   - 優先順位に従う（後述）

4. 到着日 − 日数ルール で出荷期限を算出
5. 休業日設定を踏まえて調整（休業日の場合は直前営業日に前倒し）
6. 出荷期限を Order Metafield（date 型）へ保存
7. タグ・メモにも保存（ON/OFF 選択可）
8. 失敗時はエラー一覧へ記録

---

## **2.2 日数ルール設定機能（国際対応版）**

### ■ 条件

- 商品（単品）
- 全商品
- 配送ケース（Shipping Rate）

### ■ 配送ケースの扱い

- `read_shipping` で取得する Shipping Rates をアプリ側に同期
- 国／地域／都道府県の複雑な判定は Shopify 側に任せる
  → アプリは **Shipping Rate 単位でルールを管理**

例：

- Japan / Standard
- Japan / Cool Delivery
- International ePacket
- International Courier / Asia Zone
- International Courier / Europe Zone

### ■ 日数

整数で指定（1, 2, 3, ...）

### ■ 優先順位（重要）

複数ルールが該当した場合、以下の順で検出し、
最終的に **日数が最も長いルール** を採用する：

1. 商品 × 配送ケースのルール
2. 商品のみのルール
3. 全商品 × 配送ケースのルール
4. 全商品のみのルール

### ■ 廃止した項目

- 都道府県チェックボックスの地域指定（国内専用だったため）

---

## **2.3 出荷期限保存**

- 保存先（ON/OFF 選択可）
  - Order Metafield（date）
  - タグ：`ship-by-YYYY-MM-DD`
  - メモ：`出荷期限：YYYY-MM-DD`

---

## **2.4 休業日カレンダー**

- ショップ単位で休業日を管理
- 設定可能：
  - 単発の休業日
  - 毎週休業（複数可）

- 出荷期限が休業日の場合は **前営業日へ自動調整**

---

## **2.5 エラー一覧**

以下項目を表示：

- 注文番号
- 作成日時
- お届け希望日
- 該当配送ケース
- エラー理由
- 処理種別（自動／手動）
- メモ

アクション：

- 再計算
- 除外
- メモ追記

---

## **2.6 注文詳細ページでの表示**

- Shopify 標準メタフィールド欄に出荷期限を表示
- 独自 UI の追加は行わない（v2 で検討）

---

## **2.7 権限（OAuth スコープ）**

- read_orders
- write_orders
- read_order_metafields
- write_order_metafields
- read_products
- read_shipping（海外対応を含む）

---

## **2.8 マルチテナント**

- 各ショップごとにデータ完全分離
- OAuth による認証必須

---

# **3. 画面要件（UI Requirements）**

## **3.1 メニュー構成（v1）**

```
出荷ルール
休業日カレンダー
エラー一覧
設定
ダッシュボード
```

## **3.2 出荷ルール画面**

- 一覧表示
- 表示項目：
  - 出荷日数
  - 対象商品 or 配送ケース
  - 更新日時
  - 有効／無効

- アクション：
  - 編集
  - 複製
  - 削除

## **3.3 休業日カレンダー**

- カレンダー UI
- 毎週休業の設定
- 保存ボタン

## **3.4 エラー一覧**

- 再計算ボタン付き
- 全データ確認可能

## **3.5 設定画面**

- お届け希望日の取得元
- 日付フォーマット設定
- 配送方法判定方法
- 保存先設定（メタフィールド／タグ／メモ）
- 言語設定（初期は日本語）

## **3.6 注文詳細ページ**

- 標準メタフィールド欄に表示

---

# **4. データ要件（Data Requirements）**

## **4.1 ルールデータモデル（改訂）**

- rule_id (PK)
- shop_id
- target_type (`product` / `all`)
- target_id（product の場合のみ）
- **shipping_rate_ids (string[])**
  - 配送ケースと紐づく ID 群
  - 空配列＝商品単体ルール

- days (int)
- enabled (bool)
- created_at / updated_at

## **4.2 休業日モデル**

- shop_id
- holidays (date[])
- weekly_holidays (string[])

## **4.3 出荷期限メタフィールド**

- namespace: `ship_by`
- key: `deadline`
- type: `date`
- value: `YYYY-MM-DD`

## **4.4 タグ・メモ**

- タグ：`ship-by-YYYY-MM-DD`
- メモ：`出荷期限：YYYY-MM-DD`

## **4.5 エラーログ**

- order_id
- reason
- raw_data
- memo
- resolved (bool)

## **4.6 店舗データ**

- shop_id
- access_token
- 設定 JSON

---

# **5. API・連携要件**

## **5.1 Admin API**

- Orders
- Order Metafields
- Products
- Shipping Rates

## **5.2 Webhook**

- `orders/create`

## **5.3 配送方法同期（改訂）**

- `read_shipping` を使用し Shipping Rates を取得
- 保存する情報：
  - shipping_rate_id
  - title
  - handle / code
  - 所属配送ゾーン名

- 日数ルール設定画面で選択可能にする

## **5.4 日付パース**

- 管理者が設定したフォーマットに従う：
  - `2025/12/01`
  - `2025-12-01`
  - `12/1`
  - その他カスタマイズ形式

## **5.5 将来拡張**

- 外部配送アプリとの連携
- 国別特別ルール（関税対応など）

---

# **6. 非機能要件**

## **6.1 パフォーマンス**

- 1 注文あたり 300ms 以下

## **6.2 セキュリティ**

- shop_id ごとにデータ完全分離

## **6.3 拡張性**

- 設定は JSON 管理
- コンポーネントベースで UI 開発

## **6.4 言語対応**

- 初期：日本語
- 将来：英語

## **6.5 運用・保守**

- エラー一覧で全て確認可能
- 通知機能は次期バージョンで検討

---

# **7. 将来機能（Future Scope）**

- 国別配送ルールの拡張
- タグ単位での商品ルール
- Slack / メール通知
- More actions からの再計算
- AI によるリードタイム自動生成
- 休業日カレンダーの CSV インポート

---

# **8. MVP（v1）機能一覧**

- orders/create の出荷期限自動計算
- 商品／全商品 × 配送ケース（Shipping Rate）の日数ルール
- お届け希望日のパース
- 休業日カレンダー（単発＋毎週）
- 出荷期限保存（メタフィールド・タグ・メモ）
- 注文詳細ページでの表示
- エラー一覧（再計算付き）

---

# **9. 技術構成（Tech Stack）**

- **Remix + Shopify API + Polaris**
- デプロイ：Fly.io / Render / Railway / Vercel など Remix 対応基盤
- DB：SQLite（Prisma）
- shop_id を key にしたマルチテナント設計
- ディレクトリ構成例

```
/app
  /routes
  /components
  /models
  /services
  /utils
/prisma
/public
```
