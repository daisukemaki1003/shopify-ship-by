# Webhooks

## 登録
`afterAuth` フックで Webhook を登録する。

## 一覧
- `ORDERS_CREATE` (`/webhooks/orders/create`)
  - `handleOrdersCreate` を実行し、出荷期限を計算して保存。
- `APP_UNINSTALLED` (`/webhooks/app/uninstalled`)
  - セッション削除と `Shop.uninstalledAt` を更新。
- `APP_SCOPES_UPDATE` (`/webhooks/app/scopes_update`)
  - セッションと `Shop.scope` を更新。

## 付随処理
- `afterAuth` で出荷期限メタフィールド（`shipping.ship_by`）の定義を作成。
