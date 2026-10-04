import { findResonance } from "../modules/discovery_journal/discovery_journal.service";

describe("habit replay compatibility with the discovery journal (#2062)", () => {
  const from = new Date("2026-10-01T00:00:00Z");
  const completedAt = new Date("2026-10-02T12:00:00Z");
  const savedAt = new Date("2026-10-02T12:05:00Z");
  const now = new Date("2026-10-03T00:00:00Z");

  it("can anchor resonance on a replay that reached the completion threshold", () => {
    expect(findResonance({ from, now, libraryAdds: [], events: [
      { action: "replay", createdAt: completedAt, sessionId: null,
        metadata: { outcome: { completionRatio: 0.95 } } },
      { action: "save", createdAt: savedAt, sessionId: null, metadata: {} },
    ] })).toMatchObject({ completedAt, followUp: "saved" });
  });

  it("keeps the 90% and later-follow-up requirements for replay anchors", () => {
    for (const completionRatio of [0.3, undefined]) {
      expect(findResonance({ from, now, libraryAdds: [], events: [
        { action: "replay", createdAt: completedAt, sessionId: null,
          metadata: { outcome: { completionRatio } } },
        { action: "save", createdAt: savedAt, sessionId: null, metadata: {} },
      ] })).toBeNull();
    }
    expect(findResonance({ from, now, libraryAdds: [], events: [
      { action: "replay", createdAt: completedAt, sessionId: null,
        metadata: { outcome: { completionRatio: 1 } } },
    ] })).toBeNull();
  });
});
