import {useEffect, useMemo, useRef, useState} from "react";
import type React from "react";
import type {ActionFunctionArgs, LoaderFunctionArgs} from "react-router";
import {Form, redirect, useActionData, useBlocker, useLoaderData, useNavigate} from "react-router";
import {useAppBridge} from "@shopify/app-bridge-react";

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
  FALLBACK_PRODUCT_TITLE,
  selectionToProductSummary,
  toFallbackProduct,
} from "../utils/products";
import {parsePositiveInt} from "../utils/validation";
import type {
  ProductRule,
  ProductRuleWithProducts,
  ProductSummary,
} from "../utils/rule-types";

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


// 選択済み商品をピルで簡易表示し、クリックでピッカーを開くUI
function ProductPreviewPills({
  products,
  onClick,
}: {
  products: ProductSummary[];
  onClick?: () => void;
}) {
  const hasProducts = products.length > 0;
  const [isHovered, setIsHovered] = useState(false);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!onClick) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onClick();
    }
  };

  return (
    <div
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{
        width: "100%",
        height: "2rem",
        padding: "0.125rem",
        borderRadius: "0.5rem",
        border: `1px solid ${isHovered ? "#616161" : "#B7B7B7"}`,
        background: isHovered ? "#FAF9FA" : "transparent",
        cursor: onClick ? "pointer" : "default",
        boxSizing: "border-box",
        display: "flex",
        alignItems: "center",
      }}
    >
      {hasProducts ? (
        // ▼ 商品リスト（チップをそのまま並べる）
        <div style={{display: "flex", flexWrap: "wrap", gap: "0.25rem", alignItems: "center"}}>
          {products.map((product) => (
            <div
              key={product.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                flexShrink: 0,
                height: "1.5rem",
                padding: "0 0.345rem",
                borderRadius: "0.25rem",
                background: "var(--p-color-bg-fill, rgba(227, 227, 227, 1))",
                border: "1px solid var(--p-color-border, rgba(227, 227, 227, 1))",
              }}
            >
              {/* サムネイル */}
              {product.imageUrl ? (
                <img
                  src={product.imageUrl}
                  alt={product.title || FALLBACK_PRODUCT_TITLE}
                  style={{
                    width: "1rem",
                    height: "1rem",
                    objectFit: "cover",
                    borderRadius: 4,
                    flexShrink: 0,
                  }}
                />
              ) : (
                <div
                  aria-hidden="true"
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 4,
                    background: "#F6F6F7",
                    border: "1px solid #DFE3E8",
                    flexShrink: 0,
                  }}
                />
              )}

              {/* タイトル（1行省略） */}
              <s-text
                tone="neutral"
              >
                {product.title || FALLBACK_PRODUCT_TITLE}
              </s-text>
            </div>
          ))}
        </div>
      ) : (
        // ▼ 未選択状態（フィールド内に灰色文字）
        <s-text tone="neutral">
          <div style={{padding: "0 0.5rem"}}>
            商品を選択
          </div>
        </s-text>
      )}
    </div>
  );
}
// 画面側で一意に識別するためのclientIdを付与した編集用ルール
type EditableProductRule = ProductRuleWithProducts & {
  clientId: string;
};

