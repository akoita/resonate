import { normalizeAgentRuntimeResult } from "../modules/agents/agent_runtime.types";

describe("normalizeAgentRuntimeResult", () => {
  it("normalizes deterministic orchestrator tracks into commerce tracks", () => {
    const result = normalizeAgentRuntimeResult({
      status: "approved",
      tracks: [
        {
          trackId: "track-1",
          mixPlan: { transition: "crossfade" },
          pick: {
            licenseType: "remix",
            priceUsd: 0,
            reason: "selected",
            recommendation: { score: 42, reasonCode: "taste_match" },
          },
        },
      ],
      shortfall: 4,
    });

    expect(result.status).toBe("approved");
    expect(result.primaryTrack).toEqual(
      expect.objectContaining({
        trackId: "track-1",
        licenseType: "remix",
        priceUsd: 0,
        reason: "selected",
        score: 42,
        reasonCode: "taste_match",
      }),
    );
    expect(result.shortfall).toBe(4);
  });

  it("normalizes adapter picks into the same unpriced envelope", () => {
    const result = normalizeAgentRuntimeResult({
      status: "approved",
      picks: [
        { trackId: "track-1", licenseType: "commercial", priceUsd: 25 },
        { trackId: "track-2", licenseType: "personal", priceUsd: 0.05 },
      ],
      reasoning: "fits the listener budget",
      latencyMs: 25,
    });

    expect(result.status).toBe("approved");
    expect(result.tracks).toEqual([
      expect.objectContaining({
        trackId: "track-1",
        licenseType: "commercial",
        priceUsd: 0,
      }),
      expect.objectContaining({
        trackId: "track-2",
        licenseType: "personal",
        priceUsd: 0,
      }),
    ]);
    expect(result.reasoning).toBe("fits the listener budget");
    expect(result.latencyMs).toBe(25);
  });

  it("falls back to a single adapter track when only trackId is returned", () => {
    const result = normalizeAgentRuntimeResult({
      status: "approved",
      trackId: "track-1",
      licenseType: "remix",
      priceUsd: 5,
      reason: "single_pick",
    });

    expect(result.primaryTrack).toEqual(
      expect.objectContaining({
        trackId: "track-1",
        licenseType: "remix",
        priceUsd: 0,
        reason: "single_pick",
      }),
    );
  });

  it("passes the orchestrator's request coverage through (#2037)", () => {
    const requestCoverage = { picks: 5, gaps: [{ filter: "bpm" as const, matched: 1 }] };
    const result = normalizeAgentRuntimeResult({
      status: "approved",
      tracks: [{ trackId: "track-1", mixPlan: {}, pick: { licenseType: "personal", priceUsd: 0, reason: "selected" as const } }],
      shortfall: 0,
      requestCoverage,
    });
    expect(result.requestCoverage).toEqual(requestCoverage);
  });

  it("has no request coverage without one, and for adapter picks", () => {
    const orchestrated = normalizeAgentRuntimeResult({
      status: "approved",
      tracks: [{ trackId: "track-1", mixPlan: {}, pick: { licenseType: "personal", priceUsd: 0, reason: "selected" as const } }],
    });
    expect(orchestrated).not.toHaveProperty("requestCoverage");
    const adapter = normalizeAgentRuntimeResult({
      status: "approved",
      picks: [{ trackId: "track-1", licenseType: "personal", priceUsd: 0 }],
    });
    expect(adapter).not.toHaveProperty("requestCoverage");
  });

  describe("curation (#2075)", () => {
    it("marks deterministic results as rule-curated and passes the fallback through", () => {
      const runtimeFallback = { from: "vertex" as const, reason: "timeout" as const };
      const requestCoverage = { picks: 2, gaps: [{ filter: "genres" as const, matched: 1 }] };
      const result = normalizeAgentRuntimeResult({
        status: "approved",
        tracks: [],
        shortfall: 0,
        runtimeFallback,
        requestCoverage,
      });

      expect(result.curatedBy).toBe("rules");
      expect(result.runtimeFallback).toEqual(runtimeFallback);
      expect(result.requestCoverage).toEqual(requestCoverage);
    });

    it("omits runtimeFallback when the rules were configured, not a fallback", () => {
      const result = normalizeAgentRuntimeResult({ status: "approved", tracks: [], shortfall: 0 });

      expect(result.curatedBy).toBe("rules");
      expect(result).not.toHaveProperty("runtimeFallback");
    });

    it("marks LLM results as llm-curated and passes the policy step's coverage through", () => {
      const requestCoverage = { picks: 2, gaps: [{ filter: "genres" as const, matched: 1 }] };
      const withCoverage = normalizeAgentRuntimeResult({
        status: "approved",
        picks: [{ trackId: "track-1", licenseType: "personal", priceUsd: 0 }],
        requestCoverage,
      });
      const without = normalizeAgentRuntimeResult({
        status: "approved",
        picks: [{ trackId: "track-1", licenseType: "personal", priceUsd: 0 }],
      });

      expect(withCoverage.curatedBy).toBe("llm");
      expect(withCoverage.requestCoverage).toEqual(requestCoverage);
      expect(withCoverage).not.toHaveProperty("runtimeFallback");
      expect(without.curatedBy).toBe("llm");
      expect(without).not.toHaveProperty("requestCoverage");
    });
  });
});
