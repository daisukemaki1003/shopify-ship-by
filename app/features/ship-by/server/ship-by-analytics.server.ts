import prisma from "../../db.server";

type WeekdayCount = {
  label: string;
  count: number;
};

type DailyTrendPoint = {
  label: string;
  count: number;
};

export type ShipBySummary = {
  rangeDays: number;
  total: number;
  recentTotal: number;
  todayCount: number;
  byWeekday: WeekdayCount[];
  dailyTrend: DailyTrendPoint[];
};

export const getShipBySummary = async ({
  shopId,
  rangeDays = 30,
  trendTake = 30,
  trendFallbackDays = 7,
  timeZone = "Asia/Tokyo",
}: {
  shopId: string;
  rangeDays?: number;
  trendTake?: number;
  trendFallbackDays?: number;
  timeZone?: string;
}): Promise<ShipBySummary> => {
  const weekdayLabels = ["日", "月", "火", "水", "木", "金", "土"];
  let weekdayFormatter: Intl.DateTimeFormat | null = null;
  let dateFormatter: Intl.DateTimeFormat | null = null;
  let shortDateFormatter: Intl.DateTimeFormat | null = null;

  try {
    weekdayFormatter = new Intl.DateTimeFormat("ja-JP", {
      weekday: "short",
      timeZone,
    });
    dateFormatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    shortDateFormatter = new Intl.DateTimeFormat("ja-JP", {
      timeZone,
      month: "numeric",
      day: "numeric",
    });
  } catch (error) {
    console.warn(
      "[ship-by] Intl.DateTimeFormat failed",
      error instanceof Error ? error.message : String(error),
    );
  }

  const formatWeekday = (date: Date) =>
    weekdayFormatter
      ? weekdayFormatter.format(date)
      : weekdayLabels[date.getUTCDay()];
  const formatDateKey = (date: Date) =>
    dateFormatter ? dateFormatter.format(date) : date.toISOString().slice(0, 10);
  const formatShortDate = (date: Date) =>
    shortDateFormatter
      ? shortDateFormatter.format(date)
      : date.toISOString().slice(5, 10).replace("-", "/");

  const buildDefaultDailyTrend = (days: number) =>
    Array.from({length: days}, (_, index) => {
      const date = new Date();
      date.setDate(date.getDate() - (days - 1 - index));
      return {label: formatShortDate(date), count: 0};
    });

  const summaryFallback: ShipBySummary = {
    rangeDays,
    total: 0,
    recentTotal: 0,
    todayCount: 0,
    byWeekday: weekdayLabels.map((label) => ({label, count: 0})),
    dailyTrend: buildDefaultDailyTrend(trendFallbackDays),
  };

  try {
    const shipByStart = new Date();
    shipByStart.setDate(shipByStart.getDate() - rangeDays);

    const shipByRecords = await prisma.shipByRecord.findMany({
      where: {shopId, shipByDate: {gte: shipByStart}},
      select: {shipByDate: true},
    });
    const recentShipByRecords = await prisma.shipByRecord.findMany({
      where: {shopId},
      orderBy: {shipByDate: "desc"},
      take: trendTake,
      select: {shipByDate: true},
    });

    const shipByCounts = Array.from({length: 7}, () => 0);
    const todayKey = formatDateKey(new Date());
    let todayCount = 0;
  const dailyCounts = new Map<string, number>();

    shipByRecords.forEach((record) => {
      const weekdayLabel = formatWeekday(record.shipByDate);
      const dayIndex = weekdayLabels.indexOf(weekdayLabel);
      if (dayIndex !== -1) shipByCounts[dayIndex] += 1;

      const dateKey = formatDateKey(record.shipByDate);
      if (dateKey === todayKey) {
        todayCount += 1;
      }
      dailyCounts.set(dateKey, (dailyCounts.get(dateKey) ?? 0) + 1);

    });

    const dailyTrend = Array.from({length: trendFallbackDays}, (_, index) => {
      const date = new Date();
      date.setDate(date.getDate() - (trendFallbackDays - 1 - index));
      const key = formatDateKey(date);
      return {
        label: formatShortDate(date),
        count: dailyCounts.get(key) ?? 0,
      };
    });

    return {
      rangeDays,
      total: shipByRecords.length,
      recentTotal: recentShipByRecords.length,
      todayCount,
      byWeekday: weekdayLabels.map((label, index) => ({
        label,
        count: shipByCounts[index],
      })),
      dailyTrend,
    };
  } catch (error) {
    console.warn(
      "[ship-by] failed to load ship-by summary",
      error instanceof Error ? error.message : String(error),
    );
    return summaryFallback;
  }
};
