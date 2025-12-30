import { BlockStack, Card, InlineStack, Text } from "@shopify/polaris";
import type { ShipBySummary } from "../server/ship-by-analytics.server";

const TREND_LINE_COLOR = "#7fc9ff";
const TREND_GRAPH_WIDTH = 110;
const TREND_GRAPH_HEIGHT = 36;

export function ShipByAnalytics({ summary }: { summary: ShipBySummary }) {
  const maxShipByCount = Math.max(
    1,
    ...summary.byWeekday.map((item) => item.count),
  );
  const maxDailyCount = Math.max(
    1,
    ...summary.dailyTrend.map((item) => item.count),
  );
  const minDailyCount = Math.min(...summary.dailyTrend.map((item) => item.count));
  const trendPointCount = summary.dailyTrend.length;
  const trendCoordinates = summary.dailyTrend.map((item, index) => {
    const x = trendPointCount <= 1 ? 0 : (index / (trendPointCount - 1)) * 100;
    const topPadding = 4;
    const bottomPadding = 4;
    const usableHeight = Math.max(1, TREND_GRAPH_HEIGHT - topPadding - bottomPadding);
    const hasRange = maxDailyCount !== minDailyCount;
    const normalized = hasRange
      ? (item.count - minDailyCount) / (maxDailyCount - minDailyCount)
      : 0;
    const y = TREND_GRAPH_HEIGHT - bottomPadding - normalized * usableHeight;
    return { x, y, label: item.label, count: item.count };
  });
  const trendPoints = trendCoordinates
    .map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`)
    .join(" ");
  const fallbackLine =
    trendCoordinates.length === 0
      ? "0,33 100,33"
      : trendCoordinates.length === 1
        ? `0,${trendCoordinates[0].y.toFixed(2)} 100,${trendCoordinates[0].y.toFixed(2)}`
        : trendPoints;

  return (
    <BlockStack gap="300">
      <InlineStack align="space-between" blockAlign="center">
        <Text as="h2" variant="headingMd">
          出荷分析
        </Text>
        <Text as="p" tone="subdued">
          直近{summary.rangeDays}日
        </Text>
      </InlineStack>
      <BlockStack gap="300">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: "12px",
          }}
        >
          <Card>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "auto 1fr",
                gap: "16px",
                alignItems: "end",
              }}
            >
              <BlockStack gap="100">
                <Text as="p" tone="subdued">
                  今日の出荷数
                </Text>
                <Text as="p" variant="bodyMd">
                  {summary.todayCount}件
                </Text>
              </BlockStack>
              <BlockStack gap="100">
                <div
                  style={{
                    height: TREND_GRAPH_HEIGHT,
                    width: TREND_GRAPH_WIDTH,
                    maxWidth: "100%",
                    marginLeft: "auto",
                  }}
                >
                  <svg
                    viewBox={`0 0 100 ${TREND_GRAPH_HEIGHT}`}
                    width="100%"
                    height={TREND_GRAPH_HEIGHT}
                    aria-hidden="true"
                    style={{ display: "block" }}
                    preserveAspectRatio="none"
                  >
                    <polyline
                      fill="none"
                      stroke={TREND_LINE_COLOR}
                      strokeWidth="2"
                      strokeLinejoin="round"
                      strokeLinecap="round"
                      points={fallbackLine}
                    />
                    {trendCoordinates.map((point, index) => (
                      <circle
                        key={`${point.label}-${index}`}
                        cx={point.x}
                        cy={point.y}
                        r="2"
                        fill={TREND_LINE_COLOR}
                      />
                    ))}
                  </svg>
                </div>
              </BlockStack>
            </div>
          </Card>
          <Card>
            <BlockStack gap="100">
              <Text as="p" tone="subdued">
                直近{summary.rangeDays}日 合計
              </Text>
              <Text as="p" variant="bodyMd">
                {summary.total}件
              </Text>
            </BlockStack>
          </Card>
        </div>
        <Card>
          <BlockStack gap="200">
            <Text as="p" tone="subdued">
              出荷日の曜日別件数
            </Text>
            <div style={{ display: "grid", gap: "8px" }}>
              {summary.byWeekday.map((item) => (
                <div
                  key={item.label}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "32px 1fr 40px",
                    alignItems: "center",
                    gap: "8px",
                  }}
                >
                  <Text as="span" variant="bodySm" tone="subdued">
                    {item.label}
                  </Text>
                  <div
                    style={{
                      height: 8,
                      background: "var(--p-color-bg-surface-secondary)",
                      borderRadius: 999,
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        height: "100%",
                        width: `${Math.round((item.count / maxShipByCount) * 100)}%`,
                        minWidth: item.count === 0 ? 6 : 4,
                        background:
                          item.count === 0
                            ? "var(--p-color-border-secondary)"
                            : "var(--p-color-bg-fill-brand)",
                      }}
                    />
                  </div>
                  <Text as="span" variant="bodySm">
                    {item.count}
                  </Text>
                </div>
              ))}
            </div>
          </BlockStack>
        </Card>
      </BlockStack>
    </BlockStack>
  );
}
