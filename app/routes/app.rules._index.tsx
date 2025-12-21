import {useCallback, useMemo, useState} from "react";
import type {ActionFunctionArgs} from "react-router";
import {redirect, useFetcher, useLoaderData, useLocation, useNavigate} from "react-router";
import {
  BlockStack,
  Box,
  Button,
  Card,
  IndexTable,
  Link,
  Modal,
  Page,
  Select,
  Text,
  useIndexResourceState,
} from "@shopify/polaris";

import prisma from "../db.server";
import {authenticate} from "../shopify.server";
import {getShippingRates} from "../services/shipping-rates.server";
import {toZoneKey, toZoneLabel} from "../utils/shipping-zones";
import {BulkAction} from "@shopify/polaris/build/ts/src/components/BulkActions";
import {CriticalBanner} from "../components/CriticalBanner";
import {SettingsRequiredBanner} from "../components/SettingsRequiredBanner";
import {SuccessToast} from "../components/SuccessToast";

type ZoneRuleSummary = {
  zoneKey: string;
  zoneName: string | null;
  shippingRateCount: number;
  baseDays: number | null;
  individualCount: number;
};

type LoaderData = {
  configuredSummaries: ZoneRuleSummary[];
  allZones: Array<{zoneKey: string; zoneName: string | null; shippingRateCount: number}>;
  flashMessage: {text: string; tone: "success" | "critical"} | null;
  defaultLeadDays: number | null;
};

type ActionData = {ok: true} | {ok: false; message: string};

export const loader = async ({request}: {request: Request}) => {
  const {session} = await authenticate.admin(request);
  const url = new URL(request.url);
  const flashText = url.searchParams.get("message");
  const flashTone = url.searchParams.get("tone") === "critical" ? "critical" : "success";
  const [rates, links, setting] = await Promise.all([
    getShippingRates(session.shop),
    prisma.ruleShippingRate.findMany({
      where: {shopId: session.shop},
      include: {rule: true},
      orderBy: {createdAt: "desc"},
    }),
    prisma.shopSetting.findUnique({
      where: {shopId: session.shop},
      select: {defaultLeadDays: true},
    }),
  ]);

  const zoneMetaByKey = new Map<string, {zoneKey: string; zoneName: string | null; shippingRateCount: number}>();
  rates.forEach((rate) => {
    const zoneKey = toZoneKey(rate.zoneName);
    const current = zoneMetaByKey.get(zoneKey);
    zoneMetaByKey.set(zoneKey, {
      zoneKey,
      zoneName: rate.zoneName ?? current?.zoneName ?? null,
      shippingRateCount: (current?.shippingRateCount ?? 0) + 1,
    });
  });

  const zoneKeyByRateId = new Map<string, string>();
  rates.forEach((rate) => {
    zoneKeyByRateId.set(rate.shippingRateId, toZoneKey(rate.zoneName));
  });

  const summaryByZoneKey = new Map<string, ZoneRuleSummary & {baseUpdatedAt: Date | null; seenRuleIds: Set<string>}>();

  links.forEach((link) => {
    const zoneKey = zoneKeyByRateId.get(link.shippingRateId) ?? toZoneKey(null);
    const meta = zoneMetaByKey.get(zoneKey);

    const existing = summaryByZoneKey.get(zoneKey);
    const summary =
      existing ??
      ({
        zoneKey,
        zoneName: meta?.zoneName ?? null,
        shippingRateCount: meta?.shippingRateCount ?? 0,
        baseDays: null,
        baseUpdatedAt: null,
        individualCount: 0,
        seenRuleIds: new Set<string>(),
      } satisfies ZoneRuleSummary & {baseUpdatedAt: Date | null; seenRuleIds: Set<string>});

    const rule = link.rule;
    if (!rule?.id) return;
    if (summary.seenRuleIds.has(rule.id)) return;
    summary.seenRuleIds.add(rule.id);

    if (rule.targetType === "all") {
      if (!summary.baseUpdatedAt || rule.updatedAt > summary.baseUpdatedAt) {
        summary.baseDays = rule.days;
        summary.baseUpdatedAt = rule.updatedAt;
      }
    }

    if (rule.targetType === "product") {
      summary.individualCount += 1;
    }

    summaryByZoneKey.set(zoneKey, summary);
  });

  return {
    configuredSummaries: Array.from(summaryByZoneKey.values())
      .map(({baseUpdatedAt, seenRuleIds, ...rest}) => rest)
      .sort((a, b) => toZoneLabel(a.zoneName).localeCompare(toZoneLabel(b.zoneName), "ja")),
    allZones: Array.from(zoneMetaByKey.values()).sort((a, b) =>
      toZoneLabel(a.zoneName).localeCompare(toZoneLabel(b.zoneName), "ja"),
    ),
    flashMessage: flashText ? {text: flashText, tone: flashTone} : null,
    defaultLeadDays: setting?.defaultLeadDays ?? null,
  } satisfies LoaderData;
};

