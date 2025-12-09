import {useEffect, useMemo, useState} from "react";
import type React from "react";
import type {ActionFunctionArgs, LoaderFunctionArgs} from "react-router";
import {Form, redirect, useActionData, useLoaderData} from "react-router";
import type {AdminApiContext} from "@shopify/shopify-app-react-router/server";

import prisma from "../db.server";
import {authenticate} from "../shopify.server";
import {
  getShippingRates,
  type ShippingRateEntry,
} from "../services/shipping-rates.server";

type ProductRule = {
  id: string | null;
  productIds: string[];
  days: number;
};

type ProductSummary = {
  id: string;
  title: string;
  imageUrl: string | null;
};

type ProductRuleWithProducts = ProductRule & {products: ProductSummary[]};

type LoaderData = {
  rate: ShippingRateEntry;
  base: {id: string; days: number} | null;
  productRules: ProductRuleWithProducts[];
  flashMessage: {text: string; tone: "success" | "critical"} | null;
};

type ActionData =
  | {ok: true; message: string}
  | {ok: false; message: string};

const parseTargetIds = (value: string | null): string[] => {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.map((v) => String(v)).filter(Boolean);
    }
  } catch {
    // fall through
  }
  return [value].filter(Boolean);
};

const chunkArray = <T,>(items: T[], size: number): T[][] => {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size));
  }
  return result;
};

const fetchProductSummaries = async (
  admin: AdminApiContext,
  ids: string[],
): Promise<Map<string, ProductSummary>> => {
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
  const map = new Map<string, ProductSummary>();

  if (uniqueIds.length === 0) return map;

  const chunks = chunkArray(uniqueIds, 20);

  for (const chunk of chunks) {
    try {
      const response = await admin.graphql(
        `#graphql
        query ProductSummaries($ids: [ID!]!) {
          nodes(ids: $ids) {
            __typename
            ... on Product {
              id
              title
              featuredImage { url altText }
              images(first: 1) { nodes { url altText } }
            }
          }
        }
        `,
        {variables: {ids: chunk}},
      );

      const json = await response.json();
      const nodes = (json?.data?.nodes ?? []) as any[];

      nodes.forEach((node) => {
        if (!node || node.__typename !== "Product" || !node.id) return;

        const primaryImage =
          node.featuredImage?.url ??
          node.images?.nodes?.[0]?.url ??
          null;

        map.set(node.id, {
          id: String(node.id),
          title: node.title ?? "商品",
          imageUrl: primaryImage ? String(primaryImage) : null,
        });
      });
    } catch (error) {
      console.error("Failed to fetch product summaries", error);
    }
  }

  return map;
};

const selectionToProductSummary = (item: any): ProductSummary | null => {
  if (!item) return null;

  const id = item.id ?? item.admin_graphql_api_id;
  if (!id) return null;
  // バリエーションは選択対象外
  const idStr = String(id);
  if (idStr.includes("ProductVariant")) return null;

  const title = item.title ?? "商品";
  const imageCandidate =
    item.featuredMedia?.preview?.image?.url ??
    item.featuredMedia?.preview?.image?.src ??
    item.featuredMedia?.preview?.image?.originalSrc ??
    item.featuredMedia?.preview_image?.url ??
    item.featuredMedia?.preview_image?.src ??
    item.featuredMedia?.preview_image?.originalSrc ??
    item.featuredMedia?.preview_image?.transformedSrc ??
    item.featured_media?.preview_image?.transformedSrc ??
    item.featuredMedia?.thumbnail?.url ??
    item.featuredMedia?.thumbnail?.src ??
    item.featuredMedia?.thumbnail?.transformedSrc ??
    item.media?.[0]?.preview?.image?.url ??
    item.media?.[0]?.preview?.image?.src ??
    item.media?.[0]?.preview?.image?.originalSrc ??
    item.media?.[0]?.preview?.image?.transformedSrc ??
    item.featuredImage?.url ??
    item.featuredImage?.src ??
    item.featuredImage?.originalSrc ??
    item.featuredImage?.transformedSrc ??
    item.featured_image?.url ??
    item.featured_image?.src ??
    item.featured_image?.originalSrc ??
    item.featured_image?.transformedSrc ??
    item.image?.url ??
    item.image?.src ??
    item.image?.originalSrc ??
    item.image?.transformedSrc ??
    item.images?.[0]?.url ??
    item.images?.[0]?.src ??
    item.images?.[0]?.originalSrc ??
    item.images?.[0]?.transformedSrc ??
    item.images?.nodes?.[0]?.url ??
    item.images?.nodes?.[0]?.src ??
    item.images?.nodes?.[0]?.originalSrc ??
    item.images?.nodes?.[0]?.transformedSrc ??
    item.images?.edges?.[0]?.node?.url ??
    item.images?.edges?.[0]?.node?.src ??
    item.images?.edges?.[0]?.node?.originalSrc ??
    item.images?.edges?.[0]?.node?.transformedSrc ??
    item.variants?.edges?.[0]?.node?.image?.url ??
    item.variants?.edges?.[0]?.node?.image?.src ??
    item.variants?.edges?.[0]?.node?.image?.originalSrc ??
    item.variants?.edges?.[0]?.node?.image?.transformedSrc ??
    null;

  return {
    id: String(id),
    title: String(title),
    imageUrl: imageCandidate ? String(imageCandidate) : null,
  };
};

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

