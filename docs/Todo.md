# 出荷期限マネージャー Todo.md

> 目的：開発者が「次に何をするか」「どう実装するか」を迷わず進められるようにする。  
> AIに実装依頼する際も、このTodoを渡せば前後関係/要件が伝わる粒度で書く。

---

## 目次

1. [進捗サマリ（今どこまで？）](#進捗サマリ今どこまで)
2. [Phase 0: リポジトリ/開発環境セットアップ](#phase-0-リポジトリ開発環境セットアップ)
3. [Phase 1: DB/Prisma 設計](#phase-1-dbprisma-設計)
4. [Phase 2: Shopify OAuth・API クライアント基盤](#phase-2-shopify-oauthapi-クライアント基盤)
5. [Phase 3: Shipping Rates 自動同期（配送方法マスタ候補）](#phase-3-shipping-rates-自動同期配送方法マスタ候補)
6. [Phase 4: 出荷期限計算コア（ドメイン）](#phase-4-出荷期限計算コアドメイン)
7. [Phase 5: Webhook orders/create パイプライン](#phase-5-webhook-orderscreate-パイプライン)
8. [Phase 6: 管理画面UI（Polaris/Remix）](#phase-6-管理画面uipolarisremix)
9. [Phase 7: エラー一覧UI + 再計算](#phase-7-エラー一覧ui--再計算)
10. [Phase 8: 本番前チェック/審査準備](#phase-8-本番前チェック審査準備)
11. [Future (v2以降)](#future-v2以降)

---

## 進捗サマリ（今どこまで？）

> 各Phaseの「完了条件」を満たしたらチェックを入れる。

- [x] Phase 0 完了（Remix + Shopify + SQLite ローカルが動く）
- [x] Phase 1 完了（Prisma schema / migrate / seed 完了）
- [ ] Phase 2 完了（OAuth / shopごとの token 保存 / admin API 呼べる）
- [ ] Phase 3 完了（Shipping Rates 同期 + ON/OFF 管理できる）
- [ ] Phase 4 完了（計算コア：日付取得→ルール適用→休業日考慮まで単体テスト）
- [ ] Phase 5 完了（orders/create で自動計算→保存→エラー記録）
- [ ] Phase 6 完了（出荷ルール/休業日/設定/ダッシュボード UI）
- [ ] Phase 7 完了（エラー一覧 UI + 再計算ボタン）
- [ ] Phase 8 完了（本番Env/監査/アプリ提出準備）

---

## Phase 0: リポジトリ/開発環境セットアップ

### ゴール

- Remix + Shopify App template ベースで起動
- ローカル SQLite（ファイル）と Prisma が繋がる

### タスク

- [x] 0-1. Remix + Shopify app テンプレ準備  
       **やること**
  - Shopify公式のRemixテンプレから新規作成
  - Polaris / AppBridge / OAuth が含まれる構成にする  
    **完了条件**: `shopify app dev` で埋め込み管理画面が表示される

- [x] 0-2. ローカル SQLite（ファイル）利用  
       **やること**
  - `prisma/schema.prisma` の datasource を `provider = "sqlite"` / `url = "file:dev.sqlite"` にする
  - `npm run setup` で `prisma generate` + `prisma migrate deploy` を実行  
    **完了条件**: `prisma/dev.sqlite` が生成され、`npx prisma studio` が起動できる

- [x] 0-3. Prisma 導入  
       **やること**
  - `prisma init`
  - Session モデルの migration を適用できる状態にする  
    **完了条件**: Session テーブルが schema.prisma に定義されている

---

## Phase 1: DB/Prisma 設計

### ゴール

- ルール/休業日/設定/エラー を保存するDBモデルができる

### タスク

- [x] 1-1. Prisma schema 作成  
       **モデル**
  - Rule
  - Holiday
  - ErrorLog
  - ShopSetting
  - Shop（セッション/OAuth用）  
    **完了条件**: schema.prisma に定義完了

- [x] 1-2. migrate dev  
       **やること**
  - `npx prisma migrate dev --name init`  
    **完了条件**: DBにテーブル作成される

- [x] 1-3. 最低限 seed（開発用）  
       **やること**
  - Rule/Setting のダミー投入  
    **完了条件**: UIで一覧が最低1件見える

---

## Phase 2: Shopify OAuth・API クライアント基盤

### ゴール

- shop_id単位で token を持ち、Admin API 呼び出しできる

### タスク

- [ ] 2-1. OAuth フロー確認 & Shop 情報保存  
       **やること**
  - インストール時に shop_id / access_token を DBへ保存  
    **完了条件**: 再ログインで token 再利用できる

- [ ] 2-2. Admin API クライアント共通化  
       **やること**
  - `adminClient(shop_id)` 的なヘルパーを用意
  - 401/429 リトライやログ整備  
    **完了条件**: 任意の注文/商品APIを取得できる

- [ ] 2-3. Scope 反映  
       **必須スコープ（広め）**
  - read_orders / write_orders
  - read_order_metafields / write_order_metafields
  - read_products
  - read_shipping  
    **完了条件**: インストール時にscopeが要求される

---

## Phase 3: Shipping Rates 自動同期（配送方法マスタ候補）

### ゴール

- Shopify配送設定から Shipping Rates を同期し、管理者が ON/OFF できる

### タスク

- [ ] 3-1. Shipping Zones/Rates 取得サービス作成  
       **やること**
  - Admin API `shipping_zones.json` を読んで  
     `code/title/price` を抽出  
    **完了条件**: 同期用関数が動作

- [ ] 3-2. ShopSetting.shipping_method_settings に保存  
       **形式例**
  ```json
  {
    "yamato_cool": { "title": "ヤマト運輸 クール便", "enabled": true },
    "sagawa_normal": { "title": "通常便（佐川）", "enabled": false }
  }
  ```

**完了条件**: DBに保存・更新できる

- [ ] 3-3. 設定UIで同期 & ON/OFF
      **やること**
  - 「配送方法を同期」ボタン
  - 一覧表示とtoggle
    **完了条件**: 管理者が有効配送方法を選べる

---

## Phase 4: 出荷期限計算コア（ドメイン）

### ゴール

- 入力（注文/設定/ルール/休業日）から ship-by date を算出できる

### タスク

- [ ] 4-1. お届け希望日取得/パース
      **入力**: order + setting
      **設定**
  - delivery_source: metafield or attributes（どちらか一方）
  - delivery_key: namespace.key or attributes key
  - delivery_format: 管理者入力（シンプル区切り）
    **完了条件**: 日付パース成功/失敗が返る

- [ ] 4-2. 配送方法判定（3方式対応）
      **優先順**
  1. Shipping Line code
  2. Order metafield（設定あり）
  3. Order attributes（設定あり）
     **完了条件**: shipping_method_key が確定する

- [ ] 4-3. ルール抽出
      **条件**
  - product / all_products / shipping_method
  - 都道府県（複数）一致
  - enabled=true
  - shipping_method は ShopSetting で enabled のものだけ対象
    **競合**: 最大 days を採用
    **完了条件**: adopt_days を返す

- [ ] 4-4. ship-by 基本計算
      `ship_by = delivery_date - adopt_days`
      **完了条件**: date が出力される

- [ ] 4-5. 休業日考慮（前営業日へ前倒し）
      **ルール**
  - holidays（単発）または weekly_holidays に該当したら
    直前の営業日まで -1 day で繰り返す
    **完了条件**: 営業日に着地した ship_by が返る

- [ ] 4-6. 単体テスト
      **ケース**
  - ルール競合（最大days）
  - 連続休業日
  - 日付パース失敗
  - 配送方法が無効化されている場合
    **完了条件**: CIで通る

---

## Phase 5: Webhook orders/create パイプライン

### ゴール

- 注文作成時に自動計算→保存→失敗ならErrorLog

### タスク

- [ ] 5-1. Webhook 受信（orders/create）
      **やること**
  - HMAC検証
  - 重複受信対策（idempotent）
    **完了条件**: 受信して200返せる

- [ ] 5-2. orders/create ハンドラ
      **やること**
  - Phase4 の計算コア呼び出し
  - ship_by の算出
    **完了条件**: ship_by が得られる

- [ ] 5-3. 保存ロジック
      **保存先（設定ON/OFF）**
  - Order Metafield（ship_by.deadline, date型）
  - タグ（format: ship-by-{YYYY}-{MM}-{dd}）
  - メモ（format: 出荷期限：{YYYY}-{MM}-{dd}）
    **完了条件**: Shopify側に反映される

- [ ] 5-4. エラー時の記録
      **やること**
  - ErrorLog に reason/raw_data を保存
  - 通知はしない
    **完了条件**: UIで該当エラーが出る

---

## Phase 6: 管理画面UI（Polaris/Remix）

### ゴール

- 管理者が月数回メンテできるUI

### タスク

- [ ] 6-1. ルール一覧 UI
      **項目**
  - 出荷日数
  - 対象（商品/全商品/配送方法）
  - 都道府県（複数、省略表示）
  - 更新日時
  - enabled toggle
    **アクション**: 編集/複製/削除
    **完了条件**: CRUDできる

- [ ] 6-2. ルール追加/編集 UI
      **フロー**
  1. 都道府県を複数選択（47チェック）
  2. 対象選択（商品検索 or 全商品 or 配送方法）
  3. days（整数入力）
     **完了条件**: 保存で即一覧反映

- [ ] 6-3. 休業日カレンダー UI
  - カレンダークリックで単発休業日トグル
  - 毎週休業（checkbox）
    **完了条件**: 設定保存できる

- [ ] 6-4. 設定 UI
  - delivery_source 選択（metafield / attributes ※どちらか一方）
  - delivery_key
  - delivery_format（シンプル区切りのみ）
  - 保存先ON/OFF
  - Shipping Rates同期/ONOFF
    **完了条件**: 設定反映→計算に効く

- [ ] 6-5. ダッシュボード（軽量）
  - 直近エラー件数
  - 設定未完了アラート
    **完了条件**: 最低限の概要表示

---

## Phase 7: エラー一覧 UI + 再計算

### ゴール

- エラー注文を管理者が解消できる

### タスク

- [ ] 7-1. エラー一覧 UI（フル表示）
      **項目**
  - 注文番号/作成日時
  - お届け希望日
  - 配送方法
  - reason
  - 処理種別（auto/manual）
  - memo
    **完了条件**: 一覧/詳細が見える

- [ ] 7-2. 再計算ボタン
      **やること**
  - 該当注文IDで再取得→Phase4計算→Phase5保存
  - 成功したら ErrorLog.resolved=true
    **完了条件**: エラーが解消され一覧から落ちる/解消表示

- [ ] 7-3. 除外（無視）機能
  - resolved=true + reason="ignored" 的扱い
    **完了条件**: 一覧から除外できる

- [ ] 7-4. メモ追加/編集
      **完了条件**: DBに残る

---

## Phase 8: 本番前チェック/審査準備

### ゴール

- 公開アプリとして安全・審査OKな状態

### タスク

- [ ] 8-1. 環境変数整理（.env.example）
  - SHOPIFY_API_KEY / SECRET
  - DATABASE_URL
  - WEBHOOK_SECRET など
    **完了条件**: READMEに記載

- [ ] 8-2. 本番DB接続確認（SQLite 運用前チェック）
  - SQLite ファイルの配置/権限を確認し `prisma migrate deploy` を実行
    **完了条件**: migrate deploy が成功

- [ ] 8-3. Webhook 再試行/冪等性テスト
  - 同じorders/createが複数来ても正しく動く
    **完了条件**: ship_by が二重作成されない

- [ ] 8-4. Shopify App Store 審査項目チェック
  - scope最小限説明
  - プライバシーポリシー
  - アプリ説明
    **完了条件**: 提出用素材が揃う

---

## Future (v2以降)

- [ ] v2-1. More actions メニューからの手動再計算
- [ ] v2-2. 国別ルール（海外対応）
- [ ] v2-3. 商品タグ単位でルール適用
- [ ] v2-4. Slack/メール通知
- [ ] v2-5. 休業日CSVインポート
- [ ] v2-6. 英語UI切替（i18n翻訳追加）

---

## メモ（AIに依頼するときのコツ）

- 依頼は **Phase単位** か **タスクID単位（例：4-1, 5-3）** で投げる
- AIには「完了条件」と「入力/出力」をセットで渡すと精度が上がる
- 仕様が変わったら Todo の該当タスクに追記する

```

```
