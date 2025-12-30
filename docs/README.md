# ドキュメント概要

このドキュメント群は「現在の実装」を正とした仕様メモです。実装の振る舞いと一致するように整理しています。

## 目次
- `docs/data-model.md` : データモデル（Prisma/SQLite）
- `docs/features/settings.md` : 全体設定（配送リードタイム・お届け希望日取得・保存先）
- `docs/features/rules.md` : 出荷ルールのドメイン仕様と保存ロジック
- `docs/ui/rules-index.md` : 出荷ルール一覧 UI
- `docs/ui/rules-detail.md` : 出荷ルール詳細 UI
- `docs/features/ship-by.md` : 出荷日計算・保存・エラーハンドリング
- `docs/features/shipping-rates.md` : 配送ケース同期とキャッシュ
- `docs/features/webhooks.md` : Webhook ハンドリング

## アプリ全体の流れ（概要）
- インストール後: Webhook 登録と ship-by メタフィールド定義を作成。
- 設定: 全体設定で基準日数とお届け希望日取得方法を指定。
- ルール: 配送エリア別に基本設定・商品別設定を作成。
- 注文作成時: お届け希望日・配送ケース・ルールから ship-by を計算し、メタフィールドとタグに保存。失敗は ErrorLog に記録。
- 分析: ShipByRecord を集計してダッシュボードに表示。

## コード構成（実装の現状）
- `app/routes/` : ルートエントリ（URL 変更を避けるため固定）
- `app/features/` : ドメイン別ロジック
  - `rules` / `ship-by` / `shipping` / `shop`
- `app/shared/` : 共通 UI / 共通ユーティリティ
- `app/server/` : サーバー向け共通クライアント
- `prisma/` : スキーマとマイグレーション

