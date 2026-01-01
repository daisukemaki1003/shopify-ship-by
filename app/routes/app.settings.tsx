import {useEffect, useMemo, useState} from "react";
import type {ActionFunctionArgs, LoaderFunctionArgs, ShouldRevalidateFunction} from "react-router";
import type {DeliverySource} from "@prisma/client";
import {Form, redirect, useActionData, useLoaderData, useLocation} from "react-router";
import {
  Autocomplete,
  BlockStack,
  Box,
  Button,
  Card,
  Checkbox,
  Page,
  Select,
  Text,
  TextField,
  RadioButton,
} from "@shopify/polaris";

import prisma from "../db.server";
import {authenticate} from "../shopify.server";
import {parsePositiveInt} from "../shared/utils/validation";
import {CriticalBanner} from "../shared/components/CriticalBanner";
import {SuccessToast} from "../shared/components/SuccessToast";

type LoaderData = {
  defaultLeadDays: number | null;
  deliverySource: "metafield" | "attributes" | null;
  deliveryKey: string | null;
  deliveryFormat: string | null;
  saveTag: boolean;
  saveTagFormat: string | null;
  deliveryCandidates: DeliveryCandidate[];
  flashMessage: {text: string; tone: "success" | "critical"} | null;
};

type ActionData =
  | {ok: true; message: string}
  | {
    ok: false;
    message: string;
    fieldErrors?: {
      defaultLeadDays?: string;
      deliverySource?: string;
      deliveryKey?: string;
    };
  };

const DEFAULT_DATE_FORMAT = "YYYY-MM-DD";
const FORMAT_PRESET_CUSTOM = "__custom__";
const FORMAT_PRESETS = [
  {label: "YYYY/MM/DD (ddd) 例: 2025/12/24 (水)", value: "YYYY/MM/DD (ddd)"},
  {label: "YYYY/MM/DD", value: "YYYY/MM/DD"},
  {label: "YYYY-MM-DD（既定）", value: "YYYY-MM-DD"},
  {label: "YYYY年MM月DD日", value: "YYYY年MM月DD日"},
] as const;
const WEEKDAY_TOKEN = "(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat|日|月|火|水|木|金|土)";
const missingCandidateId = (key: string) => `missing:${key}`;

type DeliveryCandidate = {
  id: string;
  source: "metafield" | "attributes";
  key: string;
  sample: string | null;
};

const buildFormatRegex = (format: string) => {
  const escaped = format.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
  const pattern = escaped
    .replace(/YYYY/g, "(?<year>\\d{4})")
    .replace(/MM/g, "(?<month>\\d{1,2})")
    .replace(/DD/g, "(?<day>\\d{1,2})")
    .replace(/ddd/g, WEEKDAY_TOKEN);
  return new RegExp(`^${pattern}$`);
};

const dateFromParts = (year: number, month: number, day: number) => {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
};

const parseDateWithFormat = (raw: string, format: string) => {
  const regex = buildFormatRegex(format);
  const match = regex.exec(raw.trim());
  if (!match?.groups) return null;

  const year = Number.parseInt(match.groups.year ?? "", 10);
  const month = Number.parseInt(match.groups.month ?? "", 10);
  const day = Number.parseInt(match.groups.day ?? "", 10);

  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return null;
  }

  return dateFromParts(year, month, day);
};

const toISODate = (date: Date) => date.toISOString().slice(0, 10);

const resolvePresetValue = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return FORMAT_PRESET_CUSTOM;
  return FORMAT_PRESETS.some((preset) => preset.value === trimmed)
    ? trimmed
    : FORMAT_PRESET_CUSTOM;
};

type MetafieldDefinitionNode = {
  namespace?: unknown;
  key?: unknown;
};

