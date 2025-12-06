import { useEffect, useMemo, useState } from "react";
import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
} from "react-router";
import {
  Form,
  useActionData,
  useFetcher,
  useLoaderData,
  useRevalidator,
} from "react-router";
import type { RuleTargetType } from "@prisma/client";
import type { ChangeEvent } from "react";

import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import {
  getShippingRates,
  syncShippingRates,
  type ShippingRateEntry,
} from "../services/shipping-rates.server";

type RuleItem = {
  id: string;
  targetType: RuleTargetType;
  targetId: string | null;
  shippingRateIds: string[];
  days: number;
  enabled: boolean;
  updatedAt: string;
};

type LoaderData = {
  shippingRates: ShippingRateEntry[];
  rules: RuleItem[];
};

type ActionErrors = Partial<Record<"shippingRateId" | "targetId" | "days", string>>;

type ActionData =
  | { ok: true; message: string }
  | { ok: false; message: string; errors?: ActionErrors };

const parseCsv = (raw: string) =>
  raw
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const [rates, rules] = await Promise.all([
    getShippingRates(session.shop),
    prisma.rule.findMany({
      where: { shopId: session.shop },
      orderBy: { updatedAt: "desc" },
    }),
  ]);

  return {
    shippingRates: rates,
    rules: rules.map((r) => ({
      id: r.id,
      targetType: r.targetType,
      targetId: r.targetId,
      shippingRateIds: Array.isArray(r.shippingRateIds)
        ? (r.shippingRateIds as string[])
        : [],
      days: r.days,
      enabled: r.enabled,
      updatedAt: r.updatedAt.toISOString(),
    })),
  } satisfies LoaderData;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const actionType = String(form.get("_action") ?? "");

  try {
    if (actionType === "sync_rates") {
      await syncShippingRates(session.shop);
      return { ok: true, message: "配送ケースを同期しました" } satisfies ActionData;
    }

    if (actionType === "create_or_update") {
      const id = String(form.get("id") ?? "").trim();
      const targetType = String(form.get("targetType") ?? "all") as RuleTargetType;
      const targetIdRaw = String(form.get("targetId") ?? "").trim();
      const days = Number.parseInt(String(form.get("days") ?? "0"), 10);
      const shippingRateId = String(form.get("shippingRateId") ?? "").trim();
      const enabled = form.get("enabled") === "true";

      const errors: ActionErrors = {};
      if (!shippingRateId) errors.shippingRateId = "配送ケースを選択してください";
      if (!["product", "all"].includes(targetType)) {
        return { ok: false, message: "対象タイプが不正です" } satisfies ActionData;
      }
      if (!Number.isFinite(days) || days <= 0) {
        errors.days = "出荷日数は1以上の整数で入力してください";
      }
      if (targetType === "product" && !targetIdRaw) {
        errors.targetId = "商品IDを入力してください";
      }
      if (Object.keys(errors).length > 0) {
        return { ok: false, message: "入力内容を確認してください", errors } satisfies ActionData;
      }

      const data = {
        shopId: session.shop,
        targetType,
        targetId: targetType === "all" ? null : targetIdRaw,
        shippingRateIds: [shippingRateId],
        days,
        enabled,
      };

      if (id) {
        await prisma.rule.updateMany({
          where: { id, shopId: session.shop },
          data,
        });
        return { ok: true, message: "ルールを更新しました" } satisfies ActionData;
      }

      await prisma.rule.create({ data });
      return { ok: true, message: "ルールを追加しました" } satisfies ActionData;
    }

    if (actionType === "toggle") {
      const id = String(form.get("id") ?? "");
      const enabled = form.get("enabled") === "true";
      await prisma.rule.updateMany({
        where: { id, shopId: session.shop },
        data: { enabled },
      });
      return { ok: true, message: "状態を更新しました" } satisfies ActionData;
    }

    if (actionType === "delete") {
      const id = String(form.get("id") ?? "");
      await prisma.rule.deleteMany({ where: { id, shopId: session.shop } });
      return { ok: true, message: "削除しました" } satisfies ActionData;
    }

    return { ok: false, message: "不明な操作です" } satisfies ActionData;
  } catch (error) {
    console.error("[rules action] failed", error);
    return {
      ok: false,
      message: "保存中にエラーが発生しました",
    } satisfies ActionData;
  }
};

type FormState = {
  id: string;
  targetType: RuleTargetType;
  targetId: string;
  shippingRateId: string;
  days: string;
  enabled: boolean;
};

