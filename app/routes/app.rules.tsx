import {useEffect, useMemo, useState} from "react";
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
import type {RuleTargetType} from "@prisma/client";
import type {ChangeEvent} from "react";

import prisma from "../db.server";
import {authenticate} from "../shopify.server";
import prefectureGroups from "../prefectures.json";

type RuleItem = {
  id: string;
  targetType: RuleTargetType;
  targetId: string | null;
  prefectures: string[];
  days: number;
  enabled: boolean;
  updatedAt: string;
};

type LoaderData = {rules: RuleItem[]};
type ActionData =
  | {ok: true; message: string}
  | {ok: false; message: string};

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

export const loader = async ({request}: LoaderFunctionArgs) => {
  const {session} = await authenticate.admin(request);
  const rules = await prisma.rule.findMany({
    where: {shopId: session.shop},
    orderBy: {updatedAt: "desc"},
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

export const action = async ({request}: ActionFunctionArgs) => {
  const {session} = await authenticate.admin(request);
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
        return {ok: false, message: "対象IDを入力してください"} satisfies ActionData;
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
          where: {id, shopId: session.shop},
          data,
        });
        return {ok: true, message: "ルールを更新しました"} satisfies ActionData;
      }

      await prisma.rule.create({data});
      return {ok: true, message: "ルールを追加しました"} satisfies ActionData;
    }

    if (actionType === "toggle") {
      const id = String(form.get("id") ?? "");
      const enabled = form.get("enabled") === "true";
      await prisma.rule.updateMany({
        where: {id, shopId: session.shop},
        data: {enabled},
      });
      return {ok: true, message: "状態を更新しました"} satisfies ActionData;
    }

    if (actionType === "delete") {
      const id = String(form.get("id") ?? "");
      await prisma.rule.deleteMany({where: {id, shopId: session.shop}});
      return {ok: true, message: "削除しました"} satisfies ActionData;
    }

    return {ok: false, message: "不明な操作です"} satisfies ActionData;
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

type Prefecture = {code: string; label: string};
type PrefectureGroup = {region: string; label: string; items: Prefecture[]};

const PREFECTURE_GROUPS = prefectureGroups as PrefectureGroup[];
const PREFECTURE_ORDER = PREFECTURE_GROUPS.flatMap((group) =>
  group.items.map((item) => item.code),
);

const formatPrefectures = (prefectures: string[]) => {
  if (!prefectures.length) return "指定なし";
  if (prefectures.length <= 3) return prefectures.join(", ");

  const visible = prefectures.slice(0, 3).join(", ");
  const remaining = prefectures.length - 3;
  return `${visible} +${remaining}`;
};

type PrefectureMultiSelectProps = {
  value: string;
  onChange: (next: string) => void;
};

