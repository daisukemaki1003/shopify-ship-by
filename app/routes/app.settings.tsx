import {useEffect, useMemo, useState} from "react";
import type {ActionFunctionArgs, LoaderFunctionArgs, ShouldRevalidateFunction} from "react-router";
import {Form, redirect, useActionData, useLoaderData, useLocation} from "react-router";
import {
  Autocomplete,
  BlockStack,
  Box,
  Button,
  Card,
  Checkbox,
  Page,
  Text,
  TextField,
  RadioButton,
} from "@shopify/polaris";

import prisma from "../db.server";
import {authenticate} from "../shopify.server";
import {parsePositiveInt} from "../utils/validation";
import {CriticalBanner} from "../components/CriticalBanner";
import {SuccessToast} from "../components/SuccessToast";

type LoaderData = {
  defaultLeadDays: number | null;
  deliverySource: "metafield" | "attributes" | null;
  deliveryKey: string | null;
  deliveryFormat: string | null;
  saveMetafield: boolean;
  saveTag: boolean;
  saveNote: boolean;
  saveTagFormat: string | null;
  saveNoteFormat: string | null;
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
const missingCandidateId = (key: string) => `missing:${key}`;

type DeliveryCandidate = {
  id: string;
  source: "metafield" | "attributes";
  key: string;
  sample: string | null;
};

const buildCandidates = (payload: any): DeliveryCandidate[] => {
  const nodes = Array.isArray(payload?.data?.metafieldDefinitions?.nodes)
    ? payload.data.metafieldDefinitions.nodes
    : [];
  const candidates: DeliveryCandidate[] = [];
  const seen = new Set<string>();

  nodes.forEach((node: any) => {
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
      saveMetafield: true,
      saveTag: true,
      saveNote: true,
      saveTagFormat: true,
      saveNoteFormat: true,
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
    saveMetafield: setting?.saveMetafield ?? true,
    saveTag: setting?.saveTag ?? false,
    saveNote: setting?.saveNote ?? false,
    saveTagFormat: setting?.saveTagFormat ?? null,
    saveNoteFormat: setting?.saveNoteFormat ?? null,
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
  const rawSaveNote = form.get("saveNote");
  const rawSaveMetafield = form.get("saveMetafield");
  const rawSaveTagFormat = String(form.get("saveTagFormat") ?? "").trim();
  const rawSaveNoteFormat = String(form.get("saveNoteFormat") ?? "").trim();

  const fieldErrors: NonNullable<Exclude<ActionData, {ok: true}>>["fieldErrors"] = {};
  if (!parsedDays) {
    fieldErrors.defaultLeadDays = "全体設定の出荷リードタイムは1以上の整数で入力してください";
  }
  if (rawSource !== "metafield" && rawSource !== "attributes") {
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

  await prisma.shopSetting.upsert({
    where: {shopId: session.shop},
    create: {
      shopId: session.shop,
      defaultLeadDays: parsedDays,
      deliverySource: rawSource,
      deliveryKey: rawKey,
      deliveryFormat: rawFormat || null,
      saveTag: rawSaveTag === "on",
      saveNote: rawSaveNote === "on",
      saveMetafield: rawSaveMetafield === "on",
      saveTagFormat: rawSaveTagFormat || null,
      saveNoteFormat: rawSaveNoteFormat || null,
    },
    update: {
      defaultLeadDays: parsedDays,
      deliverySource: rawSource,
      deliveryKey: rawKey,
      deliveryFormat: rawFormat || null,
      saveTag: rawSaveTag === "on",
      saveNote: rawSaveNote === "on",
      saveMetafield: rawSaveMetafield === "on",
      saveTagFormat: rawSaveTagFormat || null,
      saveNoteFormat: rawSaveNoteFormat || null,
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
    saveMetafield,
    saveTag,
    saveNote,
    saveTagFormat,
    saveNoteFormat,
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
  const [candidateId, setCandidateId] = useState<string>(() =>
    findCandidateId(deliveryCandidates, deliverySource, deliveryKey),
  );
  const [candidateQuery, setCandidateQuery] = useState("");
  const [isSaveMetafield, setIsSaveMetafield] = useState(saveMetafield);
  const [isSaveTag, setIsSaveTag] = useState(saveTag);
  const [isSaveNote, setIsSaveNote] = useState(saveNote);
  const [tagFormat, setTagFormat] = useState(saveTagFormat ?? "");
  const [noteFormat, setNoteFormat] = useState(saveNoteFormat ?? "");
  const isFormReady =
    parsePositiveInt(leadDays) != null &&
    (source === "metafield" || source === "attributes") &&
    key.trim() !== "";
  const bannerText = actionData && !actionData.ok ? actionData.message : flashMessage?.text;
  const bannerTone = actionData && !actionData.ok ? "critical" : flashMessage?.tone ?? "success";
  const successMessage = bannerTone === "success" ? bannerText : null;
  const errorMessage = bannerTone === "critical" ? bannerText : null;
  const fieldErrors = actionData && !actionData.ok ? actionData.fieldErrors : undefined;
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
    const matched = findCandidateId(deliveryCandidates, nextSource, deliveryKey);
    const missingId =
      nextSource === "metafield" && deliveryKey
        ? missingCandidateId(deliveryKey.trim())
        : "";
    setCandidateId(matched || missingId);
    setIsSaveMetafield(saveMetafield);
    setIsSaveTag(saveTag);
    setIsSaveNote(saveNote);
    setTagFormat(saveTagFormat ?? "");
    setNoteFormat(saveNoteFormat ?? "");
  }, [
    defaultLeadDays,
    deliverySource,
    deliveryKey,
    deliveryFormat,
    saveMetafield,
    saveTag,
    saveNote,
    saveTagFormat,
    saveNoteFormat,
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
        title="全体設定"
        primaryAction={
          <Button submit variant="primary" disabled={!isFormReady}>
            保存
          </Button>
        }
      >
        <BlockStack gap="400">
          <Text as="p" tone="subdued">
            配送エリアにルールがない場合に使用される基準日数を設定します。
          </Text>
          <SuccessToast message={successMessage} nonce={location.key} />
          <CriticalBanner message={errorMessage} />
          <Card>
            <BlockStack gap="200">
              <Text as="h2" variant="headingMd">
                出荷リードタイム（必須）
              </Text>
              <TextField
                label="出荷リードタイム（日）"
                name="defaultLeadDays"
                type="number"
                min={1}
                requiredIndicator
                autoComplete="off"
                value={leadDays}
                onChange={setLeadDays}
                suffix="日"
                helpText="配送エリアにルールが設定されていない場合、この日数が適用されます。"
                error={fieldErrors?.defaultLeadDays}
              />
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                お届け希望日の取得設定（必須）
              </Text>
              <Text as="p" tone="subdued">
                取得元を選び、キーと日付フォーマットを設定します。
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
                              label=""
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
                              候補が見つかりませんでした。メタフィールド定義を追加してください。
                            </Text>
                          }
                        />
                        {missingMetafieldCandidate ? (
                          <Text as="p" tone="critical">
                            現在の設定「{missingMetafieldCandidate.key}」はメタフィールド定義に見つかりません。
                          </Text>
                        ) : null}
                        {fieldErrors?.deliveryKey ? (
                          <Text as="p" tone="critical">
                            {fieldErrors.deliveryKey}
                          </Text>
                        ) : null}
                        <Text as="p" tone="subdued">
                          メタフィールド定義から候補を表示しています。
                        </Text>
                      </BlockStack>
                    </Box>
                  ) : null}
                </BlockStack>
                <BlockStack gap="200">
                  <RadioButton
                    label="注文属性（attributes）"
                    name="deliverySource"
                    checked={source === "attributes"}
                    onChange={(checked) => {
                      if (checked) setSourceValue("attributes");
                    }}
                  />
                  {source === "attributes" ? (
                    <Box paddingInlineStart="400">
                      <BlockStack gap="200">
                        <TextField
                          label=""
                          autoComplete="off"
                          value={attributeKey}
                          onChange={handleAttributeKeyChange}
                          placeholder="requested_date"
                          helpText="注文属性（attributes）に保存されたキー名を入力してください。"
                          error={fieldErrors?.deliveryKey}
                          requiredIndicator
                        />
                      </BlockStack>
                    </Box>
                  ) : null}
                </BlockStack>
              </BlockStack>
              <TextField
                label="日付パースフォーマット"
                autoComplete="off"
                value={format}
                onChange={setFormat}
                placeholder={DEFAULT_DATE_FORMAT}
                helpText={`未入力の場合は ${DEFAULT_DATE_FORMAT} を使用します。`}
              />
              <input type="hidden" name="deliverySource" value={source} />
              <input type="hidden" name="deliveryKey" value={key} />
              <input type="hidden" name="deliveryFormat" value={format} />
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="200">
              <Text as="h2" variant="headingMd">
                保存先設定
              </Text>
              <Checkbox
                label="メタフィールドへ保存"
                name="saveMetafield"
                checked={isSaveMetafield}
                onChange={setIsSaveMetafield}
              />
              <Checkbox
                label="タグへ保存"
                name="saveTag"
                checked={isSaveTag}
                onChange={setIsSaveTag}
              />
              <TextField
                label="タグの保存フォーマット"
                name="saveTagFormat"
                autoComplete="off"
                value={tagFormat}
                onChange={setTagFormat}
                placeholder="ship-by-{YYYY}-{MM}-{DD}"
                helpText="未入力の場合はデフォルトのフォーマットを使用します。"
                disabled={!isSaveTag}
              />
              {!isSaveTag ? (
                <input type="hidden" name="saveTagFormat" value={tagFormat} />
              ) : null}
              <Checkbox
                label="メモへ保存"
                name="saveNote"
                checked={isSaveNote}
                onChange={setIsSaveNote}
              />
              <TextField
                label="メモの保存フォーマット"
                name="saveNoteFormat"
                autoComplete="off"
                value={noteFormat}
                onChange={setNoteFormat}
                placeholder="出荷期限：{YYYY}-{MM}-{DD}"
                helpText="未入力の場合はデフォルトのフォーマットを使用します。"
                disabled={!isSaveNote}
              />
              {!isSaveNote ? (
                <input type="hidden" name="saveNoteFormat" value={noteFormat} />
              ) : null}
            </BlockStack>
          </Card>
        </BlockStack>
      </Page>
    </Form>
  );
}
