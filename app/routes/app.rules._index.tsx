import {useMemo} from "react";
import {useLoaderData, useLocation, useNavigate} from "react-router";
import {Banner, Card, IndexTable, Page, Text} from "@shopify/polaris";

import prisma from "../db.server";
import {authenticate} from "../shopify.server";
import {getShippingRates, type ShippingRateEntry} from "../services/shipping-rates.server";

type ShippingRuleSummary = {
  shippingRateId: string;
  handle: string;
  title: string;
  baseDays: number | null;
  baseUpdatedAt: Date | null;
  individualCount: number;
};

type LoaderData = {
  summaries: ShippingRuleSummary[];
  flashMessage: {text: string; tone: "success" | "critical"} | null;
};

const toSummary = (rate: ShippingRateEntry): ShippingRuleSummary => ({
  shippingRateId: rate.shippingRateId,
  handle: rate.handle,
  title: rate.title,
  baseDays: null,
  baseUpdatedAt: null,
  individualCount: 0,
});

export const loader = async ({request}: {request: Request}) => {
  const {session} = await authenticate.admin(request);
  const url = new URL(request.url);
  const flashText = url.searchParams.get("message");
  const flashTone = url.searchParams.get("tone") === "critical" ? "critical" : "success";
  const [rates, links] = await Promise.all([
    getShippingRates(session.shop),
    prisma.ruleShippingRate.findMany({
      where: {shopId: session.shop},
      include: {rule: true},
      orderBy: {createdAt: "desc"},
    }),
  ]);

  const map = new Map<string, ShippingRuleSummary>();
  rates.forEach((rate) => {
    map.set(rate.shippingRateId, toSummary(rate));
  });

  links.forEach((link) => {
    const rateId = link.shippingRateId;
    const summary = map.get(rateId);
    if (!summary) return;

    const rule = link.rule;

    if (rule.targetType === "all") {
      if (!summary.baseUpdatedAt || rule.updatedAt > summary.baseUpdatedAt) {
        summary.baseDays = rule.days;
        summary.baseUpdatedAt = rule.updatedAt;
      }
    }

    if (rule.targetType === "product") {
      summary.individualCount += 1;
    }
  });

  return {
    summaries: Array.from(map.values()),
    flashMessage: flashText ? {text: flashText, tone: flashTone} : null,
  } satisfies LoaderData;
};

export default function RulesIndexPage() {
  const {summaries, flashMessage} = useLoaderData<LoaderData>();
  const navigate = useNavigate();
  const location = useLocation();
  const resourceName = useMemo(
    () => ({singular: "shipping rule", plural: "shipping rules"}),
    [],
  );
  const host = useMemo(() => new URLSearchParams(location.search).get("host"), [location.search]);

  return (
    <Page title="出荷ルール（配送ケース別）">
      {flashMessage ? (
        <Banner tone={flashMessage.tone}>
          <p>{flashMessage.text}</p>
        </Banner>
      ) : null}

      <Card padding="0">
        {summaries.length === 0 ? (
          <div style={{padding: 16}}>
            <Text as="p">配送ケースがありません。</Text>
          </div>
        ) : (
          <IndexTable
            resourceName={resourceName}
            itemCount={summaries.length}
            selectable={false}
            headings={[
              {title: "配送ケース"},
              {title: "ハンドル"},
              {title: "基本設定（日）"},
              {title: "商品別設定"},
            ]}
          >
            {summaries.map((summary, index) => {
              const baseText = summary.baseDays != null ? `${summary.baseDays} 日` : "未設定";
              const individualText = `${summary.individualCount} 件`;
              return (
                <IndexTable.Row
                  id={summary.shippingRateId}
                  key={summary.shippingRateId}
                  position={index}
                  onClick={() => {
                    const nextUrl = host
                      ? `/app/rules/${summary.shippingRateId}?host=${encodeURIComponent(host)}`
                      : `/app/rules/${summary.shippingRateId}`;
                    navigate(nextUrl);
                  }}
                >
                  <IndexTable.Cell>
                    <Text as="span" fontWeight="semibold">
                      {summary.title}
                    </Text>
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <Text as="span" tone="subdued">
                      {summary.handle}
                    </Text>
                  </IndexTable.Cell>
                  <IndexTable.Cell>{baseText}</IndexTable.Cell>
                  <IndexTable.Cell>{individualText}</IndexTable.Cell>
                </IndexTable.Row>
              );
            })}
          </IndexTable>
        )}
      </Card>
    </Page>
  );
}
