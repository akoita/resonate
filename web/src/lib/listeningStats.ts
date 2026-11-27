import type { ListeningMoment, ListeningStats, ListeningStatsWindow } from "./api";

export interface ListeningStatsDay {
  /** Local calendar day, YYYY-MM-DD. */
  date: string;
  plays: number;
  minutes: number;
}

/** The windows the page offers, with the label each tab shows. */
export const LISTENING_WINDOW_OPTIONS: Array<{ days: ListeningStatsWindow; label: string; phrase: string }> = [
  { days: 7, label: "7 days", phrase: "this week" },
  { days: 30, label: "30 days", phrase: "this month" },
  { days: 90, label: "90 days", phrase: "these 90 days" },
  { days: 365, label: "Year", phrase: "this year" },
];

export function windowPhrase(days: ListeningStatsWindow): string {
  return LISTENING_WINDOW_OPTIONS.find((option) => option.days === days)?.phrase ?? `these ${days} days`;
}

const SLOT_MS = 15 * 60_000;

function dayKey(at: Date): string {
  const month = String(at.getMonth() + 1).padStart(2, "0");
  const day = String(at.getDate()).padStart(2, "0");
  return `${at.getFullYear()}-${month}-${day}`;
}

/**
 * Groups the server's 15-minute UTC slots into this device's calendar days:
 * one entry per day of the window (oldest first, ending today), the streak
 * of days in a row up to today (or yesterday, when nothing has played yet
 * today), the longest run inside the window and the busiest day.
 */
