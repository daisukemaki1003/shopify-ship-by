import { useEffect, useMemo, useState } from "react";
import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
} from "react-router";
import { Form, useActionData, useFetcher, useLoaderData } from "react-router";
import type { RuleTargetType } from "@prisma/client";
import type { ChangeEvent } from "react";

import prisma from "../db.server";
import { authenticate } from "../shopify.server";

type RuleItem = {
  id: string;
  targetType: RuleTargetType;
  targetId: string | null;
  prefectures: string[];
  days: number;
  enabled: boolean;
  updatedAt: string;
};

type LoaderData = { rules: RuleItem[] };
type ActionData =
  | { ok: true; message: string }
  | { ok: false; message: string };

const targetTypeLabel: Record<RuleTargetType, string> = {
  all_products: "全商品",
  product: "商品",
  shipping_method: "配送方法",
};

const parsePrefectures = (raw: string) =>
  raw
    .split(",")
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const rules = await prisma.rule.findMany({
    where: { shopId: session.shop },
    orderBy: { updatedAt: "desc" },
  });

  return {
    rules: rules.map((r) => ({
      id: r.id,
      targetType: r.targetType,
      targetId: r.targetId,
      prefectures: Array.isArray(r.prefectures)
        ? (r.prefectures as string[])
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
    if (actionType === "create_or_update") {
      const id = String(form.get("id") ?? "").trim();
      const targetType = String(
        form.get("targetType") ?? "all_products",
      ) as RuleTargetType;
      const targetIdRaw = String(form.get("targetId") ?? "").trim();
      const days = Number.parseInt(String(form.get("days") ?? "0"), 10);
      const prefectures = parsePrefectures(
        String(form.get("prefectures") ?? ""),
      );

      if (!["product", "all_products", "shipping_method"].includes(targetType)) {
        return {
          ok: false,
          message: "対象タイプが不正です",
        } satisfies ActionData;
      }
      if (!Number.isFinite(days) || days <= 0) {
        return {
          ok: false,
          message: "出荷日数は1以上の整数で入力してください",
        } satisfies ActionData;
      }
      if (prefectures.length === 0) {
        return {
          ok: false,
          message: "都道府県を入力してください（カンマ区切り）",
        } satisfies ActionData;
      }
      if (targetType !== "all_products" && !targetIdRaw) {
        return { ok: false, message: "対象IDを入力してください" } satisfies ActionData;
      }

      const data = {
        shopId: session.shop,
        targetType,
        targetId: targetType === "all_products" ? null : targetIdRaw,
        prefectures,
        days,
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
  prefectures: string;
  days: string;
};

const emptyForm: FormState = {
  id: "",
  targetType: "all_products",
  targetId: "",
  prefectures: "",
  days: "1",
};

export default function RulesPage() {
  const { rules } = useLoaderData<LoaderData>();
  const actionData = useActionData<ActionData>();
  const toggleFetcher = useFetcher<ActionData>();
  const deleteFetcher = useFetcher<ActionData>();
  const [formState, setFormState] = useState<FormState>(emptyForm);

  useEffect(() => {
    if (actionData?.ok) {
      setFormState(emptyForm);
    }
  }, [actionData?.ok]);

  const handleEdit = (rule: RuleItem) => {
    setFormState({
      id: rule.id,
      targetType: rule.targetType,
      targetId: rule.targetId ?? "",
      prefectures: rule.prefectures.join(","),
      days: String(rule.days),
    });
  };

  const entries = useMemo(
    () =>
      rules.map((r) => ({
        ...r,
        updatedAtDate: new Date(r.updatedAt),
      })),
    [rules],
  );

  const handleTargetTypeChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const nextValue = (event.target?.value ?? "all_products") as RuleTargetType;
    setFormState((prev) => ({
      ...prev,
      targetType: nextValue,
      targetId: nextValue === "all_products" ? "" : prev.targetId,
    }));
  };

  const handleInputChange =
    (key: "targetId" | "prefectures" | "days") =>
    (event: ChangeEvent<HTMLInputElement>) => {
      const value = event.target?.value ?? "";
      setFormState((prev) => ({
        ...prev,
        [key]: key === "days" ? value || "1" : value,
      }));
    };

  return (
    <s-page heading="出荷ルール">
      <s-section heading="作成・編集">
        {actionData && (
          <s-badge tone={actionData.ok ? "success" : "critical"}>
            {actionData.message}
          </s-badge>
        )}
        <Form method="post" style={{ marginTop: "12px" }}>
          <input type="hidden" name="_action" value="create_or_update" />
          <input type="hidden" name="id" value={formState.id} />
          <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
            <div style={{ minWidth: "200px" }}>
              <label>
                対象種別
                <select
                  name="targetType"
                  value={formState.targetType}
                  onChange={handleTargetTypeChange}
                >
                  <option value="all_products">全商品</option>
                  <option value="product">商品ID指定</option>
                  <option value="shipping_method">配送方法コード</option>
                </select>
              </label>
            </div>
            {formState.targetType !== "all_products" && (
              <div style={{ minWidth: "200px" }}>
                <label>
                  {formState.targetType === "product"
                    ? "商品ID"
                    : "配送方法コード"}
                  <input
                    name="targetId"
                    value={formState.targetId}
                    onChange={handleInputChange("targetId")}
                  />
                </label>
              </div>
            )}
            <div style={{ minWidth: "240px" }}>
              <label>
                都道府県コード（カンマ区切り）
                <input
                  name="prefectures"
                  placeholder="tokyo,kanagawa"
                  value={formState.prefectures}
                  onChange={handleInputChange("prefectures")}
                />
              </label>
            </div>
            <div style={{ minWidth: "160px" }}>
              <label>
                出荷日数
                <input
                  name="days"
                  type="number"
                  min="1"
                  value={formState.days}
                  onChange={handleInputChange("days")}
                />
              </label>
            </div>
          </div>
          <div style={{ display: "flex", gap: "8px", marginTop: "12px" }}>
            <s-button type="submit">
              {formState.id ? "更新する" : "追加する"}
            </s-button>
            <s-button
              type="button"
              variant="tertiary"
              onClick={() => setFormState(emptyForm)}
            >
              新規作成に戻る
            </s-button>
          </div>
        </Form>
      </s-section>

      <s-section heading="ルール一覧">
        {entries.length === 0 ? (
          <s-text>ルールがありません。作成してください。</s-text>
        ) : (
          <s-stack direction="block" gap="base">
            {entries.map((rule) => (
              <s-box
                key={rule.id}
                padding="base"
                background="subdued"
                borderWidth="base"
                borderRadius="base"
              >
                <s-stack direction="inline" gap="base">
                  <s-text>
                    {targetTypeLabel[rule.targetType]}
                    {rule.targetId ? `: ${rule.targetId}` : ""}
                  </s-text>
                  <s-badge tone={rule.enabled ? "success" : "warning"}>
                    {rule.enabled ? "有効" : "無効"}
                  </s-badge>
                  <s-badge tone="info">{rule.days}日</s-badge>
                  <s-text>
                    都道府県: {rule.prefectures.join(", ") || "指定なし"}
                  </s-text>
                  <s-text>
                    更新: {rule.updatedAtDate.toLocaleString("ja-JP")}
                  </s-text>
                </s-stack>
                <s-stack direction="inline" gap="base">
                  <s-button
                    variant="tertiary"
                    onClick={() => handleEdit(rule)}
                  >
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
                    <s-button variant="tertiary" type="submit">
                      {rule.enabled ? "無効化" : "有効化"}
                    </s-button>
                  </toggleFetcher.Form>
                  <deleteFetcher.Form method="post">
                    <input type="hidden" name="_action" value="delete" />
                    <input type="hidden" name="id" value={rule.id} />
                    <s-button tone="critical" variant="tertiary" type="submit">
                      削除
                    </s-button>
                  </deleteFetcher.Form>
                </s-stack>
              </s-box>
            ))}
          </s-stack>
        )}
      </s-section>
    </s-page>
  );
}
