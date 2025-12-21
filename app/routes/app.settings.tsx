import {useEffect, useState} from "react";
import type {ActionFunctionArgs, LoaderFunctionArgs, ShouldRevalidateFunction} from "react-router";
import {Form, redirect, useActionData, useLoaderData, useLocation, useRevalidator} from "react-router";
import {BlockStack, Button, Card, Checkbox, Page, Select, Text, TextField} from "@shopify/polaris";

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
  const revalidator = useRevalidator();
  const [leadDays, setLeadDays] = useState(defaultLeadDays ? String(defaultLeadDays) : "");
  const [source, setSource] = useState<string>(deliverySource ?? "");
  const [key, setKey] = useState(deliveryKey ?? "");
  const [format, setFormat] = useState(deliveryFormat ?? "");
  const [candidateId, setCandidateId] = useState<string>(() =>
    findCandidateId(deliveryCandidates, deliverySource, deliveryKey),
  );
  const [showManual, setShowManual] = useState<boolean>(() => {
    const matched = findCandidateId(deliveryCandidates, deliverySource, deliveryKey);
    return deliveryCandidates.length === 0 || !matched;
  });
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
  const candidateMap = new Map(deliveryCandidates.map((candidate) => [candidate.id, candidate]));
  const selectedCandidate = candidateId ? candidateMap.get(candidateId) : null;
  const isRefreshingCandidates = revalidator.state === "loading";
  const candidateOptions = [
    {label: "候補から選択してください", value: ""},
    ...deliveryCandidates.map((candidate) => ({
      label: `${candidate.source === "metafield" ? "メタフィールド" : "注文属性"}: ${candidate.key}`,
      value: candidate.id,
    })),
  ];

  const handleCandidateChange = (value: string) => {
    setCandidateId(value);
    if (!value) {
      setShowManual(true);
      return;
    }
    const candidate = candidateMap.get(value);
    if (!candidate) {
      setShowManual(true);
      return;
    }
    setSource(candidate.source);
    setKey(candidate.key);
    if (!format.trim()) {
      setFormat(DEFAULT_DATE_FORMAT);
    }
    setShowManual(false);
  };

  const toggleManual = () => {
    setShowManual((current) => {
      const next = !current;
      if (next) {
        setCandidateId("");
      }
      return next;
    });
  };

  useEffect(() => {
    setLeadDays(defaultLeadDays ? String(defaultLeadDays) : "");
    setSource(deliverySource ?? "");
    setKey(deliveryKey ?? "");
    setFormat(deliveryFormat ?? "");
    const matched = findCandidateId(deliveryCandidates, deliverySource, deliveryKey);
    setCandidateId(matched);
    setShowManual(deliveryCandidates.length === 0 || !matched);
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
    if (!selectedCandidate || showManual) return;
    setSource(selectedCandidate.source);
    setKey(selectedCandidate.key);
    if (!format.trim()) {
      setFormat(DEFAULT_DATE_FORMAT);
    }
  }, [format, selectedCandidate, showManual]);

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
            <BlockStack gap="200">
              <Text as="h2" variant="headingMd">
                お届け希望日の取得設定（必須）
              </Text>
              {fieldErrors?.deliverySource || fieldErrors?.deliveryKey ? (
                <Text as="p" tone="critical">
                  {fieldErrors.deliverySource ?? fieldErrors.deliveryKey}
                </Text>
              ) : null}
              {deliveryCandidates.length > 0 ? (
                <>
                  <Select
                    label="候補"
                    options={candidateOptions}
                    value={candidateId}
                    onChange={handleCandidateChange}
                  />
                  {selectedCandidate ? (
                    <Text as="p" tone="subdued">
                      取得方法: {selectedCandidate.source === "metafield" ? "メタフィールド" : "注文属性"} / キー:{" "}
                      {selectedCandidate.key}
                      {selectedCandidate.sample ? ` / 例: ${selectedCandidate.sample}` : ""}
                    </Text>
                  ) : (
                    <Text as="p" tone="subdued">
                      メタフィールド定義から候補を表示しています。該当がなければ手動で入力してください。
                    </Text>
                  )}
                  <Button
                    variant="secondary"
                    onClick={() => revalidator.revalidate()}
                    loading={isRefreshingCandidates}
                  >
                    候補を再取得
                  </Button>
                  <Button
                    variant="plain"
                    onClick={toggleManual}
                  >
                    {showManual ? "候補選択を使う" : "手動で入力する"}
                  </Button>
                </>
              ) : (
                <>
                  <Text as="p" tone="subdued">
                    メタフィールド定義から候補が見つかりませんでした。手動で入力してください。
                  </Text>
                  <Button
                    variant="secondary"
                    onClick={() => revalidator.revalidate()}
                    loading={isRefreshingCandidates}
                  >
                    候補を再取得
                  </Button>
                </>
              )}
              {showManual ? (
                <>
                  <Select
                    label="取得方法"
                    name="deliverySource"
                    options={[
                      {label: "選択してください", value: ""},
                      {label: "メタフィールド", value: "metafield"},
                      {label: "注文属性（attributes）", value: "attributes"},
                    ]}
                    value={source}
                    onChange={setSource}
                    error={fieldErrors?.deliverySource}
                  />
                  <TextField
                    label="取得キー"
                    name="deliveryKey"
                    autoComplete="off"
                    value={key}
                    onChange={setKey}
                    placeholder="shipping.requested_date"
                    helpText="メタフィールドの場合は namespace.key の形式で入力してください。"
                    error={fieldErrors?.deliveryKey}
                  />
                  <TextField
                    label="日付パースフォーマット"
                    name="deliveryFormat"
                    autoComplete="off"
                    value={format}
                    onChange={setFormat}
                    placeholder={DEFAULT_DATE_FORMAT}
                    helpText={`未入力の場合は ${DEFAULT_DATE_FORMAT} を使用します。`}
                  />
                </>
              ) : (
                <>
                  <input type="hidden" name="deliverySource" value={source} />
                  <input type="hidden" name="deliveryKey" value={key} />
                  <input type="hidden" name="deliveryFormat" value={format} />
                </>
              )}
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
