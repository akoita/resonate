import {
  getAnalyticsConsent,
  updateAnalyticsConsent,
  type AnalyticsConsentResponse,
} from "./api";

/** Version of the actual consent wording bundled with this browser. */
export const ANALYTICS_CONSENT_TEXT_VERSION = "analytics-consent:2026-10-03";

/**
 * #1772: the browser's view of the analytics consent decision.
 *
 * The server is the gate — it refuses telemetry from anyone who has not
 * consented. This module exists so the browser does not keep sending data it
 * has already been told not to send, and so the consent prompt and the settings
 * panel read one shared answer instead of two drifting ones.
 *
 * It is deliberately module-scoped rather than React state: the emitters are
 * plain functions called from contexts, effects, and event handlers all over
 * the app, and threading a provider through every one of them would leave gaps
 * that emit unchecked.
 */
export type AnalyticsConsentState = {
  /**
   * False until a decision has been fetched. Nothing may be emitted while this
   * is false: "we have not asked the server yet" is not permission.
   */
  known: boolean;
  /** True once the person has answered — including when the answer was no. */
  decided: boolean;
  productAnalytics: boolean;
  /** Server-computed. Never re-derive this from version strings. */
  needsDecision: boolean;
  /**
   * The version of the consent text the server last told us it is serving.
   * A decision also includes ANALYTICS_CONSENT_TEXT_VERSION, which is bound to
   * bundled wording rather than copied from a response.
   */
  currentPolicyVersion: string | null;
  /**
   * True once the decision has been unreachable for a while (several failed
   * checks in a row). Display-only: it lets Settings say nothing is being
   * recorded because the check failed. It never grants anything.
   */
  checkFailed: boolean;
};

const UNKNOWN: AnalyticsConsentState = {
  known: false,
  decided: false,
  productAnalytics: false,
  needsDecision: false,
  currentPolicyVersion: null,
  checkFailed: false,
};

/**
 * #2230: after a failed check, ask again after these delays (5 s, 30 s, 2 min,
 * 10 min) and then stop until the next trigger. Bounded on purpose: a backend
 * that is down must not be hammered by every open tab.
 */
export const CONSENT_RETRY_DELAYS_MS: readonly number[] = [5_000, 30_000, 120_000, 600_000];
/** Triggered re-checks (tab visible, server refusal) are at least this far apart. */
export const CONSENT_RECHECK_MIN_INTERVAL_MS = 30_000;
/** Failed checks in a row before Settings is told to say so. */
const CHECK_FAILED_AFTER = 2;

type Listener = (state: AnalyticsConsentState) => void;

let state: AnalyticsConsentState = { ...UNKNOWN };
let cachedToken: string | null = null;
let inFlight: Promise<AnalyticsConsentState> | null = null;
/** Bumped on every reset so a late response can't touch a newer session. */
let generation = 0;
let consecutiveFailures = 0;
let lastCheckAt = Number.NEGATIVE_INFINITY;
let pendingTimer: ReturnType<typeof setTimeout> | null = null;
let visibilityListening = false;
const listeners = new Set<Listener>();

function publish(next: AnalyticsConsentState) {
  state = next;
  for (const listener of listeners) {
    listener(state);
  }
}

function fromResponse(response: AnalyticsConsentResponse): AnalyticsConsentState {
  return {
    known: true,
    decided: Boolean(response?.decided),
    productAnalytics: Boolean(response?.productAnalytics),
    needsDecision: Boolean(response?.needsDecision),
    currentPolicyVersion:
      typeof response?.currentPolicyVersion === "string" ? response.currentPolicyVersion : null,
    checkFailed: false,
  };
}

export function getAnalyticsConsentState(): AnalyticsConsentState {
  return state;
}