export const action = async ({request}: ActionFunctionArgs) => {
  const {session} = await authenticate.admin(request);
  const url = new URL(request.url);
  const host = url.searchParams.get("host");
  const setting = await prisma.shopSetting.findUnique({
    where: {shopId: session.shop},
    select: {defaultLeadDays: true},
  });
  if (!setting?.defaultLeadDays || setting.defaultLeadDays <= 0) {
    const redirectUrl = host
      ? `/app/rules?host=${encodeURIComponent(host)}&message=${encodeURIComponent("全体設定が未完了のため操作できません")}&tone=critical`
      : `/app/rules?message=${encodeURIComponent("全体設定が未完了のため操作できません")}&tone=critical`;
    return redirect(redirectUrl);
  }
  const form = await request.formData();
  const actionType = String(form.get("_action") ?? "");

  if (actionType !== "delete_zones") {
    return {ok: false, message: "不明な操作です"} satisfies ActionData;
  }

  const raw = String(form.get("zoneKeys") ?? "[]");
  let zoneKeys: string[] = [];
  try {
    const parsed = JSON.parse(raw);
    zoneKeys = Array.isArray(parsed) ? parsed.map((v) => String(v)).filter(Boolean) : [];
  } catch {
    zoneKeys = [];
  }

  if (zoneKeys.length === 0) {
    return {ok: false, message: "削除対象が選択されていません"} satisfies ActionData;
  }

  const rates = await getShippingRates(session.shop);
  const rateIds = new Set<string>();
  zoneKeys.forEach((zoneKey) => {
    rates
      .filter((rate) => toZoneKey(rate.zoneName) === zoneKey)
      .forEach((rate) => rateIds.add(rate.shippingRateId));
  });

  if (rateIds.size === 0) {
    const redirectUrl = host
      ? `/app/rules?host=${encodeURIComponent(host)}&message=${encodeURIComponent("削除対象が見つかりませんでした")}&tone=critical`
      : `/app/rules?message=${encodeURIComponent("削除対象が見つかりませんでした")}&tone=critical`;
    return redirect(redirectUrl);
  }

  const targetRateIds = Array.from(rateIds);
  const affectedLinks = await prisma.ruleShippingRate.findMany({
    where: {shopId: session.shop, shippingRateId: {in: targetRateIds}},
    select: {ruleId: true},
  });
  const affectedRuleIds = Array.from(new Set(affectedLinks.map((l) => l.ruleId)));

  await prisma.ruleShippingRate.deleteMany({
    where: {shopId: session.shop, shippingRateId: {in: targetRateIds}},
  });

  if (affectedRuleIds.length > 0) {
    const remaining = await prisma.ruleShippingRate.findMany({
      where: {shopId: session.shop, ruleId: {in: affectedRuleIds}},
      select: {ruleId: true},
    });
    const remainingRuleIds = new Set(remaining.map((l) => l.ruleId));
    const orphanRuleIds = affectedRuleIds.filter((id) => !remainingRuleIds.has(id));
    if (orphanRuleIds.length > 0) {
      await prisma.rule.deleteMany({
        where: {shopId: session.shop, id: {in: orphanRuleIds}},
      });
    }
  }

  const redirectUrl = host
    ? `/app/rules?host=${encodeURIComponent(host)}&message=${encodeURIComponent("削除しました")}&tone=success`
    : `/app/rules?message=${encodeURIComponent("削除しました")}&tone=success`;
  return redirect(redirectUrl);
};

