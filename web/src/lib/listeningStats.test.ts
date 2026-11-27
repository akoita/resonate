import { describe, expect, it } from "vitest";
import type { ListeningStats } from "./api";
import { changeAgainst, formatListeningTime, headlineInsight, localDays, topMoment, trendAxis, trendBars } from "./listeningStats";

const SLOT = 15 * 60_000;
const slotOf = (at: Date) => Math.floor(at.getTime() / SLOT);
// Local noon on a fixed day, so the test holds in any time zone.
const NOW = new Date(2026, 5, 15, 12, 0, 0);
const daysAgo = (n: number, hour = 10) => new Date(2026, 5, 15 - n, hour, 0, 0);

describe("listening stats view model", () => {
  it("formats listening time in plain units", () => {
    expect(formatListeningTime(45).text).toBe("45 min");
    expect(formatListeningTime(200).text).toBe("3 h 20 min");
    expect(formatListeningTime(180).text).toBe("3 h");
    expect(formatListeningTime(6100).text).toBe("101 h");
  });

  it("compares with the previous window only when there is one", () => {
    expect(changeAgainst(10, 0)).toBeNull();
    expect(changeAgainst(150, 100)).toEqual({ percent: 50, direction: "up" });
    expect(changeAgainst(50, 100)).toEqual({ percent: 50, direction: "down" });
  });

  it("groups UTC slots into this device's days and counts streaks", () => {
    const activity: ListeningStats["activity"] = [
      [slotOf(daysAgo(9)), 2, 600], // before the window: still extends no streak (gap)
      [slotOf(daysAgo(4)), 1, 60],
      [slotOf(daysAgo(2)), 1, 120],
      [slotOf(daysAgo(1)), 3, 600],
      [slotOf(daysAgo(1, 22)), 1, 60],
    ];
    const local = localDays(
      { activity, windowDays: 7, from: new Date(NOW.getTime() - 7 * 86_400_000).toISOString() },
      NOW,
    );
    expect(local.days).toHaveLength(7);
    expect(local.days.map((day) => day.plays)).toEqual([0, 0, 1, 0, 1, 4, 0]);
    expect(local.days[5].minutes).toBe(11);
    expect(local.activeDays).toBe(3);
    // Nothing today yet: the streak ends yesterday.
    expect(local.currentStreakDays).toBe(2);
    expect(local.longestStreakDays).toBe(2);
    expect(local.peakDay?.plays).toBe(4);
  });

  it("groups a year into weeks for the chart", () => {
    const days = Array.from({ length: 365 }, (_, index) => ({ date: `2026-01-${String((index % 28) + 1).padStart(2, "0")}`, plays: 1, minutes: 2 }));
    const bars = trendBars(days);
    expect(bars).toHaveLength(52);
    expect(bars[0].plays).toBe(8);
    expect(bars[bars.length - 1]).toMatchObject({ plays: 7, minutes: 14, isToday: true });
    expect(trendAxis(bars)[2]).toBe("Today");
  });

  it("sums up the window in one sentence", () => {
    const stats = {
      windowDays: 30,
      summary: { plays: 4 },
      topArtists: [{ name: "Nova Line" }],
      moments: { morning: 0, afternoon: 1, evening: 0, night: 3 },
    } as unknown as ListeningStats;
    expect(topMoment(stats.moments)).toBe("night");
    expect(headlineInsight(stats)).toBe("Nova Line led this month, and you were a night owl.");
  });
});