export function subscribeToAnalyticsConsent(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * The gate the emitters consult.
 *
 * FAILS CLOSED. An unknown state returns false, so an event fired before the
 * decision has loaded is dropped rather than sent. It is also dropped rather
 * than queued: holding telemetry back to replay it after a grant is still
 * collecting it before consent, just on a delay.
 */
export function isProductAnalyticsAllowed(): boolean {
  return state.known && state.productAnalytics && !state.needsDecision;
}

/**
 * Fetch the decision once per token and cache it. Concurrent callers share the
 * in-flight request so a page that mounts several analytics-aware surfaces does
 * not open several connections to ask the same question.
 *
 * A failure leaves the state unknown, which means closed.
 */
export async function loadAnalyticsConsent(
  token: string | null | undefined,
  options: { force?: boolean } = {},
): Promise<AnalyticsConsentState> {
  if (!token) {
    resetAnalyticsConsent();
    return state;
  }

  if (token !== cachedToken) {
    // A different session must never inherit another account's decision.
    resetAnalyticsConsent();
  }

  if (!options.force && state.known) {
    return state;
  }

  if (!options.force && inFlight) {
    return inFlight;
  }

  cachedToken = token;
  const startedIn = generation;
  lastCheckAt = Date.now();
  startVisibilityRecheck();
  const request = (async () => {
    try {
      const response = await getAnalyticsConsent(token);
      if (startedIn !== generation) return state;
      consecutiveFailures = 0;
      clearPendingTimer();
      publish(fromResponse(response));
    } catch {
      if (startedIn !== generation) return state;
      // Unknown stays unknown, and unknown emits nothing. Only the decision is
      // recovered: nothing is queued while we wait, and nothing is replayed.
      consecutiveFailures += 1;
      publish({ ...UNKNOWN, checkFailed: consecutiveFailures >= CHECK_FAILED_AFTER });
      scheduleRetry();
    } finally {
      if (startedIn === generation) inFlight = null;
    }
    return state;
  })();

  inFlight = request;
  return request;
}

/**
 * Called when a telemetry route answers 202 `recorded: false`.
 *
 * The server is holding the door shut, so stop knocking: whatever the browser
 * believed, product analytics are not permitted for this session right now.
 * The cached decision is dropped as well, because a refusal against a state we
 * thought was a grant means our copy is stale (a policy bump, or a decision
 * changed in another tab) and the next reader should ask the server again.
 */
export function noteServerRefusal(): void {
  publish({ ...state, known: false, productAnalytics: false });
  // #2230: nothing else re-reads the decision, so ask once, rate-limited.
  requestConsentRecheck({ defer: true });
}

function clearPendingTimer() {
  if (pendingTimer !== null) {
    clearTimeout(pendingTimer);
    pendingTimer = null;
  }
}

function setPendingTimer(delayMs: number, run: () => void) {
  clearPendingTimer();
  const timer = setTimeout(() => {
    pendingTimer = null;
    run();
  }, delayMs);
  // Never keep a node process (tests, SSR) alive for a consent check.
  (timer as { unref?: () => void }).unref?.();
  pendingTimer = timer;
}

/** Retry a failed check with bounded exponential backoff, then stop. */
function scheduleRetry() {
  if (!cachedToken) return;
  const delay = CONSENT_RETRY_DELAYS_MS[consecutiveFailures - 1];
  if (delay === undefined) {
    // Exhausted: wait for the next trigger (tab visible, refusal, remount).
    clearPendingTimer();
    return;
  }
  setPendingTimer(delay, () => {
    if (cachedToken) void loadAnalyticsConsent(cachedToken, { force: true });
  });
}

/**
 * Re-read the decision because something suggests our copy is missing or
 * stale. Rate-limited so a refusing or unreachable server is not hammered.
 * Starts a fresh retry sequence if the check fails.
 */
function requestConsentRecheck({ defer }: { defer: boolean }) {
  const token = cachedToken;
  if (!token || inFlight) return;
  const wait = CONSENT_RECHECK_MIN_INTERVAL_MS - (Date.now() - lastCheckAt);
  const run = () => {
    if (cachedToken !== token) return;
    consecutiveFailures = 0;
    void loadAnalyticsConsent(token, { force: true });
  };
  if (wait <= 0) {
    run();
  } else if (defer) {
    setPendingTimer(wait, run);
  }
}

function onVisibilityChange() {
  if (typeof document === "undefined" || document.visibilityState !== "visible") return;
  // A known decision needs no re-read; a refusal already drops it to unknown.
  if (state.known) return;
  requestConsentRecheck({ defer: false });
}

function startVisibilityRecheck() {
  if (visibilityListening || typeof document === "undefined") return;
  document.addEventListener("visibilitychange", onVisibilityChange);
  visibilityListening = true;
}

function stopVisibilityRecheck() {
  if (!visibilityListening || typeof document === "undefined") return;
  document.removeEventListener("visibilitychange", onVisibilityChange);
  visibilityListening = false;
}

export type AnalyticsConsentDecisionResult =
  | { status: "recorded"; state: AnalyticsConsentState }
  /**
   * The consent text moved while it was on screen. The caller must show the
   * reloaded text and ask again — it must NOT resubmit with the server's
   * version, which would attribute the answer to wording nobody saw.
   */
  | { status: "reask"; state: AnalyticsConsentState };

export async function recordAnalyticsConsentDecision(
  token: string,
  productAnalytics: boolean,
): Promise<AnalyticsConsentDecisionResult> {
  const loaded = state.known && state.currentPolicyVersion && cachedToken === token
    ? state
    : await loadAnalyticsConsent(token, { force: true });

  const policyVersion = loaded.currentPolicyVersion;
  if (!policyVersion) {
    // We never displayed a version, so there is nothing honest to record
    // against. Treat it as a re-ask rather than guessing one.
    return { status: "reask", state: loaded };
  }

  const result = await updateAnalyticsConsent(token, { productAnalytics, policyVersion, consentTextVersion: ANALYTICS_CONSENT_TEXT_VERSION });
  if (result.status === "recorded") {
    cachedToken = token;
    consecutiveFailures = 0;
    clearPendingTimer();
    publish(fromResponse(result.decision));
    return { status: "recorded", state };
  }

  const refreshed = await loadAnalyticsConsent(token, { force: true });
  return { status: "reask", state: refreshed };
}

/** Drop everything — used on sign-out, token change, and in tests. */
export function resetAnalyticsConsent(): void {
  generation += 1;
  cachedToken = null;
  inFlight = null;
  consecutiveFailures = 0;
  lastCheckAt = Number.NEGATIVE_INFINITY;
  clearPendingTimer();
  stopVisibilityRecheck();
  publish({ ...UNKNOWN });
}