const emptyForm: FormState = {
  id: "",
  targetType: "all",
  targetId: "",
  shippingRateId: "",
  days: "1",
  enabled: true,
};

type RuleModalProps = {
  open: boolean;
  mode: "create" | "edit";
  formState: FormState;
  shippingRates: ShippingRateEntry[];
  actionData?: ActionData | null;
  onClose: () => void;
  onChange: (next: Partial<FormState>) => void;
  toggleFetcher: ReturnType<typeof useFetcher<ActionData>>;
  deleteFetcher: ReturnType<typeof useFetcher<ActionData>>;
};

function RuleModal({
  open,
  mode,
  formState,
  shippingRates,
  actionData,
  onClose,
  onChange,
  toggleFetcher,
  deleteFetcher,
}: RuleModalProps) {
  if (!open) return null;

  const fieldError = (field: keyof ActionErrors) =>
    actionData?.ok === false ? actionData.errors?.[field] : undefined;
  const isSubmitting = toggleFetcher.state !== "idle" || deleteFetcher.state !== "idle";

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        background: "rgba(22, 29, 37, 0.45)",
        zIndex: 30,
        padding: "16px",
      }}
    >
      <div style={{ flex: 1 }} onClick={onClose} />
      <s-box
        padding="base"
        borderRadius="base"
        borderWidth="base"
        background="surface"
        style={{ width: "420px", maxWidth: "90vw" }}
      >
        <s-stack direction="block" gap="base">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <s-text>{mode === "edit" ? "ルールを編集" : "出荷ルールを追加"}</s-text>
            <s-button variant="tertiary" onClick={onClose}>
              閉じる
            </s-button>
          </div>
          {actionData && (
            <s-box
              padding="tight"
              borderRadius="base"
              background={actionData.ok ? "success" : "critical"}
              tone="strong"
            >
              <s-text>{actionData.message}</s-text>
            </s-box>
          )}
          <Form method="post">
            <input type="hidden" name="_action" value="create_or_update" />
            <input type="hidden" name="id" value={formState.id} />
            <s-stack direction="block" gap="base">
              <label>
                <s-text tone="subdued">配送ケース</s-text>
                <select
                  name="shippingRateId"
                  value={formState.shippingRateId}
                  onChange={(e) => onChange({ shippingRateId: e.target.value })}
                  style={{ width: "100%", marginTop: "4px" }}
                >
                  <option value="">選択してください</option>
                  {shippingRates.map((rate) => (
                    <option key={rate.shippingRateId} value={rate.shippingRateId}>
                      {rate.title} / {rate.zoneName ?? "zone?"}
                    </option>
                  ))}
                </select>
                {fieldError("shippingRateId") && (
                  <s-text tone="critical" size="sm">{fieldError("shippingRateId")}</s-text>
                )}
              </label>

              <label>
                <s-text tone="subdued">対象</s-text>
                <select
                  name="targetType"
                  value={formState.targetType}
                  onChange={(e) =>
                    onChange({ targetType: e.target.value as RuleTargetType, targetId: "" })
                  }
                  style={{ width: "100%", marginTop: "4px" }}
                >
                  <option value="all">全商品（基本設定）</option>
                  <option value="product">商品を指定する</option>
                </select>
              </label>

              <label>
                <s-text tone="subdued">商品ID</s-text>
                <input
                  name="targetId"
                  value={formState.targetId}
                  onChange={(e) => onChange({ targetId: e.target.value })}
                  disabled={formState.targetType === "all"}
                  placeholder="例: 1234567890"
                  style={{ width: "100%", marginTop: "4px" }}
                />
                {fieldError("targetId") && (
                  <s-text tone="critical" size="sm">{fieldError("targetId")}</s-text>
                )}
              </label>

              <label>
                <s-text tone="subdued">出荷リードタイム（日数）</s-text>
                <input
                  name="days"
                  type="number"
                  min="1"
                  value={formState.days}
                  onChange={(e) => onChange({ days: e.target.value || "1" })}
                  style={{ width: "100%", marginTop: "4px" }}
                />
              </label>

              <label>
                <s-text tone="subdued">状態</s-text>
                <div style={{ display: "flex", gap: "8px", alignItems: "center", marginTop: "4px" }}>
                  <s-text tone="subdued">無効</s-text>
                  <input
                    type="checkbox"
                    name="enabled"
                    value="true"
                    checked={formState.enabled}
                    onChange={(e) => onChange({ enabled: e.target.checked })}
                  />
                  <s-text tone="subdued">有効</s-text>
                </div>
              </label>
            </s-stack>

            <div style={{ display: "flex", justifyContent: "space-between", marginTop: "12px" }}>
              {mode === "edit" && formState.id ? (
                <deleteFetcher.Form method="post">
                  <input type="hidden" name="_action" value="delete" />
                  <input type="hidden" name="id" value={formState.id} />
                  <s-button tone="critical" variant="tertiary" type="submit">
                    削除する
                  </s-button>
                </deleteFetcher.Form>
              ) : (
                <div />
              )}
              <div style={{ display: "flex", gap: "8px" }}>
                <s-button type="button" variant="tertiary" onClick={onClose}>
                  キャンセル
                </s-button>
                <s-button type="submit" {...(isSubmitting ? { loading: true, disabled: true } : {})}>
                  保存する
                </s-button>
              </div>
            </div>
          </Form>
        </s-stack>
      </s-box>
      <div style={{ flex: 1 }} onClick={onClose} />
    </div>
  );
}

