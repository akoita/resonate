/**
 * Shows "I would come" (#2668): a campaign in interest mode collects
 * declarations of interest instead of pledges. No payment, escrow or contract
 * call, and the wording never says "pledge" or "back" to the fan.
 */
import { API_BASE, ApiRequestError } from "./api";

export type ShowCampaignMode = "pledge" | "interest";

export interface ShowInterestState {
  mode: ShowCampaignMode;
  open: boolean;
  mine: { city: string | null; notifyWhenOpen: boolean; createdAt: string } | null;
}

export interface ShowInterestSummary {
  mode: ShowCampaignMode;
  total: number;
  cities: Array<{ city: string; count: number }>;
  otherCount: number;
  notifyCount: number;
  minimumGroup: number;
}

export const SHOW_INTEREST_CITY_MAX = 80;

export function campaignMode(value: unknown): ShowCampaignMode {
  return value === "interest" ? "interest" : "pledge";
}

async function call<T>(path: string, init: RequestInit, token?: string | null): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body) headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(`${API_BASE}${path}`, { cache: "no-store", ...init, headers });
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
  return body as T;
}

const base = (campaignId: string) => `/shows/campaigns/${encodeURIComponent(campaignId)}`;

export function getShowInterest(campaignId: string, token?: string | null) {
  return call<ShowInterestState>(`${base(campaignId)}/interest`, { method: "GET" }, token);
}

export function declareShowInterest(
  campaignId: string,
  token: string,
  input: { city?: string; notifyWhenOpen?: boolean },
) {
  return call<{ city: string | null; notifyWhenOpen: boolean; createdAt: string }>(
    `${base(campaignId)}/interest`,
    { method: "PUT", body: JSON.stringify(input) },
    token,
  );
}

export function withdrawShowInterest(campaignId: string, token: string) {
  return call<{ withdrawn: boolean }>(`${base(campaignId)}/interest`, { method: "DELETE" }, token);
}

export function getShowInterestSummary(campaignId: string, token: string) {
  return call<ShowInterestSummary>(`${base(campaignId)}/interest/summary`, { method: "GET" }, token);
}

export function setShowCampaignMode(campaignId: string, token: string, mode: ShowCampaignMode) {
  return call<{ id: string; mode: ShowCampaignMode; notified: number }>(
    `${base(campaignId)}/mode`,
    { method: "POST", body: JSON.stringify({ mode }) },
    token,
  );
}

/** What the fan sees after declaring, in plain words. */
export function interestConfirmation(mine: ShowInterestState["mine"]): string | null {
  if (!mine) return null;
  const where = mine.city ? ` in ${mine.city}` : "";
  const notify = mine.notifyWhenOpen ? " We will tell you when tickets or pledges open." : "";
  return `You said you would come${where}.${notify}`;
}

/** Plain error copy for the fan and the artist. */
export function showInterestErrorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) {
    if (error.status === 401) return "Sign in to say you would come.";
    if (error.status === 429) return "Too many changes in a short time. Please wait a moment.";
    if (error.status === 409 || error.status === 400) return error.message;
    if (error.status === 403) return "Only the artist or an operator can do that.";
  }
  return "That did not work. Please try again in a moment.";
}

/** One line for the artist: how many people, and how many asked to be told. */
export function interestSummaryLine(summary: Pick<ShowInterestSummary, "total" | "notifyCount">): string {
  if (summary.total === 0) return "Nobody has said they would come yet.";
  const people = summary.total === 1 ? "1 person says they would come" : `${summary.total} people say they would come`;
  return `${people}; ${summary.notifyCount} asked to be told when it opens.`;
}
