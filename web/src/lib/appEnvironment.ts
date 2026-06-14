import { API_BASE } from "./api";

/**
 * Client-side detection of backend version/environment change (#1199).
 *
 * The backend `GET /health` returns a stamp identifying the deployed build
 * and environment. The client remembers the last stamp it saw and, on load
 * and window focus, classifies any change so the UI can respond:
 *   - environment_changed → guided session reset (new/reset backend env, #915)
 *   - version_skew        → non-destructive "reload to update" banner
 * This makes the response reliable instead of guessed from 401s.
 */

export const APP_ENV_STAMP_KEY = "resonate.appEnv";

export type AppEnvironmentStamp = {
  appVersion: string;
  environmentId: string;
  dataEpoch: string;
};

export type EnvironmentChange = "none" | "version_skew" | "environment_changed";

/**
 * Pure classification of a stored stamp against the current server stamp.
 * Environment/epoch change dominates a version change (it implies a reset).
 * A missing stored stamp is first-run, not a change.
 */
export function classifyEnvironmentChange(
  stored: AppEnvironmentStamp | null,
  current: AppEnvironmentStamp,
): EnvironmentChange {
  if (!stored) return "none";
  if (
    stored.environmentId !== current.environmentId ||
    stored.dataEpoch !== current.dataEpoch
  ) {
    return "environment_changed";
  }
  if (stored.appVersion !== current.appVersion) {
    return "version_skew";
  }
  return "none";
}

export function getStoredEnvironmentStamp(): AppEnvironmentStamp | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(APP_ENV_STAMP_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<AppEnvironmentStamp>;
    if (
      typeof parsed.appVersion === "string" &&
      typeof parsed.environmentId === "string" &&
      typeof parsed.dataEpoch === "string"
    ) {
      return parsed as AppEnvironmentStamp;
    }
    return null;
  } catch {
    return null;
  }
}

export function storeEnvironmentStamp(stamp: AppEnvironmentStamp): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(APP_ENV_STAMP_KEY, JSON.stringify(stamp));
}

/**
 * Fetches the current backend stamp. Returns null on any failure — the guard
 * treats "couldn't reach health" as "no change", never as a reset trigger, so
 * a transient network blip can't nag the user.
 */
export async function fetchAppEnvironment(): Promise<AppEnvironmentStamp | null> {
  try {
    const response = await fetch(`${API_BASE}/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as Partial<AppEnvironmentStamp>;
    if (
      typeof body.appVersion === "string" &&
      typeof body.environmentId === "string" &&
      typeof body.dataEpoch === "string"
    ) {
      return {
        appVersion: body.appVersion,
        environmentId: body.environmentId,
        dataEpoch: body.dataEpoch,
      };
    }
    return null;
  } catch {
    return null;
  }
}