// 配送レートごとの出荷ルール詳細・編集ページ
export default function RuleDetailPage() {
  const {rate, base, productRules, flashMessage} = useLoaderData<LoaderData>();
  const actionData = useActionData<ActionData>();
  const navigate = useNavigate();
  const baseDaysFromLoader = base ? String(base.days) : DEFAULT_BASE_DAYS;
  const [baseDays, setBaseDays] = useState<string>(baseDaysFromLoader);
  const productRowsHydratingRef = useRef(true);
  const shopify = useAppBridge();

  const initialPayloadFromLoader = useMemo(
    () => serializePayload(rate.shippingRateId, baseDaysFromLoader, base?.id ?? null, productRules),
    [base?.days, base?.id, baseDaysFromLoader, productRules, rate.shippingRateId],
  );
  const initialPayloadRef = useRef(initialPayloadFromLoader);
  if (initialPayloadRef.current !== initialPayloadFromLoader) {
    initialPayloadRef.current = initialPayloadFromLoader;
  }

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
    productRowsHydratingRef.current = true;
    setBaseDays(baseDaysFromLoader);
    setProductRows(productRules.map((rule, idx) => hydrateRow(rule, idx)));
  }, [base?.days, base?.id, baseDaysFromLoader, productRules]);

  // productRowsの変更をhidden inputへ伝播させてSaveBarのdirty判定を維持
  useEffect(() => {
    if (productRowsHydratingRef.current) {
      productRowsHydratingRef.current = false;
      return;
    }

    const form = document.getElementById("rule-form") as HTMLFormElement | null;
    const payloadInput = form?.querySelector<HTMLInputElement>('input[name="payload"]');
    if (!payloadInput) return;

    payloadInput.dispatchEvent(new Event("input", {bubbles: true}));
    payloadInput.dispatchEvent(new Event("change", {bubbles: true}));
  }, [productRows]);

  // サーバーへ送るペイロード文字列と変更有無の判定
  const serializedPayload = useMemo(
    () => serializePayload(rate.shippingRateId, baseDays, base?.id ?? null, productRows),
    [rate.shippingRateId, baseDays, base?.id, productRows],
  );
  const isDirty = serializedPayload !== initialPayloadRef.current;

  // ShopifyのSaveBarと同期
  useEffect(() => {
    if (!shopify?.saveBar) return;
    if (isDirty) {
      shopify.saveBar.show?.("rule-form");
    } else {
      shopify.saveBar.hide?.("rule-form");
    }
  }, [isDirty, shopify]);

  // 変更がある場合のみブラウザ遷移をブロック
  const blocker = useBlocker(({currentLocation, nextLocation}) => {
    if (!isDirty) return false;
    if (
      currentLocation.pathname === nextLocation.pathname &&
      currentLocation.search === nextLocation.search &&
      currentLocation.hash === nextLocation.hash
    ) {
      return false;
    }
    return true;
  });

  // SaveBarの離脱確認ダイアログを実行
  useEffect(() => {
    if (blocker.state !== "blocked") return;

    let cancelled = false;
    const confirmLeave = async () => {
      try {
        await shopify?.saveBar?.leaveConfirmation?.();
        if (!cancelled) {
          blocker.proceed();
        }
      } catch {
        blocker.reset();
      }
    };

    confirmLeave();
    return () => {
      cancelled = true;
    };
  }, [blocker, shopify]);

  // ブラウザのリロード・タブクローズ時の警告
  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!isDirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty]);

  // 外部・内部リンククリック時の離脱確認
  useEffect(() => {
    if (!isDirty) return;

    // 離脱確認を挟みつつ外部リンクにも対応
    const handleAnchorNavigation = async (event: MouseEvent) => {
      if (event.defaultPrevented) return;
      if (event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      const target = event.target as HTMLElement | null;
      const anchor = target?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#")) return;

      const url = new URL(href, window.location.href);
      const samePage =
        url.pathname === window.location.pathname &&
        url.search === window.location.search &&
        url.hash === window.location.hash;
      if (samePage) return;

      // Respect external links
      const isExternal = url.origin !== window.location.origin;

      event.preventDefault();

      try {
        await shopify?.saveBar?.leaveConfirmation?.();
      } catch {
        return;
      }

      if (isExternal) {
        window.location.href = url.toString();
      } else {
        navigate(url.pathname + url.search + url.hash);
      }
    };

    document.addEventListener("click", handleAnchorNavigation, true);
    return () => document.removeEventListener("click", handleAnchorNavigation, true);
  }, [isDirty, navigate, shopify]);

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
    <Form method="post" id="rule-form" data-save-bar>
      <input type="hidden" name="_action" value="save_all" />
      <input
        key={initialPayloadRef.current}
        type="hidden"
        name="payload"
        defaultValue={initialPayloadRef.current}
        value={serializedPayload}
      />

      <s-page heading={`出荷ルール詳細 / ${rate.title}`}>
        <s-link slot="breadcrumb-actions" href="/app/rules">
          一覧に戻る
        </s-link>

        {bannerText ? (
          <s-banner tone={bannerTone}>
            <p>{bannerText}</p>
          </s-banner>
        ) : null}

        <s-section heading="基本設定">
          <s-stack direction="block" gap="none">
            <s-text tone="neutral">
              出荷リードタイム（日）
            </s-text>
            <s-text-field
              name="baseDays"
              autocomplete="off"
              value={baseDays}
              onInput={(event: any) => {
                setBaseDays(event.target.value || DEFAULT_BASE_DAYS);
              }}
            />
          </s-stack>
        </s-section>

        <s-section heading={`商品別設定（${productRows.length}件）`}>
          <s-stack gap="small">
            {productRows.length === 0 ? (
              <s-text tone="neutral">商品別設定がありません。</s-text>
            ) : (
              <s-stack gap="small">
                {productRows.map((row, index) => (
                  <s-box
                    key={row.clientId}
                    padding="base"
                    borderWidth="base"
                    borderRadius="base"
                  >
                    {/* 編集モードのみ表示：商品選択・日数・アクションを縦並び、ボタンだけ横並び */}
                    <s-stack direction="block" gap="small">
                      {/* 商品選択 */}
                      <s-stack direction="block" gap="none">
                        <s-text tone="neutral">
                          商品
                        </s-text>
                        <ProductPreviewPills
                          products={withProductsForIds(row.productIds, row.products)}
                          onClick={() => openProductPicker(index)}
                        />
                      </s-stack>

                      {/* 出荷リードタイム */}
                      <s-stack direction="block" gap="none">
                        <s-text tone="neutral">
                          出荷リードタイム（日）
                        </s-text>
                        <s-text-field
                          name={`productDays-${row.clientId}`}
                          autocomplete="off"
                          value={String(row.days)}
                          onInput={(event: any) => {
                            const parsed = parsePositiveInt(event.target.value);
                            updateProductRule(row.clientId, {
                              days: parsed ?? 1,
                            });
                          }}
                        />
                      </s-stack>

                      {/* アクション（横並び） */}
                      <s-stack
                        direction="inline"
                        gap="small"
                      >
                        <s-button
                          type="button"
                          variant="tertiary"
                          tone="critical"
                          onClick={() => removeProductRule(row.clientId)}
                        >
                          削除
                        </s-button>
                      </s-stack>
                    </s-stack>
                  </s-box>
                ))}
              </s-stack>
            )}

            <s-button type="button" variant="secondary" onClick={addProductRule}>
              商品別設定を追加
            </s-button>
          </s-stack>
        </s-section>
      </s-page>
    </Form>
  );
}