export function localDays(stats: Pick<ListeningStats, "activity" | "windowDays" | "from">, now: Date = new Date()) {
  const windowStart = Date.parse(stats.from);
  const totals = new Map<string, { plays: number; seconds: number }>();
  const everActive = new Set<string>();
  for (const [slot, plays, seconds] of stats.activity) {
    // A slot's middle decides its day; a 15-minute slot fits inside any real offset.
    const at = new Date(slot * SLOT_MS + SLOT_MS / 2);
    const key = dayKey(at);
    everActive.add(key);
    if (slot * SLOT_MS + SLOT_MS <= windowStart) continue;
    const entry = totals.get(key) ?? { plays: 0, seconds: 0 };
    entry.plays += plays;
    entry.seconds += seconds;
    totals.set(key, entry);
  }

  const days: ListeningStatsDay[] = [];
  const cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
  for (let i = 0; i < stats.windowDays; i += 1) {
    const key = dayKey(cursor);
    const entry = totals.get(key);
    days.push({ date: key, plays: entry?.plays ?? 0, minutes: Math.round((entry?.seconds ?? 0) / 60) });
    cursor.setDate(cursor.getDate() - 1);
  }
  days.reverse();

  let longest = 0;
  let run = 0;
  for (const day of days) {
    run = day.plays > 0 ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  const streakCursor = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
  if (!everActive.has(dayKey(streakCursor))) streakCursor.setDate(streakCursor.getDate() - 1);
  let current = 0;
  while (everActive.has(dayKey(streakCursor))) {
    current += 1;
    streakCursor.setDate(streakCursor.getDate() - 1);
  }

  const peakDay = days.reduce<ListeningStatsDay | null>(
    (best, day) => (day.plays > 0 && (!best || day.plays > best.plays) ? day : best),
    null,
  );
  return {
    days,
    activeDays: days.filter((day) => day.plays > 0).length,
    currentStreakDays: current,
    longestStreakDays: longest,
    peakDay,
  };
}

export type LocalDays = ReturnType<typeof localDays>;

/** "3 h 20 min", "45 min", "0 min". */
export function formatListeningTime(minutes: number): { value: string; unit: string; text: string } {
  const total = Math.max(0, Math.round(minutes));
  if (total < 60) return { value: String(total), unit: "min", text: `${total} min` };
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (hours >= 100 || rest === 0) return { value: hours.toLocaleString("en"), unit: "h", text: `${hours.toLocaleString("en")} h` };
  return { value: `${hours} h ${rest}`, unit: "min", text: `${hours} h ${rest} min` };
}

/** Change against the previous window: null when there is nothing to compare with. */
export function changeAgainst(current: number, previous: number): { percent: number; direction: "up" | "down" | "flat" } | null {
  if (previous <= 0) return null;
  const percent = Math.round(((current - previous) / previous) * 100);
  return { percent: Math.abs(percent), direction: percent > 0 ? "up" : percent < 0 ? "down" : "flat" };
}

export const MOMENT_LABELS: Record<ListeningMoment, { label: string; hours: string; persona: string }> = {
  morning: { label: "Morning", hours: "6am–12pm", persona: "an early riser" },
  afternoon: { label: "Afternoon", hours: "12–6pm", persona: "an afternoon listener" },
  evening: { label: "Evening", hours: "6pm–12am", persona: "an evening listener" },
  night: { label: "Night", hours: "12–6am", persona: "a night owl" },
};

export const MOMENT_ORDER: ListeningMoment[] = ["morning", "afternoon", "evening", "night"];

export function topMoment(moments: Record<ListeningMoment, number>): ListeningMoment | null {
  let best: ListeningMoment | null = null;
  for (const moment of MOMENT_ORDER) {
    if (moments[moment] > 0 && (!best || moments[moment] > moments[best])) best = moment;
  }
  return best;
}

/** "Tue 12 Nov" for a YYYY-MM-DD local day. */
export function formatDay(day: string, options: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short" }): string {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date)).toLocaleDateString("en-GB", { ...options, timeZone: "UTC" });
}

/**
 * Bars for the trend chart. A year has too many days to draw one bar each, so
 * long windows are grouped into weeks (newest group ends today).
 */
export function trendBars(days: ListeningStatsDay[]): Array<{ key: string; label: string; minutes: number; plays: number; isToday: boolean }> {
  const groupSize = days.length > 90 ? 7 : 1;
  const bars: Array<{ key: string; label: string; minutes: number; plays: number; isToday: boolean }> = [];
  let end = days.length;
  while (end > 0) {
    // A short leftover at the start joins the oldest full week instead of
    // drawing a stub bar.
    const start = end - groupSize < groupSize ? 0 : end - groupSize;
    const slice = days.slice(start, end);
    const first = slice[0];
    const last = slice[slice.length - 1];
    bars.push({
      key: last.date,
      label: groupSize === 1 ? formatDay(last.date) : `Week of ${formatDay(first.date, { day: "numeric", month: "short" })}`,
      minutes: slice.reduce((sum, day) => sum + day.minutes, 0),
      plays: slice.reduce((sum, day) => sum + day.plays, 0),
      isToday: end === days.length,
    });
    end = start;
  }
  return bars.reverse();
}

/** Axis labels for the trend chart: first, middle and last bar. */
export function trendAxis(bars: ReturnType<typeof trendBars>): string[] {
  if (bars.length === 0) return [];
  const short = (key: string) => formatDay(key, { day: "numeric", month: "short" });
  if (bars.length < 3) return bars.map((bar) => short(bar.key));
  return [short(bars[0].key), short(bars[Math.floor(bars.length / 2)].key), "Today"];
}

/** One plain sentence that sums up the window, or null with nothing to say. */
export function headlineInsight(stats: ListeningStats): string | null {
  if (stats.summary.plays === 0) return null;
  const parts: string[] = [];
  const artist = stats.topArtists[0];
  if (artist) parts.push(`${artist.name} led ${windowPhrase(stats.windowDays)}`);
  const moment = topMoment(stats.moments);
  if (moment) parts.push(`you were ${MOMENT_LABELS[moment].persona}`);
  if (parts.length === 0) return null;
  const sentence = parts.join(", and ");
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`;
}

export function pluralize(count: number, one: string, many = `${one}s`): string {
  return `${count.toLocaleString("en")} ${count === 1 ? one : many}`;
}
