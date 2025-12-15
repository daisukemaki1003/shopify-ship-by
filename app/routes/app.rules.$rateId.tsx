import {useEffect, useMemo, useState} from "react";
import type {ActionFunctionArgs, LoaderFunctionArgs} from "react-router";
import {Form, redirect, useActionData, useLoaderData} from "react-router";
import {
  Banner,
  BlockStack,
  Button,
  Card,
  InlineStack,
  Page,
  Text,
  TextField,
} from "@shopify/polaris";

import {authenticate} from "../shopify.server";
import {
  loadRuleDetail,
  normalizeRulePayload,
  persistRulePayload,
  type RulePayload,
  type RuleDetailData,
} from "../services/rules.server";
import {DEFAULT_BASE_DAYS} from "../utils/rules";
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

// 画面描画に必要なデータセット（flashMessageを付与）
type LoaderData = RuleDetailData & {
  flashMessage: {text: string; tone: "success" | "critical"} | null;
};

// 保存処理の結果
type ActionData =
  | {ok: true; message: string}
  | {ok: false; message: string};

// バリデーション済みのペイロードをサーバーへ送るためにシリアライズ
const serializePayload = (
  rateId: string,
  baseDays: string,
  baseId: string | null,
  productRules: Array<ProductRule | ProductRuleWithProducts>,
) => {
  return JSON.stringify({
    rateId,
    base: {id: baseId, days: baseDays},
    productRules: productRules.map((rule) => ({
      id: rule.id,
      productIds: rule.productIds,
      days: rule.days,
    })),
  });
};

// 配送レートに紐づくルール・商品情報を取得する
export const loader = async ({request, params}: LoaderFunctionArgs) => {
  const {session, admin} = await authenticate.admin(request);
  const rateId = params.rateId ?? "";
  const url = new URL(request.url);
  const flashText = url.searchParams.get("message");
  const flashTone = url.searchParams.get("tone") === "critical" ? "critical" : "success";

  const ruleDetail = await loadRuleDetail({
    shopId: session.shop,
    rateId,
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
  const rateId = params.rateId ?? "";
  const form = await request.formData();
  const actionType = String(form.get("_action") ?? "");

  if (actionType !== "save_all") {
    return {ok: false, message: "不明な操作です"} satisfies ActionData;
  }

  const rawPayload = String(form.get("payload") ?? "");
  let payload: RulePayload | null = null;

  try {
    payload = JSON.parse(rawPayload) as RulePayload;
  } catch {
    return {ok: false, message: "入力内容を解釈できませんでした"} satisfies ActionData;
  }

  const normalized = normalizeRulePayload(payload, rateId);
  if (!normalized.ok) {
    return {ok: false, message: normalized.message} satisfies ActionData;
  }

  await persistRulePayload({
    shopId: session.shop,
    rateId,
    baseId: payload.base.id,
    baseDays: normalized.baseDays,
    productRules: normalized.productRules,
  });

  return redirect(`/app/rules/${rateId}?message=${encodeURIComponent("保存しました")}&tone=success`);
};

// 画面側で一意に識別するためのclientIdを付与した編集用ルール
type EditableProductRule = ProductRuleWithProducts & {
  clientId: string;
};

// 配送レートごとの出荷ルール詳細・編集ページ
export default function RuleDetailPage() {
  const {rate, base, productRules, flashMessage} = useLoaderData<LoaderData>();
  const actionData = useActionData<ActionData>();
  const baseDaysFromLoader = base ? String(base.days) : DEFAULT_BASE_DAYS;
  const [baseDays, setBaseDays] = useState<string>(baseDaysFromLoader);

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
    () => serializePayload(rate.shippingRateId, baseDays, base?.id ?? null, productRows),
    [rate.shippingRateId, baseDays, base?.id, productRows],
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
        multiple: true,
        filter: {variants: false},
        selectionIds: productRows[index]?.productIds?.map((id) => ({id})),
        initialSelectionIds: productRows[index]?.productIds?.map((id) => ({id})),
      });
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
      if (ids.length === 0) return;
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
        days: Number.parseInt(DEFAULT_BASE_DAYS, 10),
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

  const bannerText = actionData?.message ?? flashMessage?.text;
  const bannerTone = actionData ? "critical" : flashMessage?.tone ?? "success";

  return (
    <Form
      method="post"
      id="rule-form"
    >
      <input type="hidden" name="_action" value="save_all" />
      <input type="hidden" name="payload" value={serializedPayload} />

      <Page
        title={`出荷ルール詳細 / ${rate.title}`}
        backAction={{content: "一覧に戻る", url: "/app/rules"}}
        primaryAction={<Button submit variant="primary">保存</Button>}
      >
        <BlockStack gap="400">
          {bannerText ? (
            <Banner tone={bannerTone}>
              <p>{bannerText}</p>
            </Banner>
          ) : null}

          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                基本設定
              </Text>
              <TextField
                label="出荷リードタイム（日）"
                autoComplete="off"
                value={baseDays}
                onChange={(value) => setBaseDays(value || DEFAULT_BASE_DAYS)}
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
                              onClick={() => openProductPicker(index)}
                            />
                          </div>
                        </div>

                        <TextField
                          label="出荷リードタイム（日）"
                          autoComplete="off"
                          value={String(row.days)}
                          onChange={(value) => {
                            const parsed = parsePositiveInt(value);
                            updateProductRule(row.clientId, {days: parsed ?? 1});
                          }}
                        />

                        <InlineStack align="end">
                          <Button
                            tone="critical"
                            variant="tertiary"
                            onClick={() => removeProductRule(row.clientId)}
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
                <Button variant="secondary" onClick={addProductRule}>
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