export default function RulesPage() {
  const { shippingRates, rules } = useLoaderData<LoaderData>();
  const actionData = useActionData<ActionData>();
  const toggleFetcher = useFetcher<ActionData>();
  const deleteFetcher = useFetcher<ActionData>();
  const revalidator = useRevalidator();
  const syncFetcher = useFetcher<ActionData>();
  const [formState, setFormState] = useState<FormState>(emptyForm);
  const [modalOpen, setModalOpen] = useState(false);

  const grouped = useMemo(() => {
    const map = new Map<string, { rate: ShippingRateEntry; rules: RuleItem[] }>();
    shippingRates.forEach((rate) => {
      map.set(rate.shippingRateId, { rate, rules: [] });
    });
    rules.forEach((rule) => {
      const rateId = rule.shippingRateIds[0];
      const bucket = map.get(rateId);
      if (bucket) {
        bucket.rules.push(rule);
      }
    });
    return Array.from(map.values());
  }, [shippingRates, rules]);

  useEffect(() => {
    if (actionData?.ok) {
      setFormState(emptyForm);
      setModalOpen(false);
    }
  }, [actionData?.ok]);

  useEffect(() => {
    if (actionData?.ok || toggleFetcher.data || deleteFetcher.data) {
      revalidator.revalidate();
    }
  }, [actionData?.ok, toggleFetcher.data, deleteFetcher.data, revalidator]);

  const openCreate = (shippingRateId: string) => {
    setFormState({
      ...emptyForm,
      shippingRateId,
    });
    setModalOpen(true);
  };

  const openEdit = (rule: RuleItem) => {
    setFormState({
      id: rule.id,
      targetType: rule.targetType,
      targetId: rule.targetId ?? "",
      shippingRateId: rule.shippingRateIds[0] ?? "",
      days: String(rule.days),
      enabled: rule.enabled,
    });
    setModalOpen(true);
  };

  const baseRule = (rulesForRate: RuleItem[]) =>
    rulesForRate.find((r) => r.targetType === "all") ?? null;

  const productRules = (rulesForRate: RuleItem[]) =>
    rulesForRate.filter((r) => r.targetType === "product");

  return (
    <s-page heading="出荷ルール（配送ケース別）">
      <s-stack direction="inline" gap="base" alignment="center" wrap>
        <syncFetcher.Form method="post">
          <input type="hidden" name="_action" value="sync_rates" />
          <s-button type="submit" {...(syncFetcher.state !== "idle" ? { loading: true } : {})}>
            配送ケースを同期
          </s-button>
        </syncFetcher.Form>
        {actionData && actionData.message ? (
          <s-text tone={actionData.ok ? "success" : "critical"}>{actionData.message}</s-text>
        ) : null}
        <s-badge tone="info">
          配送ケース: {shippingRates.length} / ルール: {rules.length}
        </s-badge>
      </s-stack>

      <s-stack direction="block" gap="base" style={{ marginTop: "12px" }}>
        {grouped.length === 0 ? (
          <s-box padding="base" background="subdued" borderWidth="base">
            <s-text>配送ケースがありません。同期ボタンを押してください。</s-text>
          </s-box>
        ) : (
          grouped.map(({ rate, rules: ruleList }) => {
            const base = baseRule(ruleList);
            const products = productRules(ruleList);
            return (
              <s-box
                key={rate.shippingRateId}
                padding="base"
                borderWidth="base"
                borderRadius="large"
              >
                <s-stack direction="block" gap="tight">
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: "8px",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <s-stack direction="inline" gap="tight" alignment="center">
                      <s-text>{rate.title}</s-text>
                      {rate.zoneName ? <s-badge tone="info">{rate.zoneName}</s-badge> : null}
                      <s-text tone="subdued" size="sm">
                        {rate.shippingRateId} / {rate.handle}
                      </s-text>
                    </s-stack>
                    <s-stack direction="inline" gap="tight" alignment="center">
                      <s-badge tone={rate.enabled ? "success" : "warning"}>
                        {rate.enabled ? "有効" : "無効"}
                      </s-badge>
                      <s-badge tone="info">商品ルール {products.length}</s-badge>
                    </s-stack>
                  </div>

                  <s-box padding="base" background="subdued" borderWidth="base" borderRadius="base">
                    <s-text>◉ 基本設定（全商品）</s-text>
                    {base ? (
                      <s-stack direction="inline" gap="tight" alignment="center" wrap>
                        <s-text>出荷日数: {base.days}日</s-text>
                        <s-badge tone={base.enabled ? "success" : "warning"}>
                          {base.enabled ? "有効" : "無効"}
                        </s-badge>
                        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                          <s-button variant="tertiary" onClick={() => openEdit(base)}>
                            編集
                          </s-button>
                          <toggleFetcher.Form method="post">
                            <input type="hidden" name="_action" value="toggle" />
                            <input type="hidden" name="id" value={base.id} />
                            <input type="hidden" name="enabled" value={base.enabled ? "false" : "true"} />
                            <s-button variant="tertiary" {...(toggleFetcher.state !== "idle" ? { loading: true } : {})}>
                              {base.enabled ? "無効化" : "有効化"}
                            </s-button>
                          </toggleFetcher.Form>
                        </div>
                      </s-stack>
                    ) : (
                      <s-stack direction="inline" gap="tight" alignment="center">
                        <s-text tone="subdued">基本設定がありません。</s-text>
                        <s-button variant="secondary" onClick={() => openCreate(rate.shippingRateId)}>
                          基本設定を追加
                        </s-button>
                      </s-stack>
                    )}
                  </s-box>

                  <s-stack direction="block" gap="tight">
                    <s-text>・商品別ルール</s-text>
                    {products.length === 0 ? (
                      <s-stack direction="inline" gap="tight" alignment="center">
                        <s-text tone="subdued">商品別ルールはありません。</s-text>
                        <s-button variant="secondary" onClick={() => openCreate(rate.shippingRateId)}>
                          ➕ 追加する
                        </s-button>
                      </s-stack>
                    ) : (
                      products.map((rule) => (
                        <s-box
                          key={rule.id}
                          padding="tight"
                          borderWidth="base"
                          borderRadius="base"
                          background="transparent"
                        >
                          <s-stack direction="inline" gap="tight" alignment="center" wrap>
                            <s-text>商品ID: {rule.targetId ?? "-"}</s-text>
                            <s-text>出荷日数: {rule.days}日</s-text>
                            <s-badge tone={rule.enabled ? "success" : "warning"}>
                              {rule.enabled ? "有効" : "無効"}
                            </s-badge>
                            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                              <s-button variant="tertiary" onClick={() => openEdit(rule)}>
                                編集
                              </s-button>
                              <toggleFetcher.Form method="post">
                                <input type="hidden" name="_action" value="toggle" />
                                <input type="hidden" name="id" value={rule.id} />
                                <input
                                  type="hidden"
                                  name="enabled"
                                  value={rule.enabled ? "false" : "true"}
                                />
                                <s-button variant="tertiary" {...(toggleFetcher.state !== "idle" ? { loading: true } : {})}>
                                  {rule.enabled ? "無効化" : "有効化"}
                                </s-button>
                              </toggleFetcher.Form>
                            </div>
                          </s-stack>
                        </s-box>
                      ))
                    )}
                  </s-stack>

                  <s-button
                    variant="secondary"
                    tone="success"
                    onClick={() => openCreate(rate.shippingRateId)}
                  >
                    ➕ この配送ケースにルールを追加
                  </s-button>
                </s-stack>
              </s-box>
            );
          })
        )}
      </s-stack>

      <RuleModal
        open={modalOpen}
        mode={formState.id ? "edit" : "create"}
        formState={formState}
        shippingRates={shippingRates}
        actionData={actionData}
        onClose={() => {
          setModalOpen(false);
          setFormState(emptyForm);
        }}
        onChange={(next) => setFormState((prev) => ({ ...prev, ...next }))}
        toggleFetcher={toggleFetcher}
        deleteFetcher={deleteFetcher}
      />
    </s-page>
  );
}
