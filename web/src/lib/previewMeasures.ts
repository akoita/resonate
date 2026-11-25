/**
 * Preview measures (#2670): the admin page's data and how to show it. A count
 * of `null` means 1 to 4 (the small-group rule); a share of `null` means the
 * base is too small to show one.
 */
import { API_BASE, ApiRequestError } from "./api";

export type GuardedCount = number | null;

export interface PreviewMeasures {
  period: { from: string; to: string };
  generatedAt: string;
  minimumGroup: number;
  artists: { invited: GuardedCount; publishedWithin14Days: GuardedCount; stillWithin14Days: GuardedCount; share: number | null };
  listeners: {
    joined: GuardedCount;
    consenting: GuardedCount;
    analyticsAvailable: boolean;
    weeks: Array<{ week: number; eligible: GuardedCount; active: GuardedCount; share: number | null }>;
  };
  features: {
    weeks: Array<{ start: string; end: string }>;
    rows: Array<{ key: string; label: string; recorded: boolean; weekly: GuardedCount[] }>;
  };
  support: { opened: GuardedCount; answered: GuardedCount; medianHoursToAnswer: number | null };
  safety: { uploadsRefusedByLimit: GuardedCount; takedownReports: GuardedCount; communityReports: GuardedCount };
}

export function formatCount(value: GuardedCount): string {
  return value === null ? "fewer than five" : value.toLocaleString("en");
}

export function formatShare(value: number | null): string {
  return value === null ? "not shown (small group)" : `${value}%`;
}

export function formatHours(value: number | null): string {
  if (value === null) return "not shown (fewer than five answered)";
  if (value < 1) return "under an hour";
  return value < 48 ? `${value} hours` : `${Math.round((value / 24) * 10) / 10} days`;
}

/** "3 Mar" for a week starting on that day. */
export function weekLabel(startIso: string): string {
  return new Date(startIso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

export async function getPreviewMeasures(token: string, from: string, to: string): Promise<PreviewMeasures> {
  const query = new URLSearchParams({ from, to });
  const response = await fetch(`${API_BASE}/admin/preview-measures?${query.toString()}`, {
    cache: "no-store",
    headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
  });
  const text = await response.text().catch(() => "");
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = undefined;
  }
  if (!response.ok) {
    const message =
      body && typeof body === "object" && "message" in body && typeof (body as { message: unknown }).message === "string"
        ? (body as { message: string }).message
        : `Request failed with status ${response.status}`;
    throw new ApiRequestError(message, response.status, body);
  }
  return body as PreviewMeasures;
}
