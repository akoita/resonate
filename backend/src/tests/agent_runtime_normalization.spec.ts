import { normalizeAgentRuntimeResult } from "../modules/agents/agent_runtime.types";

describe("normalizeAgentRuntimeResult", () => {
  it("normalizes deterministic orchestrator tracks into commerce tracks", () => {
    const result = normalizeAgentRuntimeResult({
      status: "approved",
      tracks: [
        {
          trackId: "track-1",
          mixPlan: { transition: "crossfade" },
          negotiation: {
            licenseType: "remix",
            priceUsd: 5,
            reason: "within_budget",
          },
        },
      ],
      generationsUsed: 1,
      generationSpendUsd: 0.06,
    });

    expect(result.status).toBe("approved");
    expect(result.primaryTrack).toEqual(
      expect.objectContaining({
        trackId: "track-1",
        licenseType: "remix",
        priceUsd: 5,
        reason: "within_budget",
      }),
    );
    expect(result.generationsUsed).toBe(1);
    expect(result.generationSpendUsd).toBe(0.06);
  });

  it("normalizes adapter picks into the same commerce envelope", () => {
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
        priceUsd: 25,
      }),
      expect.objectContaining({
        trackId: "track-2",
        licenseType: "personal",
        priceUsd: 0.05,
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
        priceUsd: 5,
        reason: "single_pick",
      }),
    );
  });
});
