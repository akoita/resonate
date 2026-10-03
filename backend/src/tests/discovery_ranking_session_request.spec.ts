import { DiscoveryRankingService } from "../modules/recommendations/discovery-ranking.service";
import type { TasteMemoryPolicy } from "../modules/recommendations/taste_memory.service";

const emptyPolicy = (): TasteMemoryPolicy => ({
  settings: {} as TasteMemoryPolicy["settings"],
  hidden: new Map(),
  downranked: new Map(),
  boosted: new Map(),
});

describe("DiscoveryRankingService lane-local session request", () => {
  const ranking = new DiscoveryRankingService();

  it("matches canonical request genres through catalog aliases", async () => {
    const [track] = await ranking.rank(
      [{ id: "alias", release: { genre: "Afrobeats" } }],
      {
        originalQueries: [],
        expandedQueries: [],
        sessionRequest: { genres: ["Afrobeat"], moods: [] },
      },
    );
    expect(track.signals).toContainEqual({
      label: "session_request",
      weight: 20,
      reason: "matches the current mix request",
    });
    expect(track.explanation).toContain("Fits your current mix request.");
  });

  it("matches catalog moods and respects hidden and downranked canonical controls", async () => {
    const candidate = [{ id: "warm", release: { genre: "Soul", moods: ["Warm"] } }];
    const context = {
      originalQueries: [],
      expandedQueries: [],
      sessionRequest: { genres: [], moods: ["Warmer"] },
    };
    const hidden = emptyPolicy();
    hidden.hidden.set("mood", new Set(["warm"]));
    const [hiddenTrack] = await ranking.rank(candidate, { ...context, tastePolicy: hidden });
    expect(hiddenTrack.signals.some((signal) => signal.label === "session_request")).toBe(false);

    const downranked = emptyPolicy();
    downranked.downranked.set("mood", new Set(["warm"]));
    const [downrankedTrack] = await ranking.rank(candidate, { ...context, tastePolicy: downranked });
    expect(downrankedTrack.signals.find((signal) => signal.label === "session_request")?.weight).toBe(7);
  });

  it("does not change candidates when no lane-local request is supplied", async () => {
    const [track] = await ranking.rank(
      [{ id: "plain", release: { genre: "Deep House", moods: ["Club"] } }],
      { originalQueries: [], expandedQueries: [] },
    );
    expect(track.signals.some((signal) => signal.label === "session_request")).toBe(false);
  });
});