const buildCandidates = (payload: unknown): DeliveryCandidate[] => {
  const rawNodes = (payload as {data?: {metafieldDefinitions?: {nodes?: unknown}}})?.data
    ?.metafieldDefinitions?.nodes;
  const nodes = Array.isArray(rawNodes) ? (rawNodes as MetafieldDefinitionNode[]) : [];
  const candidates: DeliveryCandidate[] = [];
  const seen = new Set<string>();

  nodes.forEach((node) => {
    const namespace = String(node?.namespace ?? "").trim();
    const key = String(node?.key ?? "").trim();
    if (!namespace || !key) return;
    const fullKey = `${namespace}.${key}`;
    if (seen.has(fullKey)) return;
    seen.add(fullKey);
    candidates.push({
      id: `metafield:${fullKey}`,
      source: "metafield",
      key: fullKey,
      sample: null,
    });
  });

  return candidates.slice(0, 50);
};

const findCandidateId = (
  candidates: DeliveryCandidate[],
  source: string | null,
  key: string | null,
) => {
  if (!source || !key) return "";
  const match = candidates.find((candidate) => candidate.source === source && candidate.key === key);
  return match?.id ?? "";
};

export const loader = async ({request}: LoaderFunctionArgs) => {
  const {session, admin} = await authenticate.admin(request);
  const url = new URL(request.url);
  const flashText = url.searchParams.get("message");
  const flashTone = url.searchParams.get("tone") === "critical" ? "critical" : "success";

  const setting = await prisma.shopSetting.findUnique({
    where: {shopId: session.shop},
    select: {
      defaultLeadDays: true,
      deliverySource: true,
      deliveryKey: true,
      deliveryFormat: true,
      saveTag: true,
      saveTagFormat: true,
    },
  });

  let deliveryCandidates: DeliveryCandidate[] = [];

  try {
    const response = await admin.graphql(
      `#graphql
      query DeliveryCandidates($first: Int!) {
        metafieldDefinitions(ownerType: ORDER, first: $first) {
          nodes {
            namespace
            key
          }
        }
      }`,
      {variables: {first: 50}},
    );
    const json = await response.json();
    deliveryCandidates = buildCandidates(json);
  } catch (error) {
    console.warn("[settings] failed to load delivery candidates", error);
  }

  return {
    defaultLeadDays: setting?.defaultLeadDays ?? null,
    deliverySource: setting?.deliverySource ?? null,
    deliveryKey: setting?.deliveryKey ?? null,
    deliveryFormat: setting?.deliveryFormat ?? null,
    saveTag: setting?.saveTag ?? false,
    saveTagFormat: setting?.saveTagFormat ?? null,
    deliveryCandidates,
    flashMessage: flashText ? {text: flashText, tone: flashTone} : null,
  } satisfies LoaderData;
};

export const action = async ({request}: ActionFunctionArgs) => {
  const {session} = await authenticate.admin(request);
  const url = new URL(request.url);
  const host = url.searchParams.get("host");
  const form = await request.formData();
  const rawDays = form.get("defaultLeadDays");
  const parsedDays = parsePositiveInt(rawDays);
  const rawSource = String(form.get("deliverySource") ?? "").trim();
  const rawKey = String(form.get("deliveryKey") ?? "").trim();
  const rawFormat = String(form.get("deliveryFormat") ?? "").trim();
  const rawSaveTag = form.get("saveTag");
  const saveTag = rawSaveTag != null;
  const rawSaveTagFormat = String(form.get("saveTagFormat") ?? "").trim();

  const fieldErrors: NonNullable<Exclude<ActionData, {ok: true}>>["fieldErrors"] = {};
  if (!parsedDays) {
    fieldErrors.defaultLeadDays = "設定の出荷日数は1以上の整数で入力してください";
  }
  const isValidSource = rawSource === "metafield" || rawSource === "attributes";
  if (!isValidSource) {
    fieldErrors.deliverySource = "取得方法を選択してください";
  }
  if (!rawKey) {
    fieldErrors.deliveryKey = "取得キーを入力してください";
  }

  if (Object.keys(fieldErrors).length > 0) {
    return {
      ok: false,
      message: "入力内容を確認してください",
      fieldErrors,
    } satisfies ActionData;
  }

  const deliverySource = rawSource as DeliverySource;

  await prisma.shopSetting.upsert({
    where: {shopId: session.shop},
    create: {
      shopId: session.shop,
      defaultLeadDays: parsedDays,
      deliverySource,
      deliveryKey: rawKey,
      deliveryFormat: rawFormat || null,
      saveTag,
      saveMetafield: true,
      saveTagFormat: rawSaveTagFormat || null,
    },
    update: {
      defaultLeadDays: parsedDays,
      deliverySource,
      deliveryKey: rawKey,
      deliveryFormat: rawFormat || null,
      saveTag,
      saveMetafield: true,
      saveTagFormat: rawSaveTagFormat || null,
    },
  });

  const redirectUrl = host
    ? `/app/settings?host=${encodeURIComponent(host)}&message=${encodeURIComponent("保存しました")}&tone=success`
    : `/app/settings?message=${encodeURIComponent("保存しました")}&tone=success`;

  return redirect(redirectUrl);
};

