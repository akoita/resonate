import {
  clearPickNotes,
  getPickNotes,
  historyRecommendation,
  pickNotesFromRunResult,
  rememberPickNotes,
} from "../modules/agents/agent_pick_notes";

const orchestratedPick = (requestMatch?: boolean) => ({
  licenseType: "personal" as const,
  priceUsd: 0 as const,
  reason: "selected" as const,
  ...(requestMatch === undefined ? {} : { requestMatch }),
  recommendation: { explanation: ["Nearby vibe match"], reasonCode: "nearby_taste" },
});

describe("pick notes carry requestMatch (#2312)", () => {
  it("records the flag from a rule-based run, only when it is a boolean", () => {
    const notes = pickNotesFromRunResult({
      status: "approved",
      tracks: [
        { trackId: "a", mixPlan: {}, pick: orchestratedPick(true) },
        { trackId: "b", mixPlan: {}, pick: orchestratedPick(false) },
        { trackId: "c", mixPlan: {}, pick: orchestratedPick() },
      ],
    });
    expect(notes.get("a")?.requestMatch).toBe(true);
    expect(notes.get("b")?.requestMatch).toBe(false);
    expect(notes.get("c")).not.toHaveProperty("requestMatch");
  });

  it("records the flag from an LLM run", () => {
    const notes = pickNotesFromRunResult({
      status: "approved",
      picks: [
        { trackId: "a", licenseType: "personal", priceUsd: 0, requestMatch: false },
        { trackId: "b", licenseType: "personal", priceUsd: 0 },
      ],
    });
    expect(notes.get("a")?.requestMatch).toBe(false);
    expect(notes.get("b")).not.toHaveProperty("requestMatch");
  });

  it("keeps the flag in the remembered notes", () => {
    rememberPickNotes("u-notes", "s-notes", new Map([["a", { explanation: [], curatedBy: "rules", requestMatch: false }]]));
    expect(getPickNotes("u-notes", "s-notes")?.get("a")?.requestMatch).toBe(false);
    clearPickNotes("u-notes", "s-notes");
  });
});

describe("historyRecommendation (#2312)", () => {
  it("exposes the flag next to the explanation and curator", () => {
    expect(
      historyRecommendation({ explanation: ["Nearby vibe match"], reasonCode: "nearby_taste", curatedBy: "llm", requestMatch: false }, null),
    ).toEqual({
      recommendation: { explanation: ["Nearby vibe match"], reasonCode: "nearby_taste" },
      curatedBy: "llm",
      requestMatch: false,
    });
  });

  it("leaves an unflagged or older note, and a bare signal, without the field", () => {
    const unflagged = historyRecommendation({ explanation: [], curatedBy: "rules" }, null);
    expect(unflagged).not.toHaveProperty("requestMatch");
    expect(historyRecommendation(undefined, { curatedBy: "rules" })).toEqual({ curatedBy: "rules" });
    expect(historyRecommendation(undefined, null)).toBeNull();
  });

  it("lets the recorded signal override the note's fields, as before", () => {
    const merged = historyRecommendation({ explanation: [], curatedBy: "rules", requestMatch: true }, { curatedBy: "llm" });
    expect(merged?.curatedBy).toBe("llm");
    expect(merged?.requestMatch).toBe(true);
  });
});
