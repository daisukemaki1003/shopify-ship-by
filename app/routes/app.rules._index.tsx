import { Link, useLoaderData } from "react-router";

import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import {
  getShippingRates,
  type ShippingRateEntry,
} from "../services/shipping-rates.server";
import { formatDateTime } from "../utils/format";

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
  flashMessage: { text: string; tone: "success" | "critical" } | null;
};

const toSummary = (rate: ShippingRateEntry): ShippingRuleSummary => ({
  shippingRateId: rate.shippingRateId,
  handle: rate.handle,
  title: rate.title,
  baseDays: null,
  baseUpdatedAt: null,
  individualCount: 0,
});

export const loader = async ({ request }: { request: Request }) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const flashText = url.searchParams.get("message");
  const flashTone = url.searchParams.get("tone") === "critical" ? "critical" : "success";
  const [rates, links] = await Promise.all([
    getShippingRates(session.shop),
    prisma.ruleShippingRate.findMany({
      where: { shopId: session.shop },
      include: { rule: true },
      orderBy: { createdAt: "desc" },
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
    flashMessage: flashText ? { text: flashText, tone: flashTone } : null,
  } satisfies LoaderData;
};

function SummaryCard({ summary }: { summary: ShippingRuleSummary }) {
  const hasBase = summary.baseDays != null;
  const hasIndividual = summary.individualCount > 0;

  return (
    <Link to={`/app/rules/${summary.shippingRateId}`}>
      <s-box padding="base" borderWidth="base" borderRadius="large" background="surface">
        <s-stack direction="block" gap="tight">
          <s-text>{summary.title}</s-text>
          {hasBase ? (
            <s-text>・出荷リードタイム: {summary.baseDays} 日</s-text>
          ) : (
            <s-text tone="subdued">・基本設定がありません。</s-text>
          )}
          {hasIndividual ? (
            <s-text tone="subdued">・個別設定: {summary.individualCount} 件</s-text>
          ) : null}
          {summary.baseUpdatedAt ? (
            <s-text tone="subdued">・最終更新: {formatDateTime(summary.baseUpdatedAt)}</s-text>
          ) : null}
        </s-stack>
      </s-box>
    </Link>
  );
}

export default function RulesIndexPage() {
  const { summaries, flashMessage } = useLoaderData<LoaderData>();

  return (
    <s-page heading="出荷ルール（配送ケース別）">
      {flashMessage ? (
        <s-text tone={flashMessage.tone} style={{ marginBottom: "12px", display: "block" }}>
          {flashMessage.text}
        </s-text>
      ) : null}
      <s-stack direction="block" gap="base">
        {summaries.length === 0 ? (
          <s-box padding="base" background="subdued" borderWidth="base">
            <s-text>配送ケースがありません。</s-text>
          </s-box>
        ) : (
          summaries.map((summary) => (
            <SummaryCard key={summary.shippingRateId} summary={summary} />
          ))
        )}
      </s-stack>
    </s-page>
  );
}