export const shouldRevalidate: ShouldRevalidateFunction = ({
  actionResult,
  defaultShouldRevalidate,
  formMethod,
}) => {
  if (
    formMethod &&
    actionResult &&
    typeof actionResult === "object" &&
    "ok" in actionResult &&
    (actionResult as ActionData).ok === false
  ) {
    return false;
  }
  return defaultShouldRevalidate;
};

export default function SettingsPage() {
  const {
    defaultLeadDays,
    deliverySource,
    deliveryKey,
    deliveryFormat,
    saveTag,
    saveTagFormat,
    deliveryCandidates,
    flashMessage,
  } = useLoaderData<LoaderData>();
  const actionData = useActionData<ActionData>();
  const location = useLocation();
  const [leadDays, setLeadDays] = useState(defaultLeadDays ? String(defaultLeadDays) : "");
  const initialSource = deliverySource ?? "metafield";
  const [source, setSource] = useState<string>(initialSource);
  const [key, setKey] = useState(deliveryKey ?? "");
  const [metafieldKey, setMetafieldKey] = useState(
    initialSource === "metafield" ? deliveryKey ?? "" : "",
  );
  const [attributeKey, setAttributeKey] = useState(
    initialSource === "attributes" ? deliveryKey ?? "" : "",
  );
  const [format, setFormat] = useState(deliveryFormat ?? "");
  const [formatPresetSelection, setFormatPresetSelection] = useState(
    resolvePresetValue(deliveryFormat ?? ""),
  );
  const [formatSample, setFormatSample] = useState("");
  const [candidateId, setCandidateId] = useState<string>(() =>
    findCandidateId(deliveryCandidates, deliverySource, deliveryKey),
  );
  const [candidateQuery, setCandidateQuery] = useState("");
  const [isSaveTag, setIsSaveTag] = useState(saveTag);
  const [tagFormat, setTagFormat] = useState(saveTagFormat ?? "");
  const isFormReady =
    parsePositiveInt(leadDays) != null &&
    (source === "metafield" || source === "attributes") &&
    key.trim() !== "";
  const bannerText = actionData && !actionData.ok ? actionData.message : flashMessage?.text;
  const bannerTone = actionData && !actionData.ok ? "critical" : flashMessage?.tone ?? "success";
  const successMessage = bannerTone === "success" ? bannerText : null;
  const errorMessage = bannerTone === "critical" ? bannerText : null;
  const fieldErrors = actionData && !actionData.ok ? actionData.fieldErrors : undefined;
  const formatPreview = useMemo(() => {
    const sample = formatSample.trim();
    if (!sample) return null;
    const trimmedFormat = format.trim();
    const formatForPreview = trimmedFormat || DEFAULT_DATE_FORMAT;
    const formatHint = trimmedFormat ? "" : `（既定: ${DEFAULT_DATE_FORMAT}）`;
    const parsed = parseDateWithFormat(sample, formatForPreview);
    if (!parsed) {
      return {
        ok: false,
        message: `「${formatForPreview}」に一致しません${formatHint}。括弧やスペースも一致が必要です。`,
      };
    }
    return {ok: true, value: toISODate(parsed), hint: formatHint};
  }, [format, formatSample]);
  const missingMetafieldCandidate = useMemo(() => {
    if (source !== "metafield") return null;
    const trimmedKey = key.trim();
    if (!trimmedKey) return null;
    const exists = deliveryCandidates.some(
      (candidate) => candidate.source === "metafield" && candidate.key === trimmedKey,
    );
    if (exists) return null;
    return {
      id: missingCandidateId(trimmedKey),
      source: "metafield",
      key: trimmedKey,
      sample: null,
    } satisfies DeliveryCandidate;
  }, [deliveryCandidates, key, source]);
  const candidateMap = useMemo(
    () => {
      const map = new Map(deliveryCandidates.map((candidate) => [candidate.id, candidate]));
      if (missingMetafieldCandidate) {
        map.set(missingMetafieldCandidate.id, missingMetafieldCandidate);
      }
      return map;
    },
    [deliveryCandidates, missingMetafieldCandidate],
  );
  const candidateOptions = useMemo(
    () => {
      const base = deliveryCandidates.map((candidate) => ({
        label: candidate.key,
        value: candidate.id,
      }));
      if (!missingMetafieldCandidate) return base;
      return [
        {
          label: `${missingMetafieldCandidate.key}（未検出）`,
          value: missingMetafieldCandidate.id,
        },
        ...base,
      ];
    },
    [deliveryCandidates, missingMetafieldCandidate],
  );
  const filteredCandidateOptions = useMemo(() => {
    if (!candidateQuery.trim()) return candidateOptions;
    const query = candidateQuery.trim().toLowerCase();
    return candidateOptions.filter((option) => option.label.toLowerCase().includes(query));
  }, [candidateOptions, candidateQuery]);
  const setSourceValue = (nextSource: "metafield" | "attributes") => {
    setSource(nextSource);
    if (nextSource === "metafield") {
      setKey(metafieldKey);
      if (!format.trim()) {
        setFormat(DEFAULT_DATE_FORMAT);
      }
    } else {
      setKey(attributeKey);
    }
  };

  const handleFormatPresetChange = (value: string) => {
    setFormatPresetSelection(value);
    if (value === FORMAT_PRESET_CUSTOM) return;
    setFormat(value);
  };

  const handleCandidateQueryChange = (value: string) => {
    setCandidateQuery(value);
    if (!candidateId) return;
    const selected = candidateMap.get(candidateId);
    if (!selected || selected.key !== value) {
      setCandidateId("");
      setMetafieldKey("");
      if (source === "metafield") {
        setKey("");
      }
    }
  };

  const handleCandidateSelect = (selected: string[]) => {
    const value = selected[0] ?? "";
    setCandidateId(value);
    if (!value) {
      setMetafieldKey("");
      if (source === "metafield") {
        setKey("");
      }
      return;
    }
    const candidate = candidateMap.get(value);
    if (!candidate) return;
    setSource("metafield");
    setMetafieldKey(candidate.key);
    setKey(candidate.key);
    setCandidateQuery(candidate.key);
    if (!format.trim()) {
      setFormat(DEFAULT_DATE_FORMAT);
    }
  };

  const handleCandidateClear = () => {
    setCandidateQuery("");
    setCandidateId("");
    setMetafieldKey("");
    if (source === "metafield") {
      setKey("");
    }
  };

  const handleAttributeKeyChange = (value: string) => {
    setAttributeKey(value);
    setKey(value);
  };

  useEffect(() => {
    setLeadDays(defaultLeadDays ? String(defaultLeadDays) : "");
    const nextSource = deliverySource ?? "metafield";
    setSource(nextSource);
    setKey(deliveryKey ?? "");
    setMetafieldKey(nextSource === "metafield" ? deliveryKey ?? "" : "");
    setAttributeKey(nextSource === "attributes" ? deliveryKey ?? "" : "");
    setFormat(deliveryFormat ?? "");
    setFormatPresetSelection(resolvePresetValue(deliveryFormat ?? ""));
    const matched = findCandidateId(deliveryCandidates, nextSource, deliveryKey);
    const missingId =
      nextSource === "metafield" && deliveryKey
        ? missingCandidateId(deliveryKey.trim())
        : "";
    setCandidateId(matched || missingId);
    setIsSaveTag(saveTag);
    setTagFormat(saveTagFormat ?? "");
  }, [
    defaultLeadDays,
    deliverySource,
    deliveryKey,
    deliveryFormat,
    saveTag,
    saveTagFormat,
    deliveryCandidates,
  ]);

  useEffect(() => {
    if (candidateId) {
      const candidate = candidateMap.get(candidateId);
      if (candidate) {
        setCandidateQuery(candidate.key);
      }
      return;
    }
    if (source === "metafield" && metafieldKey) {
      setCandidateQuery(metafieldKey);
    } else {
      setCandidateQuery("");
    }
  }, [candidateId, candidateMap, metafieldKey, source]);

  return (
    <Form method="post">
      <Page
        title="設定"
        primaryAction={
          <Button submit variant="primary" disabled={!isFormReady}>
            保存
          </Button>
        }
      >
        <BlockStack gap="400">
          <Text as="p" tone="subdued">
            配送エリアにルールがない場合に使う基準日数を設定します。
          </Text>
          <SuccessToast message={successMessage} nonce={location.key} />
          <CriticalBanner message={errorMessage} />
          <Card>
            <BlockStack gap="200">
              <Text as="h2" variant="headingMd">
                出荷までの日数（必須）
              </Text>
              <TextField
                label="出荷までの日数"
                name="defaultLeadDays"
                type="number"
                min={1}
                requiredIndicator
                autoComplete="off"
                value={leadDays}
                onChange={setLeadDays}
                suffix="日"
                helpText="配送エリアのルールが未設定なら、この日数で計算します。"
                error={fieldErrors?.defaultLeadDays}
              />
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                お届け希望日の取得元（必須）
              </Text>
              <Text as="p" tone="subdued">
                取得元とキー、日付の形式を指定します。
              </Text>
              {fieldErrors?.deliverySource || fieldErrors?.deliveryKey ? (
                <Text as="p" tone="critical">
                  {fieldErrors.deliverySource ?? fieldErrors.deliveryKey}
                </Text>
              ) : null}
              <BlockStack gap="300">
                <BlockStack gap="200">
                  <RadioButton
                    label="メタフィールド"
                    name="deliverySource"
                    value="metafield"
                    checked={source === "metafield"}
                    onChange={(checked) => {
                      if (checked) setSourceValue("metafield");
                    }}
                  />
                  {source === "metafield" ? (
                    <Box paddingInlineStart="400">
                      <BlockStack gap="100">
                        <Autocomplete
                          options={filteredCandidateOptions}
                          selected={candidateId ? [candidateId] : []}
                          textField={
                            <Autocomplete.TextField
                              label="注文メタフィールド候補"
                              value={candidateQuery}
                              onChange={handleCandidateQueryChange}
                              placeholder="shipping.requested_date"
                              autoComplete="off"
                              clearButton
                              onClearButtonClick={handleCandidateClear}
                            />
                          }
                          onSelect={handleCandidateSelect}
                          emptyState={
                            <Text as="p" tone="subdued">
                              候補がありません。注文メタフィールド定義を追加してください。
                            </Text>
                          }
                        />
                        {missingMetafieldCandidate ? (
                          <Text as="p" tone="critical">
                            現在の設定「{missingMetafieldCandidate.key}」は注文メタフィールド定義にありません。
                          </Text>
                        ) : null}
                        {fieldErrors?.deliveryKey ? (
                          <Text as="p" tone="critical">
                            {fieldErrors.deliveryKey}
                          </Text>
                        ) : null}
                        <Text as="p" tone="subdued">
                          注文メタフィールド定義から候補を表示しています。
                        </Text>
                      </BlockStack>
                    </Box>
                  ) : null}
                </BlockStack>
                <BlockStack gap="200">
                  <RadioButton
                    label="注文属性（attributes）"
                    name="deliverySource"
                    value="attributes"
                    checked={source === "attributes"}
                    onChange={(checked) => {
                      if (checked) setSourceValue("attributes");
                    }}
                  />
                  {source === "attributes" ? (
                    <Box paddingInlineStart="400">
                      <BlockStack gap="200">
                        <TextField
                          label="注文属性キー"
                          autoComplete="off"
                          value={attributeKey}
                          onChange={handleAttributeKeyChange}
                          placeholder="requested_date"
                          helpText="注文属性（attributes）に保存されているキー名を入力してください。"
                          error={fieldErrors?.deliveryKey}
                          requiredIndicator
                        />
                      </BlockStack>
                    </Box>
                  ) : null}
                </BlockStack>
              </BlockStack>
              <Select
                label="日付フォーマットのテンプレート"
                options={[
                  ...FORMAT_PRESETS.map((preset) => ({
                    label: preset.label,
                    value: preset.value,
                  })),
                  {label: "カスタム（手入力）", value: FORMAT_PRESET_CUSTOM},
                ]}
                value={formatPresetSelection}
                onChange={handleFormatPresetChange}
                helpText="よく使う形式から選べます。"
              />
              {formatPresetSelection === FORMAT_PRESET_CUSTOM ? (
                <TextField
                  label="日付の読み取りフォーマット"
                  autoComplete="off"
                  value={format}
                  onChange={setFormat}
                  placeholder={DEFAULT_DATE_FORMAT}
                  helpText="テンプレートを選ぶと自動入力されます。必要なら変更してください。"
                />
              ) : null}
              <TextField
                label="サンプル値（任意）"
                autoComplete="off"
                value={formatSample}
                onChange={setFormatSample}
                placeholder="2025/12/24 (水)"
                helpText="入力すると読み取り結果を表示します。"
              />
              {formatPreview ? (
                <Text as="p" tone={formatPreview.ok ? "success" : "critical"}>
                  {formatPreview.ok
                    ? `読み取り結果: ${formatPreview.value}${formatPreview.hint ?? ""}`
                    : formatPreview.message}
                </Text>
              ) : null}
              <input type="hidden" name="deliveryKey" value={key} />
              <input type="hidden" name="deliveryFormat" value={format} />
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="200">
              <Text as="h2" variant="headingMd">
                保存先
              </Text>
              <Checkbox
                label="タグへ保存"
                name="saveTag"
                checked={isSaveTag}
                onChange={setIsSaveTag}
              />
              <TextField
                label="タグの書式"
                name="saveTagFormat"
                autoComplete="off"
                value={tagFormat}
                onChange={setTagFormat}
                placeholder="ship-by-{YYYY}-{MM}-{DD}"
                helpText="未入力なら既定の書式を使います。"
                disabled={!isSaveTag}
              />
              {!isSaveTag ? (
                <input type="hidden" name="saveTagFormat" value={tagFormat} />
              ) : null}
            </BlockStack>
          </Card>
        </BlockStack>


        <div style={{height: "60px"}}></div>
      </Page>
    </Form>
  );
}
