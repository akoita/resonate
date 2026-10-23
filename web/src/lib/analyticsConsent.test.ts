import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./api", () => ({
  getAnalyticsConsent: vi.fn(),
  updateAnalyticsConsent: vi.fn(),
}));

import { getAnalyticsConsent, updateAnalyticsConsent } from "./api";
import {
  ANALYTICS_CONSENT_TEXT_VERSION,
  CONSENT_RECHECK_MIN_INTERVAL_MS,
  CONSENT_RETRY_DELAYS_MS,
  getAnalyticsConsentState,
  isProductAnalyticsAllowed,
  loadAnalyticsConsent,
  noteServerRefusal,
  recordAnalyticsConsentDecision,
  resetAnalyticsConsent,
  subscribeToAnalyticsConsent,
} from "./analyticsConsent";

const CURRENT_VERSION = ANALYTICS_CONSENT_TEXT_VERSION;

const granted = {
  productAnalytics: true,
  decided: true,
  needsDecision: false,
  policyVersion: CURRENT_VERSION,
  currentPolicyVersion: CURRENT_VERSION,
};

const undecided = {
  productAnalytics: false,
  decided: false,
  needsDecision: true,
  currentPolicyVersion: CURRENT_VERSION,
};

const refused = {
  productAnalytics: false,
  decided: true,
  needsDecision: false,
  policyVersion: CURRENT_VERSION,
  currentPolicyVersion: CURRENT_VERSION,
};

describe("analytics consent state (#1772)", () => {
  beforeEach(() => {
    vi.mocked(getAnalyticsConsent).mockReset();
    vi.mocked(updateAnalyticsConsent).mockReset();
    resetAnalyticsConsent();
  });

  it("emits nothing until the decision is known — unknown is not permission", () => {
    expect(isProductAnalyticsAllowed()).toBe(false);
  });

  it("allows emitting only after a grant is loaded", async () => {
    vi.mocked(getAnalyticsConsent).mockResolvedValue(granted);

    await loadAnalyticsConsent("token-1");

    expect(isProductAnalyticsAllowed()).toBe(true);
  });

  it("does not emit on an older grant that needs a new decision", async () => {
    vi.mocked(getAnalyticsConsent).mockResolvedValue({
      ...granted, policyVersion: "analytics-consent:2026-09-17", needsDecision: true,
    });
    await loadAnalyticsConsent("token-1");
    expect(isProductAnalyticsAllowed()).toBe(false);
  });

  it("keeps the gate shut for a recorded refusal, and does not call it undecided", async () => {
    vi.mocked(getAnalyticsConsent).mockResolvedValue(refused);

    const state = await loadAnalyticsConsent("token-1");

    expect(isProductAnalyticsAllowed()).toBe(false);
    expect(state.decided).toBe(true);
    // Someone who said no has decided; asking again would undermine it.
    expect(state.needsDecision).toBe(false);
  });

  it("keeps the gate shut when the decision cannot be fetched", async () => {
    vi.mocked(getAnalyticsConsent).mockRejectedValue(new Error("offline"));

    const state = await loadAnalyticsConsent("token-1");

    expect(state.known).toBe(false);
    expect(isProductAnalyticsAllowed()).toBe(false);
  });

  it("fetches once and shares one in-flight request between concurrent callers", async () => {
    vi.mocked(getAnalyticsConsent).mockResolvedValue(granted);

    await Promise.all([
      loadAnalyticsConsent("token-1"),
      loadAnalyticsConsent("token-1"),
      loadAnalyticsConsent("token-1"),
    ]);
    await loadAnalyticsConsent("token-1");

    expect(getAnalyticsConsent).toHaveBeenCalledTimes(1);
  });

  it("never lets one account inherit another account's decision", async () => {
    vi.mocked(getAnalyticsConsent).mockResolvedValueOnce(granted).mockResolvedValueOnce(refused);

    await loadAnalyticsConsent("token-1");
    expect(isProductAnalyticsAllowed()).toBe(true);

    await loadAnalyticsConsent("token-2");
    expect(isProductAnalyticsAllowed()).toBe(false);
    expect(getAnalyticsConsent).toHaveBeenCalledTimes(2);
  });

  it("drops the decision when the session ends", async () => {
    vi.mocked(getAnalyticsConsent).mockResolvedValue(granted);
    await loadAnalyticsConsent("token-1");

    await loadAnalyticsConsent(null);

    expect(isProductAnalyticsAllowed()).toBe(false);
  });

  it("stops emitting once the server refuses an event", async () => {
    vi.mocked(getAnalyticsConsent).mockResolvedValue(granted);
    await loadAnalyticsConsent("token-1");
    expect(isProductAnalyticsAllowed()).toBe(true);

    noteServerRefusal();

    expect(isProductAnalyticsAllowed()).toBe(false);
  });

  it("records a decision against the version the client was shown", async () => {
    vi.mocked(getAnalyticsConsent).mockResolvedValue(undecided);
    vi.mocked(updateAnalyticsConsent).mockResolvedValue({ status: "recorded", decision: granted });
    await loadAnalyticsConsent("token-1");

    const result = await recordAnalyticsConsentDecision("token-1", true);

    expect(updateAnalyticsConsent).toHaveBeenCalledWith("token-1", {
      productAnalytics: true,
      policyVersion: CURRENT_VERSION,
      consentTextVersion: ANALYTICS_CONSENT_TEXT_VERSION,
    });
    expect(result.status).toBe("recorded");
    expect(isProductAnalyticsAllowed()).toBe(true);
  });

  it("records a refusal as a decision, and stops asking", async () => {
    vi.mocked(getAnalyticsConsent).mockResolvedValue(undecided);
    vi.mocked(updateAnalyticsConsent).mockResolvedValue({ status: "recorded", decision: refused });
    await loadAnalyticsConsent("token-1");

    const result = await recordAnalyticsConsentDecision("token-1", false);

    expect(result.status).toBe("recorded");
    expect(result.state.decided).toBe(true);
    expect(result.state.needsDecision).toBe(false);
    expect(isProductAnalyticsAllowed()).toBe(false);
  });

  it("re-asks on a stale policy version instead of resubmitting against the server's", async () => {
    const newVersion = "analytics-consent:2027-01-01";
    vi.mocked(getAnalyticsConsent)
      .mockResolvedValueOnce(undecided)
      .mockResolvedValueOnce({ ...undecided, currentPolicyVersion: newVersion });
    vi.mocked(updateAnalyticsConsent).mockResolvedValue({
      status: "policy_version_stale",
      currentVersion: newVersion,
    });
    await loadAnalyticsConsent("token-1");

    const result = await recordAnalyticsConsentDecision("token-1", true);

    expect(result.status).toBe("reask");
    // Exactly one write attempt: a silent retry would attribute the answer to
    // wording the person never saw.
    expect(updateAnalyticsConsent).toHaveBeenCalledTimes(1);
    expect(result.state.currentPolicyVersion).toBe(newVersion);
    expect(result.state.needsDecision).toBe(true);
    expect(isProductAnalyticsAllowed()).toBe(false);
  });

  it("notifies subscribers so every surface reads the same decision", async () => {
    vi.mocked(getAnalyticsConsent).mockResolvedValue(granted);
    const seen: boolean[] = [];
    const unsubscribe = subscribeToAnalyticsConsent((state) => seen.push(state.productAnalytics));

    await loadAnalyticsConsent("token-1");
    unsubscribe();
    noteServerRefusal();

    expect(seen).toContain(true);
    expect(seen.at(-1)).toBe(true);
  });
});

