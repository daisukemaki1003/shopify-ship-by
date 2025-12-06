import { useEffect, useMemo, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, redirect, useActionData, useLoaderData, useNavigation } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";

import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import {
  getShippingRates,
  type ShippingRateEntry,
} from "../services/shipping-rates.server";

type ProductRule = {
  id: string | null;
  productIds: string[];
  days: number;
};

type LoaderData = {
  rate: ShippingRateEntry;
  base: { id: string; days: number } | null;
  productRules: ProductRule[];
  flashMessage: { text: string; tone: "success" | "critical" } | null;
};

type ActionData =
  | { ok: true; message: string }
  | { ok: false; message: string };

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

const serializePayload = (rateId: string, baseDays: string, baseId: string | null, productRules: ProductRule[]) => {
  return JSON.stringify({
    rateId,
    base: { id: baseId, days: baseDays },
    productRules,
  });
};

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const rateId = params.rateId ?? "";
  const url = new URL(request.url);
  const flashText = url.searchParams.get("message");
  const flashTone = url.searchParams.get("tone") === "critical" ? "critical" : "success";

  const [rates, rules] = await Promise.all([
    getShippingRates(session.shop),
    prisma.rule.findMany({
      where: { shopId: session.shop },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        targetType: true,
        targetId: true,
        shippingRateIds: true,
        days: true,
        updatedAt: true,
      },
    }),
  ]);

  const rate = rates.find((r) => r.shippingRateId === rateId);
  if (!rate) {
    throw new Response("Not found", { status: 404 });
  }

  const matchesRate = (ruleRateIds: unknown) => {
    if (Array.isArray(ruleRateIds)) {
      return (ruleRateIds as unknown[]).map(String).includes(rateId);
    }
    return false;
  };

  const baseRule = rules.find(
    (rule) => rule.targetType === "all" && matchesRate(rule.shippingRateIds),
  );

  const productRules: ProductRule[] = rules
    .filter((rule) => rule.targetType === "product" && matchesRate(rule.shippingRateIds))
    .map((rule) => ({
      id: rule.id,
      productIds: parseTargetIds(rule.targetId),
      days: rule.days,
    }));

  return {
    rate,
    base: baseRule ? { id: baseRule.id, days: baseRule.days } : null,
    productRules,
    flashMessage: flashText ? { text: flashText, tone: flashTone } : null,
  } satisfies LoaderData;
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const rateId = params.rateId ?? "";
  const form = await request.formData();
  const actionType = String(form.get("_action") ?? "");

  if (actionType !== "save_all") {
    return { ok: false, message: "不明な操作です" } satisfies ActionData;
  }

  const rawPayload = String(form.get("payload") ?? "");
  let payload: {
    rateId: string;
    base: { id: string | null; days: string };
    productRules: ProductRule[];
  } | null = null;

  try {
    payload = JSON.parse(rawPayload);
  } catch {
    return { ok: false, message: "入力内容を解釈できませんでした" } satisfies ActionData;
  }

  if (!payload || payload.rateId !== rateId) {
    return { ok: false, message: "配送ケースが一致しません" } satisfies ActionData;
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
    return { ok: false, message: errors.join(" / ") } satisfies ActionData;
  }

  // Save base rule
  if (payload.base.id) {
    await prisma.rule.updateMany({
      where: { id: payload.base.id, shopId: session.shop },
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
      shippingRateIds: { equals: [rateId] },
    },
    select: { id: true },
  });

  const deleteIds = existingProductRules
    .map((r) => r.id)
    .filter((id) => !incomingIds.has(id));

  if (deleteIds.length > 0) {
    await prisma.rule.deleteMany({
      where: { shopId: session.shop, id: { in: deleteIds } },
    });
  }

  // Upsert product rules
  for (const rule of payload.productRules) {
    const targetId = JSON.stringify(rule.productIds);
    if (rule.id) {
      await prisma.rule.updateMany({
        where: { id: rule.id, shopId: session.shop },
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

function ProductPickerTags({ productIds }: { productIds: string[] }) {
  if (productIds.length === 0) {
    return <s-text tone="subdued">商品が未選択です</s-text>;
  }
  return (
    <s-stack direction="inline" gap="tight" alignment="center" wrap>
      {productIds.map((id) => (
        <s-box key={id} padding="tight" borderWidth="base" borderRadius="base">
          <s-text size="sm">{id}</s-text>
        </s-box>
      ))}
    </s-stack>
  );
}

type EditableProductRule = ProductRule & { clientId: string };

export default function RuleDetailPage() {
  const { rate, base, productRules, flashMessage } = useLoaderData<LoaderData>();
  const actionData = useActionData<ActionData>();
  const navigation = useNavigation();
  const app = useAppBridge() as any;
  const [baseDays, setBaseDays] = useState<string>(base ? String(base.days) : "1");
  const [productRows, setProductRows] = useState<EditableProductRule[]>(
    productRules.map((rule, idx) => ({
      ...rule,
      clientId: rule.id ?? `existing-${idx}`,
    })),
  );

  useEffect(() => {
    setBaseDays(base ? String(base.days) : "1");
    setProductRows(
      productRules.map((rule, idx) => ({
        ...rule,
        clientId: rule.id ?? `existing-${idx}`,
      })),
    );
  }, [base?.days, base?.id, productRules]);

  const isSubmitting = navigation.state !== "idle";

  const serializedPayload = useMemo(
    () => serializePayload(rate.shippingRateId, baseDays, base?.id ?? null, productRows),
    [rate.shippingRateId, baseDays, base?.id, productRows],
  );

  const openProductPicker = async (index: number) => {
    try {
      const result = await app?.resourcePicker?.({
        type: "product",
        multiple: true,
        selection: productRows[index]?.productIds?.map((id) => ({ id })),
      });
      const selection = result?.selection ?? result?.data?.selection ?? [];
      const ids = Array.from(
        new Set(
          (selection as any[]).map((item) => item.id || item.admin_graphql_api_id).filter(Boolean),
        ),
      ).map(String);
      if (ids.length === 0) return;
      setProductRows((prev) =>
        prev.map((row, idx) => (idx === index ? { ...row, productIds: ids } : row)),
      );
    } catch (error) {
      console.error("product picker failed", error);
    }
  };

  const addProductRule = () => {
    setProductRows((prev) => [
      ...prev,
      { id: null, clientId: `new-${Date.now()}`, productIds: [], days: 1 },
    ]);
  };

  const removeProductRule = (clientId: string) => {
    setProductRows((prev) => prev.filter((row) => row.clientId !== clientId));
  };

  const updateProductRule = (clientId: string, patch: Partial<EditableProductRule>) => {
    setProductRows((prev) =>
      prev.map((row) => (row.clientId === clientId ? { ...row, ...patch } : row)),
    );
  };

  const bannerText = actionData?.message ?? flashMessage?.text;
  const bannerTone = actionData ? "critical" : flashMessage?.tone ?? "success";

  return (
    <s-page heading={`出荷ルール詳細 / ${rate.title}`}>
      <Form method="post">
        <input type="hidden" name="_action" value="save_all" />
        <input type="hidden" name="payload" value={serializedPayload} readOnly />

        <s-stack direction="inline" gap="tight" alignment="center" style={{ marginBottom: "12px" }}>
          <s-link href="/app/rules">一覧に戻る</s-link>
          <s-button type="submit" {...(isSubmitting ? { loading: true } : {})}>
            保存
          </s-button>
        </s-stack>

        {bannerText ? (
          <s-text tone={bannerTone} style={{ display: "block", marginBottom: "12px" }}>
            {bannerText}
          </s-text>
        ) : null}

        <s-stack direction="block" gap="base">
          <s-box padding="base" borderWidth="base" borderRadius="base" background="surface">
            <s-stack direction="block" gap="tight">
              <s-text weight="semibold">基本設定（全商品）</s-text>
              <label>
                <s-text tone="subdued">出荷リードタイム（日）</s-text>
                <input
                  type="number"
                  min={1}
                  value={baseDays}
                  onChange={(e) => setBaseDays(e.target.value || "1")}
                  style={{ width: "120px", marginTop: "4px" }}
                  name="baseDaysInput"
                />
              </label>
              <s-text tone="subdued">入力後、ページ上部の「保存」で反映します。</s-text>
            </s-stack>
          </s-box>

          <s-box padding="base" borderWidth="base" borderRadius="base" background="surface">
            <s-stack direction="block" gap="tight">
              <s-stack direction="inline" alignment="center" gap="tight">
                <s-text weight="semibold">商品別設定（{productRows.length} 件）</s-text>
                <s-button type="button" variant="secondary" onClick={addProductRule}>
                  商品別設定を追加
                </s-button>
              </s-stack>
              {productRows.length === 0 ? (
                <s-text tone="subdued">商品別設定がありません。</s-text>
              ) : (
                productRows.map((row, index) => (
                  <s-box
                    key={row.clientId}
                    padding="base"
                    borderWidth="base"
                    borderRadius="base"
                    background="subdued"
                  >
                    <s-stack direction="block" gap="tight">
                      <s-stack direction="inline" gap="tight" alignment="center">
                        <s-text tone="subdued">商品</s-text>
                        <ProductPickerTags productIds={row.productIds} />
                        <s-button type="button" variant="tertiary" onClick={() => openProductPicker(index)}>
                          商品を選択
                        </s-button>
                      </s-stack>
                      <label>
                        <s-text tone="subdued">出荷リードタイム（日）</s-text>
                        <input
                          type="number"
                          min={1}
                          value={row.days}
                          onChange={(e) =>
                            updateProductRule(row.clientId, {
                              days: Number.parseInt(e.target.value || "1", 10),
                            })
                          }
                          style={{ width: "120px", marginTop: "4px" }}
                          name={`productDays-${row.clientId}`}
                        />
                      </label>
                      <s-button type="button" variant="tertiary" tone="critical" onClick={() => removeProductRule(row.clientId)}>
                        削除
                      </s-button>
                    </s-stack>
                  </s-box>
                ))
              )}
            </s-stack>
          </s-box>
        </s-stack>
      </Form>
    </s-page>
  );
}
