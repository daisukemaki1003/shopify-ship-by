# リリース前チェックリスト

## 自動チェック
- `npm run lint`
- `npm run typecheck`
- `npm run test`
- `npm run build`
- `npm audit`（必要なら対応）

## 設定・環境
- `shopify.app.toml`
  - `application_url` が本番 URL になっている
  - `redirect_urls` が本番 URL に一致している
- `shopify.web.toml`
  - URL/埋め込み設定/ロールが想定通り
- 環境変数
  - `SHOPIFY_APP_URL`
  - `SHOPIFY_API_KEY`
  - `SHOPIFY_API_SECRET`
  - `SCOPES`

## DB
- `prisma migrate deploy` を実行
- `prisma generate` を実行

## Webhook
- `ORDERS_CREATE`
- `APP_UNINSTALLED`
- `APP_SCOPES_UPDATE`

## 仕様動作（手動）
- 出荷日計算 → メタフィールド保存が行われる
- タグ保存（ON のときのみ）される
- 失敗時に ErrorLog が記録される
- ShipByRecord が更新される
- ダッシュボード集計が期待通り反映される