function PrefectureMultiSelect({value, onChange}: PrefectureMultiSelectProps) {
  const [query, setQuery] = useState("");
  const selected = useMemo(
    () => value.split(",").map((p) => p.trim()).filter(Boolean),
    [value],
  );

  const handleToggle = (code: string) => {
    const exists = selected.includes(code);
    const next = exists ? selected.filter((c) => c !== code) : [...selected, code];
    const ordered = PREFECTURE_ORDER.filter((c) => next.includes(c));
    onChange(ordered.join(","));
  };

  const matchesQuery = (pref: Prefecture) => {
    if (!query.trim()) return true;
    const normalized = query.toLowerCase();
    return pref.code.includes(normalized) || pref.label.includes(query);
  };

  const selectionLabel =
    selected.length === 0
      ? "選択済み: 0件"
      : (() => {
        const labels = selected
          .map(
            (code) =>
              PREFECTURE_GROUPS.flatMap((g) => g.items).find((p) => p.code === code)?.label ?? code,
          );
        const preview = labels.slice(0, 3).join(", ");
        const suffix = labels.length > 3 ? "…" : "";
        return `選択済み: ${labels.length}件（${preview}${suffix}）`;
      })();

  return (
    <s-stack direction="block" gap="tight">
      <s-text style={{color: "var(--p-text-subdued, #5c5f62)"}}>{selectionLabel}</s-text>
      <s-box padding="tight" borderWidth="base" borderRadius="base" background="transparent">
        <input
          type="search"
          placeholder="都道府県を検索"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{
            width: "100%",
            marginBottom: "8px",
            padding: "8px",
            border: "1px solid var(--p-border, #d1d5db)",
            borderRadius: "6px",
          }}
        />
        <div style={{maxHeight: "200px", overflowY: "auto"}}>
          <s-stack direction="block" gap="tight">
            {PREFECTURE_GROUPS.map((group) => (
              <div key={group.region}>
                <s-text tone="subdued">{group.label}</s-text>
                <div style={{display: "grid", gap: "6px", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))"}}>
                  {group.items.filter(matchesQuery).map((pref) => (
                    <label
                      key={pref.code}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        padding: "4px 0",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={selected.includes(pref.code)}
                        onChange={() => handleToggle(pref.code)}
                      />
                      <s-text>{pref.label}</s-text>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </s-stack>
        </div>
      </s-box>
    </s-stack>
  );
}

type RuleFormDrawerProps = {
  open: boolean;
  mode: "create" | "edit";
  formState: FormState;
  actionData?: ActionData | null;
  activeRule: RuleItem | null;
  toggleFetcher: ReturnType<typeof useFetcher<ActionData>>;
  deleteFetcher: ReturnType<typeof useFetcher<ActionData>>;
  onClose: () => void;
  onTargetTypeChange: (event: ChangeEvent<HTMLSelectElement>) => void;
  onInputChange: (key: "targetId" | "days") => (event: ChangeEvent<HTMLInputElement>) => void;
  onPrefectureChange: (next: string) => void;
};

function RuleFormDrawer({
  open,
  mode,
  formState,
  actionData,
  activeRule,
  toggleFetcher,
  deleteFetcher,
  onClose,
  onTargetTypeChange,
  onInputChange,
  onPrefectureChange,
}: RuleFormDrawerProps) {
  if (!open) return null;

  const mutedTextStyle = {color: "var(--p-text-subdued, #5c5f62)"};

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        justifyContent: "flex-end",
        zIndex: 20,
        background: "rgba(22, 29, 37, 0.45)",
        height: "100vh",
        overflow: "hidden",
      }}
    >
      <div style={{flex: 1}} onClick={onClose} />
      <s-box
        padding="base"
        borderWidth="base"
        borderRadius="none"
        style={{
          width: "420px",
          maxWidth: "90vw",
          height: "100vh",
          overflowY: "auto",
          boxShadow: "-8px 0 24px rgba(22, 29, 37, 0.16)",
          backgroundColor: "var(--p-surface, #ffffff)",
          borderLeft: "1px solid var(--p-border-subdued, #dfe3e8)",
        }}
      >
        <s-stack direction="block" gap="base">
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              paddingBottom: "8px",
              borderBottom: "1px solid var(--p-border-subdued, #e1e3e5)",
            }}
          >
            <s-text>{mode === "edit" ? "ルールを編集" : "新規ルールを追加"}</s-text>
            <s-button variant="tertiary" onClick={onClose}>
              閉じる
            </s-button>
          </div>
          {actionData && (
            <s-box
              padding="base"
              borderRadius="base"
              style={{
                background: actionData.ok
                  ? "var(--p-surface-success, #e7f5ed)"
                  : "var(--p-surface-critical, #fdecea)",
                border: `1px solid ${actionData.ok ? "var(--p-border-success, #1b806a)" : "var(--p-border-critical, #d82c0d)"
                  }`,
              }}
            >
              <s-text>
                {actionData.ok ? "✓" : "!"} {actionData.message}
              </s-text>
            </s-box>
          )}
          <s-text style={mutedTextStyle}>
            対象・都道府県・日数を設定し保存します。保存すると一覧が更新されます。
          </s-text>
          <Form method="post">
            <input type="hidden" name="_action" value="create_or_update" />
            <input type="hidden" name="id" value={formState.id} />
            <s-stack direction="block" gap="base">
              <s-box padding="base" borderWidth="base" borderRadius="base">
                <s-stack direction="block" gap="tight">
                  <s-text>対象</s-text>
                  <label>
                    <s-text tone="subdued">対象種別</s-text>
                    <select
                      name="targetType"
                      value={formState.targetType}
                      onChange={onTargetTypeChange}
                      style={{width: "100%", marginTop: "6px"}}
                    >
                      <option value="all_products">全商品</option>
                      <option value="product">商品ID指定</option>
                      <option value="shipping_method">配送方法コード</option>
                    </select>
                  </label>
                  {formState.targetType !== "all_products" && (
                    <label>
                      <s-text tone="subdued">
                        {formState.targetType === "product" ? "商品ID" : "配送方法コード"}
                      </s-text>
                      <input
                        name="targetId"
                        value={formState.targetId}
                        onChange={onInputChange("targetId")}
                        style={{width: "100%", marginTop: "6px"}}
                        placeholder={
                          formState.targetType === "product" ? "例: 1234567890" : "例: yamato_cool"
                        }
                      />
                    </label>
                  )}
                </s-stack>
              </s-box>

              <s-box padding="base" borderWidth="base" borderRadius="base">
                <s-stack direction="block" gap="tight">
                  <s-text>地域と日数</s-text>
                  <PrefectureMultiSelect value={formState.prefectures} onChange={onPrefectureChange} />
                  <input type="hidden" name="prefectures" value={formState.prefectures} />
                  <label>
                    <s-text tone="subdued">出荷日数</s-text>
                    <input
                      name="days"
                      type="number"
                      min="1"
                      value={formState.days}
                      onChange={onInputChange("days")}
                      style={{width: "100%", marginTop: "6px"}}
                    />
                  </label>
                  <s-text style={mutedTextStyle}>入力例: 3 → お届け日の3日前に出荷</s-text>
                </s-stack>
              </s-box>
            </s-stack>
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: "8px",
                marginTop: "12px",
                paddingTop: "12px",
                borderTop: "1px solid var(--p-border-subdued, #e1e3e5)",
              }}
            >
              <s-button type="button" variant="tertiary" onClick={onClose}>
                キャンセル
              </s-button>
              <s-button type="submit">{mode === "edit" ? "更新する" : "追加する"}</s-button>
            </div>
            {mode === "edit" && activeRule && (
              <s-box
                padding="base"
                borderWidth="base"
                borderRadius="base"
                background="transparent"
                style={{marginTop: "12px"}}
              >
                <s-stack direction="block" gap="tight">
                  <s-text tone="subdued">このルールの操作</s-text>
                  <toggleFetcher.Form method="post">
                    <input type="hidden" name="_action" value="toggle" />
                    <input type="hidden" name="id" value={activeRule.id} />
                    <input
                      type="hidden"
                      name="enabled"
                      value={activeRule.enabled ? "false" : "true"}
                    />
                    <s-button variant="tertiary" tone={activeRule.enabled ? "warning" : undefined} type="submit">
                      {activeRule.enabled ? "無効にする" : "有効にする"}
                    </s-button>
                  </toggleFetcher.Form>
                  <deleteFetcher.Form method="post">
                    <input type="hidden" name="_action" value="delete" />
                    <input type="hidden" name="id" value={activeRule.id} />
                    <s-button tone="critical" variant="tertiary" type="submit">
                      削除する
                    </s-button>
                  </deleteFetcher.Form>
                </s-stack>
              </s-box>
            )}
          </Form>
        </s-stack>
      </s-box>
    </div>
  );
}