export default function RulesIndexPage() {
  const {configuredSummaries, allZones, flashMessage, defaultLeadDays} = useLoaderData<LoaderData>();
  const navigate = useNavigate();
  const location = useLocation();
  const fetcher = useFetcher<ActionData>();
  const isSettingsReady = defaultLeadDays != null && defaultLeadDays > 0;
  const resourceName = useMemo(
    () => ({singular: "shipping rule", plural: "shipping rules"}),
    [],
  );
  const host = useMemo(() => new URLSearchParams(location.search).get("host"), [location.search]);
  const successMessage = flashMessage?.tone === "success" ? flashMessage.text : null;
  const errorMessage = flashMessage?.tone === "critical" ? flashMessage.text : null;

  const toDetailUrl = useCallback(
    (zoneKey: string) => {
      const encoded = encodeURIComponent(zoneKey);
      return host
        ? `/app/rules/${encoded}?host=${encodeURIComponent(host)}`
        : `/app/rules/${encoded}`;
    },
    [host],
  );

  const configuredZoneKeys = useMemo(
    () => new Set(configuredSummaries.map((summary) => summary.zoneKey)),
    [configuredSummaries],
  );

  const availableZones = useMemo(
    () => allZones.filter((zone) => !configuredZoneKeys.has(zone.zoneKey)),
    [allZones, configuredZoneKeys],
  );

  const availableOptions = useMemo(
    () =>
      availableZones.map((zone) => ({
        label: toZoneLabel(zone.zoneName),
        value: zone.zoneKey,
      })),
    [availableZones],
  );

  const [addModalOpen, setAddModalOpen] = useState(false);
  const [selectedZoneKey, setSelectedZoneKey] = useState<string>(() => availableOptions[0]?.value ?? "");

  const openAddModal = useCallback(() => {
    setSelectedZoneKey((current) => {
      if (current && availableZones.some((zone) => zone.zoneKey === current)) return current;
      return availableZones[0]?.zoneKey ?? "";
    });
    setAddModalOpen(true);
  }, [availableZones]);

  const closeAddModal = useCallback(() => setAddModalOpen(false), []);

  const addSelectedZone = useCallback(() => {
    if (!isSettingsReady) return;
    if (!selectedZoneKey) return;
    closeAddModal();
    navigate(toDetailUrl(selectedZoneKey));
  }, [closeAddModal, isSettingsReady, navigate, selectedZoneKey, toDetailUrl]);

  const {
    selectedResources: selectedZoneKeys,
    allResourcesSelected,
    handleSelectionChange,
    clearSelection,
  } = useIndexResourceState(configuredSummaries, {
    resourceIDResolver: (summary) => summary.zoneKey,
  });

  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const openDeleteModal = useCallback(() => setDeleteModalOpen(true), []);
  const closeDeleteModal = useCallback(() => setDeleteModalOpen(false), []);

  const submitDelete = useCallback(() => {
    const formData = new FormData();
    formData.set("_action", "delete_zones");
    formData.set("zoneKeys", JSON.stringify(selectedZoneKeys));
    closeDeleteModal();
    clearSelection();
    fetcher.submit(formData, {method: "post"});
  }, [clearSelection, closeDeleteModal, fetcher, selectedZoneKeys]);

  return (
    <Page
      title="出荷ルール（配送エリア別）"
      primaryAction={
        <Button onClick={openAddModal} variant="primary" disabled={!isSettingsReady}>
          配送エリアを追加
        </Button>
      }
    >
      <SuccessToast message={successMessage} />
      {errorMessage ? (
        <div style={{marginBottom: 16}}>
          <CriticalBanner message={errorMessage} />
        </div>
      ) : null}
      {!isSettingsReady ? (
        <div style={{marginBottom: 16}}>
          <SettingsRequiredBanner />
        </div>
      ) : null}

      <Modal
        title="配送エリアを追加"
        open={addModalOpen}
        onClose={closeAddModal}
        primaryAction={{
          content: "設定する",
          onAction: addSelectedZone,
          disabled: !isSettingsReady || availableOptions.length === 0 || !selectedZoneKey,
        }}
        secondaryActions={[{content: "キャンセル", onAction: closeAddModal}]}
      >
        <Modal.Section>
          <BlockStack gap="300">
            {availableOptions.length === 0 ? (
              <Text as="p" tone="subdued">
                追加できる配送エリアがありません。
              </Text>
            ) : (
              <Select
                label="配送エリア"
                options={availableOptions}
                value={selectedZoneKey}
                onChange={setSelectedZoneKey}
              />
            )}
          </BlockStack>
        </Modal.Section>
      </Modal>

      <Card padding="0">
        {configuredSummaries.length === 0 ? (
          <div style={{padding: 16}}>
            <BlockStack gap="300">
              <Text as="p">まだ配送エリアが追加されていません。</Text>
              <div>
                <Button onClick={openAddModal} variant="primary" disabled={!isSettingsReady}>
                  配送エリアを追加
                </Button>
              </div>
            </BlockStack>
          </div>
        ) : (
          <>
            <IndexTable
              resourceName={resourceName}
              itemCount={configuredSummaries.length}
              selectable
              selectedItemsCount={allResourcesSelected ? "All" : selectedZoneKeys.length}
              onSelectionChange={handleSelectionChange}
              promotedBulkActions={[{
                content: "エリアを削除する",
                destructive: true,
                onAction: openDeleteModal,
                disabled: !isSettingsReady || selectedZoneKeys.length === 0,
              } as BulkAction]}
              headings={[
                {title: "配送エリア"},
                {title: "対象配送ケース"},
                {title: "基本設定（日）"},
                {title: "商品別設定"},
              ]}
            >
              {configuredSummaries.map((summary, index) => {
                const baseText =
                  summary.baseDays != null
                    ? `${summary.baseDays} 日`
                    : defaultLeadDays != null
                      ? `全体設定 (${defaultLeadDays} 日)`
                      : "未設定";
                const individualText = `${summary.individualCount} 件`;
                const rateCountText = `${summary.shippingRateCount} 件`;
                return (
                  <IndexTable.Row
                    id={summary.zoneKey}
                    key={summary.zoneKey}
                    position={index}
                    selected={selectedZoneKeys.includes(summary.zoneKey)}
                  >
                    <IndexTable.Cell>
                      <Box paddingBlock="100">
                        <Link url={toDetailUrl(summary.zoneKey)} dataPrimaryLink>
                          <Text as="span" fontWeight="medium" variant="bodySm" tone="subdued">
                            {toZoneLabel(summary.zoneName)}
                          </Text>
                        </Link>
                      </Box>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Box paddingBlock="100">
                        <Text as="span" tone="subdued">
                          {rateCountText}
                        </Text>
                      </Box>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Box paddingBlock="100">{baseText}</Box>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Box paddingBlock="100">{individualText}</Box>
                    </IndexTable.Cell>
                  </IndexTable.Row>
                );
              })}
            </IndexTable>
          </>
        )}
      </Card>

      <Modal
        title="選択した配送エリアのルールを削除"
        open={deleteModalOpen}
        onClose={closeDeleteModal}
        primaryAction={{
          content: "削除する",
          destructive: true,
          onAction: submitDelete,
          disabled: !isSettingsReady || selectedZoneKeys.length === 0,
        }}
        secondaryActions={[{content: "キャンセル", onAction: closeDeleteModal}]}
      >
        <Modal.Section>
          <BlockStack gap="200">
            <Text as="p">
              選択した配送エリアに設定されているルールを削除します（基本設定・商品別設定）。
            </Text>
            <Text as="p" tone="subdued">
              対象: {selectedZoneKeys.length} 件
            </Text>
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