export const loader = async ({request, params}: LoaderFunctionArgs) => {
  const {session, admin} = await authenticate.admin(request);
  const rateId = params.rateId ?? "";
  const url = new URL(request.url);
  const flashText = url.searchParams.get("message");
  const flashTone = url.searchParams.get("tone") === "critical" ? "critical" : "success";

  const [rates, rules, dbRate] = await Promise.all([
    getShippingRates(session.shop),
    prisma.rule.findMany({
      where: {shopId: session.shop},
      orderBy: {updatedAt: "desc"},
      select: {
        id: true,
        targetType: true,
        targetId: true,
        shippingRateIds: true,
        days: true,
        updatedAt: true,
      },
    }),
    prisma.shippingRate.findFirst({
      where: {shopId: session.shop, shippingRateId: rateId},
      select: {shippingRateId: true, handle: true, title: true, zoneName: true},
    }),
  ]);

  const rate =
    rates.find((r) => r.shippingRateId === rateId) ??
    (dbRate
      ? {
        shippingRateId: dbRate.shippingRateId,
        handle: dbRate.handle,
        title: dbRate.title,
        zoneName: dbRate.zoneName,
      }
      : null);
  if (!rate) {
    throw new Response("Not found", {status: 404});
  }

  const matchesRate = (ruleRateIds: unknown) => {
    if (Array.isArray(ruleRateIds)) {
      const list = (ruleRateIds as unknown[]).map(String);
      if (list.length === 0) return true;
      return list.includes(rateId);
    }
    return false;
  };

  const baseRule = rules.find(
    (rule) => rule.targetType === "all" && matchesRate(rule.shippingRateIds),
  );

  const productRulePayloads: ProductRule[] = rules
    .filter((rule) => rule.targetType === "product" && matchesRate(rule.shippingRateIds))
    .map((rule) => ({
      id: rule.id,
      productIds: parseTargetIds(rule.targetId),
      days: rule.days,
    }));

  const allProductIds = Array.from(
    new Set(productRulePayloads.flatMap((rule) => rule.productIds)),
  );

  const productSummaryMap =
    allProductIds.length > 0
      ? await fetchProductSummaries(admin, allProductIds)
      : new Map<string, ProductSummary>();

  const productRules: ProductRuleWithProducts[] = productRulePayloads.map(
    (rule) => ({
      ...rule,
      products: rule.productIds.map(
        (id) =>
          productSummaryMap.get(id) ?? {
            id,
            title: "商品",
            imageUrl: null,
          },
      ),
    }),
  );

  return {
    rate,
    base: baseRule ? {id: baseRule.id, days: baseRule.days} : null,
    productRules,
    flashMessage: flashText ? {text: flashText, tone: flashTone} : null,
  } satisfies LoaderData;
};

