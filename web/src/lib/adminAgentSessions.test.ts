import { describe, expect, it } from "vitest";
import {
  agentEventLabel,
  codeLabel,
  coverageLines,
  eventDetails,
  eventIdentifiers,
  validateSessionId,
} from "./adminAgentSessions";
import { agentEvent } from "./__fixtures__/adminAgentSessions";

describe("session id validation (#2259)", () => {
  it("accepts ids shaped like the server accepts", () => {
    for (const id of ["session-1", "0b6c1f0e-0d6a-4f5a-9d0a-7f1b0c0a1111", "a:b_c.d", "x".repeat(200)]) {
      expect(validateSessionId(id)).toBeNull();
    }
    expect(validateSessionId("  session-1  ")).toBeNull();
  });

  it("refuses empty, spaced, slashed and overlong ids before any request", () => {
    expect(validateSessionId("   ")).toBe("Enter a session id.");
    for (const id of ["a b", "a/b", "../x", "-x", "x".repeat(201), "sad rainy sunday"]) {
      expect(validateSessionId(id)).toMatch(/letters, numbers/);
    }
  });
});

describe("labels", () => {
  it("names known events and shows unknown ones as recorded", () => {
    expect(agentEventLabel("agent.decision_made")).toBe("Decision");
    expect(agentEventLabel("agent.brand_new")).toBe("agent.brand_new");
  });

  it("shows codes as words", () => {
    expect(codeLabel("no_tracks")).toBe("no tracks");
    expect(codeLabel("hybrid_rrf_v1")).toBe("hybrid rrf v1");
  });
});

describe("coverage lines", () => {
  it("reports every gap, the held-back picks and the shortfall from counts", () => {
    expect(
      coverageLines({
        picks: 12,
        gaps: [
          { filter: "genres", matched: 9 },
          { filter: "bpm", matched: 1 },
        ],
        heldBack: { variety: 2, explicit: 1 },
        capRelaxed: { artists: 1 },
        shortfallReason: "catalog_short",
      }),
    ).toEqual([
      "9 of 12 picks match genres",
      "1 of 12 picks match tempo",
      "2 strong matches held back for variety",
      "1 strong match held back by the explicit preference",
      "Per-artist cap relaxed for 1 artist",
      "Shorter than the target: the catalog has no more matching tracks",
    ]);
  });

  it("says so when everything matches", () => {
    expect(coverageLines({ picks: 5, gaps: [] })).toEqual(["All 5 picks match the request"]);
  });
});

describe("event details", () => {
  it("orders the decision details and numbers the picks from one", () => {
    const details = eventDetails(
      agentEvent({
        pickIndex: 0,
        pickCount: 12,
        reason: "no_tracks",
        curatedBy: "llm",
        strategy: "hybrid_rrf_v1",
        latencyMs: 900,
        unmetIntent: ["genres"],
        runtimeFallback: { from: "adk", reason: "timeout" },
      }),
    );
    expect(details).toEqual([
      "Pick 1 of 12",
      "Reason: no tracks",
      "Curated by: the AI model",
      "Model unavailable (timeout), rules used instead",
      "Strategy: hybrid rrf v1",
      "Could not fill: genres",
      "Took 900 ms",
    ]);
  });

  it("lists only the identifiers an event names", () => {
    expect(eventIdentifiers(agentEvent({ trackId: "t1", releaseId: "r1" }))).toEqual([
      { label: "Track", value: "t1" },
      { label: "Release", value: "r1" },
    ]);
    expect(eventIdentifiers(agentEvent())).toEqual([]);
  });
});
