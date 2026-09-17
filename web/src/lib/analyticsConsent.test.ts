import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./api", () => ({
  getAnalyticsConsent: vi.fn(),
  updateAnalyticsConsent: vi.fn(),
}));

import { getAnalyticsConsent, updateAnalyticsConsent } from "./api";
import {
  isProductAnalyticsAllowed,
  loadAnalyticsConsent,
  noteServerRefusal,
  recordAnalyticsConsentDecision,
  resetAnalyticsConsent,
  subscribeToAnalyticsConsent,
} from "./analyticsConsent";

const CURRENT_VERSION = "analytics-consent:2026-09-17";

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