export default function RulesPage() {
  const {rules} = useLoaderData<LoaderData>();
  const actionData = useActionData<ActionData>();
  const toggleFetcher = useFetcher<ActionData>();
  const deleteFetcher = useFetcher<ActionData>();
  const revalidator = useRevalidator();
  const [formState, setFormState] = useState<FormState>(emptyForm);
  const [activeRule, setActiveRule] = useState<RuleItem | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const editingRuleId = activeRule?.id ?? null;

  useEffect(() => {
    if (actionData?.ok) {
      setFormState(emptyForm);
      setActiveRule(null);
      setDrawerOpen(false);
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
    setActiveRule(rule);
    setDrawerOpen(true);
  };

  const entries = useMemo(
    () =>
      rules.map((r) => ({
        ...r,
        updatedAtDate: new Date(r.updatedAt),
      })),
    [rules],
  );

  useEffect(() => {
    if (actionData?.ok || toggleFetcher.data || deleteFetcher.data) {
      revalidator.revalidate();
    }
  }, [actionData?.ok, toggleFetcher.data, deleteFetcher.data, revalidator]);

  const handleTargetTypeChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const nextValue = (event.target?.value ?? "all_products") as RuleTargetType;
    setFormState((prev) => ({
      ...prev,
      targetType: nextValue,
      targetId: nextValue === "all_products" ? "" : prev.targetId,
    }));
  };

  const handleInputChange =
    (key: "targetId" | "days") =>
      (event: ChangeEvent<HTMLInputElement>) => {
        const value = event.target?.value ?? "";
        setFormState((prev) => ({
          ...prev,
          [key]: key === "days" ? value || "1" : value,
        }));
      };

  const handlePrefectureChange = (next: string) => {
    setFormState((prev) => ({...prev, prefectures: next}));
  };

  const handleOpenCreate = () => {
    setActiveRule(null);
    setFormState(emptyForm);
    setDrawerOpen(true);
  };

  const handleCloseDrawer = () => {
    setActiveRule(null);
    setFormState(emptyForm);
    setDrawerOpen(false);
  };

  useEffect(() => {
    if (deleteFetcher.data?.ok) {
      setFormState(emptyForm);
      setActiveRule(null);
      setDrawerOpen(false);
    }
  }, [deleteFetcher.data?.ok]);

  const mutedTextStyle = {color: "var(--p-text-subdued, #5c5f62)"};
  const formatTarget = (rule: RuleItem) => {
    if (rule.targetType === "all_products") return "全商品";
    if (rule.targetType === "product") return `商品: ${rule.targetId ?? "-"}`;
    return `配送方法: ${rule.targetId ?? "-"}`;
  };
  const formatCondition = (rule: RuleItem) => `${rule.days}日 / ${formatPrefectures(rule.prefectures)}`;

  return (
    <s-page heading="出荷ルール">
      <s-stack direction="block" gap="base">
        {actionData && (
          <s-box
            padding="base"
            borderRadius="base"
            style={{
              background: actionData.ok
                ? "var(--p-surface-success, #e7f5ed)"
                : "var(--p-surface-critical, #fdecea)",
              border: `1px solid ${actionData.ok ? "var(--p-border-success, #1b806a)" : "var(--p-border-critical, #d82c0d)"
                }`,
            }}
          >
            <s-text>
              {actionData.ok ? "✓" : "!"} {actionData.message}
            </s-text>
          </s-box>
        )}

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "12px",
          }}
        >
          <div>
            <s-text>出荷ルールの一覧と状態を管理します。商品や配送方法ごとに出荷日数を設定できます。</s-text>
          </div>
          <s-button onClick={handleOpenCreate}>新規ルールを追加</s-button>
        </div>

        <s-box padding="base" borderWidth="base" borderRadius="large">
          <s-stack direction="block" gap="base">
            <div style={{display: "flex", gap: "12px", alignItems: "center"}}>
              <s-text>ルール一覧</s-text>
              <s-text tone="subdued">{entries.length} 件</s-text>
            </div>
            {entries.length === 0 ? (
              <s-text>ルールがありません。右上の「新規ルールを追加」から登録してください。</s-text>
            ) : (
              <div style={{overflowX: "auto"}}>
                <table style={{width: "100%", borderCollapse: "collapse"}}>
                  <thead>
                    <tr style={{textAlign: "left", borderBottom: "1px solid var(--p-border-subdued, #e1e3e5)"}}>
                      <th style={{padding: "12px 8px"}}>対象</th>
                      <th style={{padding: "12px 8px"}}>条件サマリー</th>
                      <th style={{padding: "12px 8px"}}>状態</th>
                      <th style={{padding: "12px 8px"}}>更新日時</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((rule) => {
                      const isRowEditing = editingRuleId === rule.id;
                      return (
                        <tr
                          key={rule.id}
                          style={{
                            borderBottom: "1px solid var(--p-border-subdued, #e1e3e5)",
                            background: isRowEditing ? "var(--p-surface-primary-subdued, #f4f8ff)" : undefined,
                          }}
                        >
                          <td style={{padding: "12px 8px"}}>
                            <s-stack direction="inline" gap="tight">
                              <s-text>{formatTarget(rule)}</s-text>
                              {isRowEditing && <s-badge tone="info">編集中</s-badge>}
                            </s-stack>
                          </td>
                          <td style={{padding: "12px 8px"}}>
                            <s-text>{formatCondition(rule)}</s-text>
                          </td>
                          <td style={{padding: "12px 8px"}}>
                            <s-badge tone={rule.enabled ? "success" : "warning"}>
                              {rule.enabled ? "有効" : "無効"}
                            </s-badge>
                          </td>
                          <td style={{padding: "12px 8px"}}>
                            <s-text style={mutedTextStyle}>
                              {rule.updatedAtDate.toLocaleString("ja-JP")}
                            </s-text>
                          </td>
                          <td style={{padding: "12px 8px", textAlign: "right"}}>
                            <s-button variant="tertiary" onClick={() => handleEdit(rule)}>
                              編集
                            </s-button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </s-stack>
        </s-box>
      </s-stack>

      <RuleFormDrawer
        open={drawerOpen}
        mode={activeRule ? "edit" : "create"}
        formState={formState}
        actionData={actionData}
        onClose={handleCloseDrawer}
        onTargetTypeChange={handleTargetTypeChange}
        onInputChange={handleInputChange}
        onPrefectureChange={handlePrefectureChange}
      />
    </s-page>
  );
}
