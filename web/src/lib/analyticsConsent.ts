import {
  getAnalyticsConsent,
  updateAnalyticsConsent,
  type AnalyticsConsentResponse,
} from "./api";

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
   * A decision is submitted against this, so the recorded agreement always
   * matches the wording that was displayed.
   */
  currentPolicyVersion: string | null;
};

const UNKNOWN: AnalyticsConsentState = {
  known: false,
  decided: false,
  productAnalytics: false,
  needsDecision: false,
  currentPolicyVersion: null,
};

type Listener = (state: AnalyticsConsentState) => void;

let state: AnalyticsConsentState = { ...UNKNOWN };
let cachedToken: string | null = null;
let inFlight: Promise<AnalyticsConsentState> | null = null;
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
  return state.known && state.productAnalytics;
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
  const request = (async () => {
    try {
      const response = await getAnalyticsConsent(token);
      publish(fromResponse(response));
    } catch {
      // Unknown stays unknown, and unknown emits nothing.
      publish({ ...UNKNOWN });
    } finally {
      inFlight = null;
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

  const result = await updateAnalyticsConsent(token, { productAnalytics, policyVersion });
  if (result.status === "recorded") {
    cachedToken = token;
    publish(fromResponse(result.decision));
    return { status: "recorded", state };
  }

  const refreshed = await loadAnalyticsConsent(token, { force: true });
  return { status: "reask", state: refreshed };
}

/** Drop everything — used on sign-out, token change, and in tests. */
export function resetAnalyticsConsent(): void {
  cachedToken = null;
  inFlight = null;
  publish({ ...UNKNOWN });
}