export const action = async ({request, params}: ActionFunctionArgs) => {
  const {session} = await authenticate.admin(request);
  const rateId = params.rateId ?? "";
  const form = await request.formData();
  const actionType = String(form.get("_action") ?? "");

  if (actionType !== "save_all") {
    return {ok: false, message: "不明な操作です"} satisfies ActionData;
  }

  const rawPayload = String(form.get("payload") ?? "");
  let payload: {
    rateId: string;
    base: {id: string | null; days: string};
    productRules: ProductRule[];
  } | null = null;

  try {
    payload = JSON.parse(rawPayload);
  } catch {
    return {ok: false, message: "入力内容を解釈できませんでした"} satisfies ActionData;
  }

  if (!payload || payload.rateId !== rateId) {
    return {ok: false, message: "配送ケースが一致しません"} satisfies ActionData;
  }

  const errors: string[] = [];
  const parsedBaseDays = Number.parseInt(payload.base.days, 10);
  if (!Number.isFinite(parsedBaseDays) || parsedBaseDays <= 0) {
    errors.push("基本設定の出荷リードタイムは1以上の整数で入力してください");
  }

  payload.productRules.forEach((rule, idx) => {
    if (!rule.productIds || rule.productIds.length === 0) {
      errors.push(`商品別設定${idx + 1}: 商品を選択してください`);
    }
    if (!Number.isFinite(rule.days) || rule.days <= 0) {
      errors.push(`商品別設定${idx + 1}: 出荷リードタイムは1以上の整数で入力してください`);
    }
  });

  if (errors.length > 0) {
    return {ok: false, message: errors.join(" / ")} satisfies ActionData;
  }

  // Save base rule
  if (payload.base.id) {
    await prisma.rule.updateMany({
      where: {id: payload.base.id, shopId: session.shop},
      data: {
        targetType: "all",
        targetId: null,
        shippingRateIds: [rateId],
        days: parsedBaseDays,
      },
    });
  } else {
    await prisma.rule.create({
      data: {
        shopId: session.shop,
        targetType: "all",
        targetId: null,
        shippingRateIds: [rateId],
        days: parsedBaseDays,
      },
    });
  }

  const incomingIds = new Set(
    payload.productRules.map((r) => r.id).filter(Boolean) as string[],
  );

  // Delete removed product rules for this rate
  const existingProductRules = await prisma.rule.findMany({
    where: {
      shopId: session.shop,
      targetType: "product",
      shippingRateIds: {equals: [rateId]},
    },
    select: {id: true},
  });

  const deleteIds = existingProductRules
    .map((r) => r.id)
    .filter((id) => !incomingIds.has(id));

  if (deleteIds.length > 0) {
    await prisma.rule.deleteMany({
      where: {shopId: session.shop, id: {in: deleteIds}},
    });
  }

  // Upsert product rules
  for (const rule of payload.productRules) {
    const targetId = JSON.stringify(rule.productIds);
    if (rule.id) {
      await prisma.rule.updateMany({
        where: {id: rule.id, shopId: session.shop},
        data: {
          targetType: "product",
          targetId,
          shippingRateIds: [rateId],
          days: rule.days,
        },
      });
    } else {
      await prisma.rule.create({
        data: {
          shopId: session.shop,
          targetType: "product",
          targetId,
          shippingRateIds: [rateId],
          days: rule.days,
        },
      });
    }
  }

  return redirect(`/app/rules/${rateId}?message=${encodeURIComponent("保存しました")}&tone=success`);
};


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
                  alt={product.title || "商品"}
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
                {product.title || "商品"}
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




type EditableProductRule = ProductRuleWithProducts & {
  clientId: string;
};

export default function RuleDetailPage() {
  const {rate, base, productRules, flashMessage} = useLoaderData<LoaderData>();
  const actionData = useActionData<ActionData>();
  const [baseDays, setBaseDays] = useState<string>(base ? String(base.days) : "1");

  const withProductsForIds = (productIds: string[], products: ProductSummary[]) => {
    const productMap = new Map(products.map((product) => [product.id, product]));
    return productIds.map(
      (id) =>
        productMap.get(id) ?? {
          id,
          title: "商品",
          imageUrl: null,
        },
    );
  };

  const hydrateRow = (rule: ProductRuleWithProducts, idx: number): EditableProductRule => ({
    ...rule,
    products: withProductsForIds(rule.productIds, rule.products ?? []),
    clientId: rule.id ?? `existing-${idx}`,
  });

  const [productRows, setProductRows] = useState<EditableProductRule[]>(() =>
    productRules.map((rule, idx) => hydrateRow(rule, idx)),
  );

  useEffect(() => {
    setBaseDays(base ? String(base.days) : "1");
    setProductRows(productRules.map((rule, idx) => hydrateRow(rule, idx)));
  }, [base?.days, base?.id, productRules]);

  const serializedPayload = useMemo(
    () => serializePayload(rate.shippingRateId, baseDays, base?.id ?? null, productRows),
    [rate.shippingRateId, baseDays, base?.id, productRows],
  );

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
            (id) => selectionMap.get(id) ?? row.products.find((p) => p.id === id) ?? {id, title: "商品", imageUrl: null},
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

  const addProductRule = () => {
    setProductRows((prev) => [
      ...prev,
      {
        id: null,
        clientId: `new-${Date.now()}`,
        productIds: [],
        products: [],
        days: 1,
      },
    ]);
  };

  const removeProductRule = (clientId: string) => {
    setProductRows((prev) => prev.filter((row) => row.clientId !== clientId));
  };

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
      <input type="hidden" name="payload" value={serializedPayload} />

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
                setBaseDays(event.target.value || "1");
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
                            const value = event.target.value || "1";
                            updateProductRule(row.clientId, {
                              days: Number.parseInt(value, 10),
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
