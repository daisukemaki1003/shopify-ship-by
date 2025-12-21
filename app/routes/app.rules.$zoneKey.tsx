import {useEffect, useMemo, useState} from "react";
import type {ActionFunctionArgs, LoaderFunctionArgs, ShouldRevalidateFunction} from "react-router";
import {Form, redirect, useActionData, useLoaderData, useLocation} from "react-router";
import {
  BlockStack,
  Button,
  Card,
  InlineStack,
  Page,
  Text,
  TextField,
} from "@shopify/polaris";

import prisma from "../db.server";
import {authenticate} from "../shopify.server";
import {
  loadZoneRuleDetail,
  normalizeZoneRulePayload,
  persistZoneRulePayload,
  type ZoneRulePayload,
  type ZoneRuleDetailData,
} from "../services/rules.server";
import {DEFAULT_PRODUCT_DAYS} from "../utils/rules";
import {
  selectionToProductSummary,
  toFallbackProduct,
} from "../utils/products";
import {parsePositiveInt} from "../utils/validation";
import type {
  ProductRule,
  ProductRuleWithProducts,
  ProductSummary,
} from "../utils/rule-types";
import {ProductPreviewPills} from "app/components/ProductPreviewPills";
import {CriticalBanner} from "../components/CriticalBanner";
import {SettingsRequiredBanner} from "../components/SettingsRequiredBanner";
import {SuccessToast} from "../components/SuccessToast";
import {toZoneLabel} from "../utils/shipping-zones";

// 画面描画に必要なデータセット（flashMessageを付与）
type LoaderData = ZoneRuleDetailData & {
  flashMessage: {text: string; tone: "success" | "critical"} | null;
};

// 保存処理の結果
type ActionData =
  | {ok: true; message: string}
  | {ok: false; message: string};

// バリデーション済みのペイロードをサーバーへ送るためにシリアライズ
const serializePayload = (
  zoneKey: string,
  baseDays: string,
  baseId: string | null,
  productRules: Array<ProductRule | ProductRuleWithProducts>,
) => {
  return JSON.stringify({
    zoneKey,
    base: {id: baseId, days: baseDays},
    productRules: productRules.map((rule) => ({
      id: rule.id,
      productIds: rule.productIds,
      days: rule.days,
    })),
  });
};

// 配送エリアに紐づくルール・商品情報を取得する
export const loader = async ({request, params}: LoaderFunctionArgs) => {
  const {session, admin} = await authenticate.admin(request);
  const zoneKey = params.zoneKey ?? "";
  const url = new URL(request.url);
  const flashText = url.searchParams.get("message");
  const flashTone = url.searchParams.get("tone") === "critical" ? "critical" : "success";

  const ruleDetail = await loadZoneRuleDetail({
    shopId: session.shop,
    zoneKey,
    admin,
  });

  return {
    ...ruleDetail,
    flashMessage: flashText ? {text: flashText, tone: flashTone} : null,
  } satisfies LoaderData;
};

// フォームから送信された出荷ルールを検証・保存する
export const action = async ({request, params}: ActionFunctionArgs) => {
  const {session} = await authenticate.admin(request);
  const setting = await prisma.shopSetting.findUnique({
    where: {shopId: session.shop},
    select: {defaultLeadDays: true},
  });
  if (!setting?.defaultLeadDays || setting.defaultLeadDays <= 0) {
    return {ok: false, message: "全体設定が未完了のため保存できません"} satisfies ActionData;
  }
  const zoneKey = params.zoneKey ?? "";
  const form = await request.formData();
  const actionType = String(form.get("_action") ?? "");

  if (actionType !== "save_all") {
    return {ok: false, message: "不明な操作です"} satisfies ActionData;
  }

  const rawPayload = String(form.get("payload") ?? "");
  let payload: ZoneRulePayload | null = null;

  try {
    payload = JSON.parse(rawPayload) as ZoneRulePayload;
  } catch {
    return {ok: false, message: "入力内容を解釈できませんでした"} satisfies ActionData;
  }

  const normalized = normalizeZoneRulePayload(payload, zoneKey);
  if (!normalized.ok) {
    return {ok: false, message: normalized.message} satisfies ActionData;
  }

  await persistZoneRulePayload({
    shopId: session.shop,
    zoneKey,
    baseId: payload.base.id,
    baseDays: normalized.baseDays,
    productRules: normalized.productRules,
  });

  return redirect(
    `/app/rules/${encodeURIComponent(zoneKey)}?message=${encodeURIComponent("保存しました")}&tone=success`,
  );
};

