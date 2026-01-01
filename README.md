# 出荷期限マネージャー

Shopify 埋め込みアプリ。注文の「お届け希望日」、配送ケース、出荷ルール、休業日設定をもとに出荷期限を自動計算し、メタフィールドとタグへ保存します（タグは任意）。
ダッシュボードでは出荷期限の集計結果を表示します。

## 前提
- Node: `>=20.19 <22 || >=22.12`
- Shopify CLI（Partner アカウントと開発ストアが必要）
- パッケージマネージャー: npm

## セットアップ（ローカル）
1. 依存関係インストール  
   `npm install`
2. Prisma 生成 + マイグレーション適用（SQLite `prisma/dev.sqlite` を作成）  
   `npm run setup`
3. 開発用ダミーデータ投入（任意）  
   `npm run seed`
4. 開発サーバー起動  
   `npm run dev` または `shopify app dev`  
   （CLI の案内に従ってインストール URL を開きます）
5. データ確認（任意）  
   `npx prisma studio`

## データベース / Prisma
- デフォルト: SQLite `file:dev.sqlite`
- スキーマ: `prisma/schema.prisma`
- マイグレーション: `prisma/migrations/`
- 主要コマンド
  - スキーマ変更 → `npx prisma migrate dev --name <name>`
  - 既存マイグレーション適用 → `npm run setup`
  - GUI で確認 → `npx prisma studio`

## コマンド一覧（抜粋）
- `npm run dev` : Shopify CLI + Vite 開発サーバー
- `npm run setup` : `prisma generate && prisma migrate deploy`
- `npm run seed` : `prisma db seed`（開発用ダミーデータ）
- `npm run lint` : ESLint
- `npm run typecheck` : ルート自動生成 + TypeScript チェック
- `npm run build` : 本番ビルド
- `npm run start` : ビルド済みサーバーを起動
- `npm run prisma` : Prisma CLI

## 環境変数
- Shopify CLI が自動で設定（`shopify.app.toml` 参照）
- 追加で必要な場合の例:
  - `SHOPIFY_APP_URL`
  - `SHOP_CUSTOM_DOMAIN`
  - その他 Shopify CLI が出力する API キー・シークレット

## ディレクトリ概要
- `app/routes/` : ルートエントリ
- `app/features/` : ドメイン別ロジック（rules / ship-by / shipping / shop）
- `app/shared/` : 共通 UI / 共通ユーティリティ
- `app/server/` : サーバー向け共通クライアント
- `prisma/` : Prisma スキーマ・マイグレーション・シード
- `docs/` : ドキュメント（`docs/README.md` から参照）

## よくあるトラブル
- Prisma がバイナリを取得できない  
  → ネットワークを許可した上で `npm run setup` を再実行してください。