describe("analytics consent recovery (#2230)", () => {
  const listeners = new Set<() => void>();
  const fakeDocument = {
    visibilityState: "visible",
    addEventListener: vi.fn((type: string, fn: () => void) => {
      if (type === "visibilitychange") listeners.add(fn);
    }),
    removeEventListener: vi.fn((type: string, fn: () => void) => {
      if (type === "visibilitychange") listeners.delete(fn);
    }),
  };

  const becomeVisible = () => {
    fakeDocument.visibilityState = "visible";
    for (const fn of [...listeners]) fn();
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("document", fakeDocument);
    listeners.clear();
    fakeDocument.visibilityState = "visible";
    vi.mocked(getAnalyticsConsent).mockReset();
    vi.mocked(updateAnalyticsConsent).mockReset();
    resetAnalyticsConsent();
  });

  afterEach(() => {
    resetAnalyticsConsent();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("re-opens the gate when a retry succeeds, without a reload", async () => {
    vi.mocked(getAnalyticsConsent).mockRejectedValueOnce(new Error("503")).mockResolvedValue(granted);

    await loadAnalyticsConsent("token-1");
    expect(isProductAnalyticsAllowed()).toBe(false);

    await vi.advanceTimersByTimeAsync(CONSENT_RETRY_DELAYS_MS[0]);

    expect(getAnalyticsConsent).toHaveBeenCalledTimes(2);
    expect(isProductAnalyticsAllowed()).toBe(true);

    // Recovered: no further checks are scheduled.
    await vi.advanceTimersByTimeAsync(CONSENT_RETRY_DELAYS_MS[3] * 2);
    expect(getAnalyticsConsent).toHaveBeenCalledTimes(2);
  });

  it("emits nothing while unknown and never replays what was dropped", async () => {
    vi.mocked(getAnalyticsConsent).mockRejectedValueOnce(new Error("offline")).mockResolvedValue(granted);
    await loadAnalyticsConsent("token-1");

    // An emitter consults the gate at the moment of the event, and drops it.
    const attempts = [isProductAnalyticsAllowed()];
    await vi.advanceTimersByTimeAsync(CONSENT_RETRY_DELAYS_MS[0]);
    attempts.push(isProductAnalyticsAllowed());

    expect(attempts).toEqual([false, true]);
  });

  it("backs off 5 s, 30 s, 2 min, 10 min and then stops", async () => {
    vi.mocked(getAnalyticsConsent).mockRejectedValue(new Error("down"));
    await loadAnalyticsConsent("token-1");
    expect(getAnalyticsConsent).toHaveBeenCalledTimes(1);

    let calls = 1;
    for (const delay of CONSENT_RETRY_DELAYS_MS) {
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(getAnalyticsConsent).toHaveBeenCalledTimes(calls);
      await vi.advanceTimersByTimeAsync(1);
      calls += 1;
      expect(getAnalyticsConsent).toHaveBeenCalledTimes(calls);
    }

    expect(CONSENT_RETRY_DELAYS_MS).toEqual([5_000, 30_000, 120_000, 600_000]);
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(getAnalyticsConsent).toHaveBeenCalledTimes(1 + CONSENT_RETRY_DELAYS_MS.length);
    expect(isProductAnalyticsAllowed()).toBe(false);
  });

  it("stops retrying when the session ends or the token changes", async () => {
    vi.mocked(getAnalyticsConsent).mockRejectedValue(new Error("down"));
    await loadAnalyticsConsent("token-1");

    resetAnalyticsConsent();
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);

    expect(getAnalyticsConsent).toHaveBeenCalledTimes(1);
    expect(listeners.size).toBe(0);
  });

  it("does not let a late failure for a dropped session schedule retries", async () => {
    let rejectLate: (error: Error) => void = () => {};
    vi.mocked(getAnalyticsConsent).mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectLate = reject;
      }),
    );
    const pending = loadAnalyticsConsent("token-1");

    resetAnalyticsConsent();
    rejectLate(new Error("late"));
    await pending;
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);

    expect(getAnalyticsConsent).toHaveBeenCalledTimes(1);
  });

  it("re-checks when the tab becomes visible, rate-limited", async () => {
    vi.mocked(getAnalyticsConsent).mockRejectedValue(new Error("down"));
    await loadAnalyticsConsent("token-1");

    // Too soon after the last check: ignored.
    becomeVisible();
    expect(getAnalyticsConsent).toHaveBeenCalledTimes(1);

    vi.setSystemTime(Date.now() + CONSENT_RECHECK_MIN_INTERVAL_MS);
    vi.mocked(getAnalyticsConsent).mockResolvedValue(granted);
    becomeVisible();
    await vi.advanceTimersByTimeAsync(0);

    expect(getAnalyticsConsent).toHaveBeenCalledTimes(2);
    expect(isProductAnalyticsAllowed()).toBe(true);
  });

  it("ignores visibility changes while hidden or once the decision is known", async () => {
    vi.mocked(getAnalyticsConsent).mockResolvedValue(granted);
    await loadAnalyticsConsent("token-1");
    vi.setSystemTime(Date.now() + CONSENT_RECHECK_MIN_INTERVAL_MS * 2);

    becomeVisible();
    fakeDocument.visibilityState = "hidden";
    for (const fn of [...listeners]) fn();

    expect(getAnalyticsConsent).toHaveBeenCalledTimes(1);
  });

  it("asks the server again once after a refusal, and shows the prompt if a decision is now needed", async () => {
    vi.mocked(getAnalyticsConsent).mockResolvedValueOnce(granted).mockResolvedValue(undecided);
    await loadAnalyticsConsent("token-1");
    expect(isProductAnalyticsAllowed()).toBe(true);

    noteServerRefusal();
    noteServerRefusal();
    noteServerRefusal();
    expect(isProductAnalyticsAllowed()).toBe(false);
    // Rate-limited: not an immediate request.
    expect(getAnalyticsConsent).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(CONSENT_RECHECK_MIN_INTERVAL_MS);

    expect(getAnalyticsConsent).toHaveBeenCalledTimes(2);
    const next = getAnalyticsConsentState();
    expect(next.known).toBe(true);
    expect(next.needsDecision).toBe(true);
    expect(isProductAnalyticsAllowed()).toBe(false);
  });

  it("re-checks a refusal immediately when the last check was long ago", async () => {
    vi.mocked(getAnalyticsConsent).mockResolvedValue(granted);
    await loadAnalyticsConsent("token-1");
    vi.setSystemTime(Date.now() + CONSENT_RECHECK_MIN_INTERVAL_MS);

    noteServerRefusal();
    await vi.advanceTimersByTimeAsync(0);

    expect(getAnalyticsConsent).toHaveBeenCalledTimes(2);
    expect(isProductAnalyticsAllowed()).toBe(true);
  });

  it("does not re-check a refusal after sign-out", async () => {
    vi.mocked(getAnalyticsConsent).mockResolvedValue(granted);
    await loadAnalyticsConsent("token-1");

    noteServerRefusal();
    resetAnalyticsConsent();
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);

    expect(getAnalyticsConsent).toHaveBeenCalledTimes(1);
  });

  it("flags a check that keeps failing, for display only", async () => {
    vi.mocked(getAnalyticsConsent).mockRejectedValue(new Error("down"));
    await loadAnalyticsConsent("token-1");
    expect(getAnalyticsConsentState().checkFailed).toBe(false);

    await vi.advanceTimersByTimeAsync(CONSENT_RETRY_DELAYS_MS[0]);

    const state = getAnalyticsConsentState();
    expect(state.checkFailed).toBe(true);
    expect(state.known).toBe(false);
    expect(isProductAnalyticsAllowed()).toBe(false);
  });
});