export const shouldRevalidate: ShouldRevalidateFunction = ({
  actionResult,
  defaultShouldRevalidate,
}) => {
  if (
    actionResult &&
    typeof actionResult === "object" &&
    "ok" in actionResult &&
    "message" in actionResult &&
    (actionResult as ActionData).ok === false
  ) {
    return false;
  }
  return defaultShouldRevalidate;
};

// 画面側で一意に識別するためのclientIdを付与した編集用ルール
type EditableProductRule = ProductRuleWithProducts & {
  clientId: string;
};

// 配送レートごとの出荷ルール詳細・編集ページ
export default function RuleDetailPage() {
  const {zone, rates, base, productRules, flashMessage, defaultLeadDays} = useLoaderData<LoaderData>();
  const actionData = useActionData<ActionData>();
  const location = useLocation();
  const baseDaysFromLoader = base ? String(base.days) : "";
  const [baseDays, setBaseDays] = useState<string>(baseDaysFromLoader);
  const isSettingsReady = defaultLeadDays != null && defaultLeadDays > 0;
  const bannerText = actionData?.message ?? flashMessage?.text;
  const bannerTone = actionData ? "critical" : flashMessage?.tone ?? "success";
  const successMessage = bannerTone === "success" ? bannerText : null;
  const errorMessage = bannerTone === "critical" ? bannerText : null;

  // ID配列を商品サマリーに変換し、欠損時はダミーで補完する
  const withProductsForIds = (productIds: string[], products: ProductSummary[]) => {
    const productMap = new Map(products.map((product) => [product.id, product]));
    return productIds.map(
      (id) =>
        productMap.get(id) ?? toFallbackProduct(id),
    );
  };

  // サーバーからのデータをクライアント側の編集形式へ変換
  const hydrateRow = (rule: ProductRuleWithProducts, idx: number): EditableProductRule => ({
    ...rule,
    products: withProductsForIds(rule.productIds, rule.products ?? []),
    clientId: rule.id ?? `existing-${idx}`,
  });

  const [productRows, setProductRows] = useState<EditableProductRule[]>(() =>
    productRules.map((rule, idx) => hydrateRow(rule, idx)),
  );

  // ローダーが更新されたときの初期同期
  useEffect(() => {
    setBaseDays(baseDaysFromLoader);
    setProductRows(productRules.map((rule, idx) => hydrateRow(rule, idx)));
  }, [base?.days, base?.id, baseDaysFromLoader, productRules]);

  // サーバーへ送るペイロード文字列
  const serializedPayload = useMemo(
    () => serializePayload(zone.key, baseDays, base?.id ?? null, productRows),
    [zone.key, baseDays, base?.id, productRows],
  );

  // Shopifyのリソースピッカーで商品選択を行い、行の内容を更新
  const openProductPicker = async (index: number) => {
    try {
      const picker = (window as any)?.shopify?.resourcePicker;
      if (typeof picker !== "function") {
        console.error("shopify.resourcePicker is not available");
        return;
      }
      const result = await picker({
        type: "product",
        action: "select",
        multiple: true,
        filter: {variants: false},
        selectionIds: productRows[index]?.productIds?.map((id) => ({id})),
      });
      if (!result) return;
      const selectionItems = Array.isArray(result) ? result : result?.selection ?? [];
      const isProductId = (value: any) => {
        if (!value) return false;
        const id = String(value);
        return !id.includes("ProductVariant");
      };
      const summaries = (selectionItems as any[])
        .map((item) => selectionToProductSummary(item))
        .filter(Boolean) as ProductSummary[];
      const selectionMap = new Map(summaries.map((item) => [item.id, item]));

      const ids = Array.from(
        new Set(
          (selectionItems as any[])
            .map((item) => item?.id || item?.admin_graphql_api_id)
            .filter((value) => isProductId(value)),
        ),
      ).map(String);
      setProductRows((prev) =>
        prev.map((row, idx) => {
          if (idx !== index) return row;
          const mergedProducts = ids.map(
            (id) => selectionMap.get(id) ?? row.products.find((p) => p.id === id) ?? toFallbackProduct(id),
          );
          return {
            ...row,
            productIds: ids,
            products: mergedProducts,
          };
        }),
      );
    } catch (error) {
      console.error("product picker failed", error);
    }
  };

  // 商品別ルールを新規追加する
  const addProductRule = () => {
    setProductRows((prev) => [
      ...prev,
      {
        id: null,
        clientId: `new-${Date.now()}`,
        productIds: [],
        products: [],
        days: DEFAULT_PRODUCT_DAYS,
      },
    ]);
  };

  // 指定した行を削除する
  const removeProductRule = (clientId: string) => {
    setProductRows((prev) => prev.filter((row) => row.clientId !== clientId));
  };

  // 行単位で部分更新する
  const updateProductRule = (clientId: string, patch: Partial<EditableProductRule>) => {
    setProductRows((prev) =>
      prev.map((row) => (row.clientId === clientId ? {...row, ...patch} : row)),
    );
  };

  return (
    <Form
      method="post"
      id="rule-form"
    >
      <input type="hidden" name="_action" value="save_all" />
      <input type="hidden" name="payload" value={serializedPayload} />

      <Page
        title={`出荷ルール詳細 / ${toZoneLabel(zone.name)}`}
        backAction={{content: "一覧に戻る", url: "/app/rules"}}
        primaryAction={
          <Button submit variant="primary" disabled={!isSettingsReady}>
            保存
          </Button>
        }
      >
        <BlockStack gap="400">
          <SuccessToast message={successMessage} nonce={location.key} />
          <CriticalBanner message={errorMessage} />
          {!isSettingsReady ? (
            <SettingsRequiredBanner message="全体設定が未完了のため保存できません。" />
          ) : null}

          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                基本設定
              </Text>
              <Text as="p" tone="subdued">
                全体設定: {defaultLeadDays != null ? `${defaultLeadDays}日` : "未設定"}（未入力の場合に適用）
              </Text>
              <TextField
                label="出荷リードタイム（日）"
                autoComplete="off"
                type="number"
                min={1}
                value={baseDays}
                onChange={setBaseDays}
                suffix="日"
                helpText="未入力の場合は全体設定が適用されます。"
                disabled={!isSettingsReady}
              />
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                商品別設定（{productRows.length}件）
              </Text>

              {productRows.length === 0 ? (
                <Text as="p" tone="subdued">
                  商品別設定がありません。
                </Text>
              ) : (
                <BlockStack gap="300">
                  {productRows.map((row, index) => (
                    <Card key={row.clientId}>
                      <BlockStack gap="300">
                        <div>
                          <Text as="p" variant="bodyMd">
                            商品
                          </Text>
                          <div style={{marginTop: 2}}>
                            <ProductPreviewPills
                              products={withProductsForIds(row.productIds, row.products)}
                              onClick={isSettingsReady ? () => openProductPicker(index) : undefined}
                              disabled={!isSettingsReady}
                            />
                          </div>
                        </div>

                        <TextField
                          label="出荷リードタイム（日）"
                          autoComplete="off"
                          type="number"
                          min={1}
                          requiredIndicator
                          value={String(row.days)}
                          onChange={(value) => {
                            const parsed = parsePositiveInt(value);
                            updateProductRule(row.clientId, {days: parsed ?? 1});
                          }}
                          suffix="日"
                          disabled={!isSettingsReady}
                        />

                        <InlineStack align="end">
                          <Button
                            tone="critical"
                            variant="tertiary"
                            onClick={() => removeProductRule(row.clientId)}
                            disabled={!isSettingsReady}
                          >
                            削除
                          </Button>
                        </InlineStack>
                      </BlockStack>
                    </Card>
                  ))}
                </BlockStack>
              )}

              <InlineStack align="start">
                <Button variant="secondary" onClick={addProductRule} disabled={!isSettingsReady}>
                  商品別設定を追加
                </Button>
              </InlineStack>
            </BlockStack>
          </Card>

          <div style={{height: "60px"}}></div>
        </BlockStack>
      </Page>
    </Form>
  );
}
