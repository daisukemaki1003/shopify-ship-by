import {useState} from "react";
import type {HeadersFunction, LoaderFunctionArgs} from "react-router";
import {useLoaderData} from "react-router";
import {
  BlockStack,
  Button,
  Card,
  Collapsible,
  Divider,
  InlineStack,
  Layout,
  Page,
  Text,
} from "@shopify/polaris";
import {ChevronDownIcon, ChevronUpIcon, XIcon} from "@shopify/polaris-icons";
import prisma from "../db.server";
import {authenticate} from "../shopify.server";
import {boundary} from "@shopify/shopify-app-react-router/server";
import {AsyncCheckButton} from "../components/AsyncCheckButton";
import {ShipByAnalytics} from "../components/ShipByAnalytics";
import {getShipBySummary} from "../services/ship-by-analytics.server";

export const loader = async ({request}: LoaderFunctionArgs) => {
  const {session} = await authenticate.admin(request);
  const setting = await prisma.shopSetting.findUnique({
    where: {shopId: session.shop},
    select: {defaultLeadDays: true, deliverySource: true, deliveryKey: true},
  });
  const ruleCount = await prisma.rule.count({
    where: {shopId: session.shop},
  });
  const shipBySummary = await getShipBySummary({shopId: session.shop});

  return {
    defaultLeadDays: setting?.defaultLeadDays ?? null,
    deliverySource: setting?.deliverySource ?? null,
    deliveryKey: setting?.deliveryKey ?? null,
    hasRules: ruleCount > 0,
    shipBySummary,
  };
};

export default function Index() {
  const {defaultLeadDays, deliverySource, deliveryKey, hasRules, shipBySummary} =
    useLoaderData<typeof loader>();
  const isLeadDaysReady = defaultLeadDays != null && defaultLeadDays > 0;
  const isDeliveryReady =
    (deliverySource === "metafield" || deliverySource === "attributes") &&
    Boolean(deliveryKey?.trim());
  const steps = [
    {
      id: "lead-days",
      title: "出荷リードタイムを設定",
      description: "全体設定で基準となる日数を入力します。",
      detail:
        "配送エリアにルールがない場合に使われる日数です。まずは全体の基準値を決めます。",
      actionLabel: "全体設定へ",
      url: "/app/settings",
      done: isLeadDaysReady,
    },
    {
      id: "delivery-source",
      title: "お届け希望日の取得方法を設定",
      description: "メタフィールドまたは属性のキーを指定します。",
      detail:
        "注文データからお届け希望日を取得するためのキーとフォーマットを指定します。",
      actionLabel: "取得方法を設定",
      url: "/app/settings",
      done: isDeliveryReady,
    },
    {
      id: "rules",
      title: "配送エリアのルールを作成",
      description: "配送方法ごとの出荷日数を登録します。",
      detail:
        "配送エリアごとに出荷日数を登録して、より正確な出荷日を計算します。",
      actionLabel: "ルールを作成",
      url: "/app/rules",
      done: hasRules,
    },
  ];
  const totalSteps = steps.length;
  const completedSteps = steps.filter((step) => step.done).length;
  const [isGuideVisible, setIsGuideVisible] = useState(true);
  const [isGuideOpen, setIsGuideOpen] = useState(true);
  const [openStepId, setOpenStepId] = useState(() => {
    const firstIncomplete = steps.find((step) => !step.done);
    return firstIncomplete?.id ?? steps[0]?.id ?? null;
  });

  return (
    <Page title="ダッシュボード">
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            {isGuideVisible ? (
              <Card>
                <BlockStack gap="300">
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr auto",
                      gap: "12px",
                      alignItems: "start",
                    }}
                  >
                    <div
                      role="button"
                      tabIndex={0}
                      aria-expanded={isGuideOpen}
                      onClick={() => {
                        setIsGuideOpen((prev) => !prev);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setIsGuideOpen((prev) => !prev);
                        }
                      }}
                      style={{cursor: "pointer"}}
                    >
                      <BlockStack gap="100">
                        <Text as="h2" variant="headingMd">
                          セットアップガイド
                        </Text>
                        <Text as="p">
                          このガイドに沿ってアプリの初期設定を完了してください。
                        </Text>
                        <Text as="p" tone="subdued">
                          {completedSteps} / {totalSteps} ステップ完了
                        </Text>
                      </BlockStack>
                    </div>
                    <InlineStack gap="200" blockAlign="center" wrap={false}>
                      <Button
                        accessibilityLabel="ガイドを閉じる"
                        variant="tertiary"
                        icon={XIcon}
                        onClick={() => setIsGuideVisible(false)}
                      />
                      <Button
                        accessibilityLabel="ガイドの開閉"
                        variant="tertiary"
                        icon={isGuideOpen ? ChevronUpIcon : ChevronDownIcon}
                        onClick={() => setIsGuideOpen((prev) => !prev)}
                      />
                    </InlineStack>
                  </div>
                  <Collapsible open={isGuideOpen} id="setup-guide">
                    <div
                      style={{
                        borderRadius: 12,
                        border: "1px solid #e5e7eb",
                        background: "#ffffff",
                      }}
                    >
                      {steps.map((step, index) => {
                        const isOpen = openStepId === step.id;
                        const isDone = step.done;
                        return (
                          <div key={step.id}>
                            <div
                              role="button"
                              tabIndex={0}
                              aria-expanded={isOpen}
                              onClick={() => {
                                if (openStepId !== step.id) {
                                  setOpenStepId(step.id);
                                }
                              }}
                              onKeyDown={(event) => {
                                if (event.key === "Enter" || event.key === " ") {
                                  event.preventDefault();
                                  if (openStepId !== step.id) {
                                    setOpenStepId(step.id);
                                  }
                                }
                              }}
                              style={{
                                padding: "12px",
                                display: "grid",
                                gridTemplateColumns: "1fr",
                                alignItems: "center",
                                gap: "12px",
                                cursor: "pointer",
                              }}
                            >
                              <InlineStack gap="200" blockAlign="center">
                                <AsyncCheckButton label={step.title} checked={isDone} />
                                <Text as="span" variant="bodyMd">
                                  {step.title}
                                </Text>
                              </InlineStack>
                            </div>
                            <Collapsible open={isOpen} id={`setup-step-${step.id}`}>
                              <div style={{padding: "0 12px 12px"}}>
                                <div
                                  style={{
                                    padding: "12px",
                                    borderRadius: 12,
                                    background: "#f5f6f7",
                                  }}
                                >
                                  <BlockStack gap="200">
                                    <Text as="p">{step.detail}</Text>
                                    <InlineStack gap="200" wrap>
                                      <Button url={step.url} variant="primary">
                                        {step.actionLabel}
                                      </Button>
                                    </InlineStack>
                                  </BlockStack>
                                </div>
                              </div>
                            </Collapsible>
                            {index < steps.length - 1 ? <Divider /> : null}
                          </div>
                        );
                      })}
                    </div>
                  </Collapsible>
                </BlockStack>
              </Card>
            ) : null}
            <ShipByAnalytics summary={shipBySummary} />
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
