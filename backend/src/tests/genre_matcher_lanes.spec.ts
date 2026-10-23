/**
 * #2236: ordinary sessions and My Mix lanes share ONE genre matcher. A track
 * that satisfies a session request for a genre also belongs to, and is ranked
 * for, a lane for that genre; free-text catalog genres form lanes.
 */
import {
  matchingMyMixLaneIds,
  resolveMyMixPlan,
} from "../modules/agents/agent_my_mix";
import { computeListeningLanes, laneGenreFor, ListeningLane } from "../modules/agents/listening_lanes";
import type { AgentTasteSignalInput } from "../modules/agents/agent_learning.service";
import { genreMatchesRequest } from "../modules/recommendations/genre_families";
import { DiscoveryRankingService } from "../modules/recommendations/discovery-ranking.service";
import type { TasteMemoryPolicy } from "../modules/recommendations/taste_memory.service";

const NOW = new Date("2026-07-01T12:00:00.000Z");

function worldLane() {
  // The same lane a listener adds in the My Mix editor ("World" is in the vocabulary).
  return resolveMyMixPlan({ lanes: [], additions: [{ genre: "World" }] }, [], 5)!.lanes;
}

function lane(genreKey: string): ListeningLane {
  return {
    id: `lane_${genreKey}`,
    label: genreKey,
    genreWeights: { [genreKey]: 1 },
    moodWeights: {},
    strength: 1,
    contexts: {},
    energyBand: null,
  };
}

let counter = 0;
function sessionPair(genre: string): AgentTasteSignalInput[] {
  counter += 1;
  return ["a", "b"].map((suffix) => ({
    action: "complete",
    trackId: `track_${counter}_${suffix}`,
    sessionKey: `session_${counter}_${suffix}`,
    createdAt: NOW,
    genre,
    moods: [],
  }));
}

describe("one genre matcher for sessions and lanes (#2236)", () => {
  const worldReleases = ["African", "Mandingue", "Afrobeats", "West Africa", "Musiques du monde", "Coupé-Décalé"];

  it.each(worldReleases)("a %s track matches a World session and a World lane", async (genre) => {
    // Session path.
    expect(genreMatchesRequest(genre, "World")).toBe(true);

    // Lane membership (which candidates a lane may claim).
    expect(matchingMyMixLaneIds(worldLane(), { genre })).toEqual(worldLane().map((item) => item.id));

    // Lane ordering (the ranking core's lane request signal).
    const ranked = await new DiscoveryRankingService().rank(
      [{ id: "t", release: { genre } }],
      {
        originalQueries: [],
        expandedQueries: [],
        sessionRequest: { genres: ["World"], moods: [] },
      },
    );
    expect(ranked[0].signals.map((signal) => signal.label)).toContain("session_request");
  });

  it("does not let an unrelated genre into a World lane", async () => {
    expect(matchingMyMixLaneIds(worldLane(), { genre: "Techno" })).toEqual([]);
    const ranked = await new DiscoveryRankingService().rank(
      [{ id: "t", release: { genre: "Techno" } }],
      { originalQueries: [], expandedQueries: [], sessionRequest: { genres: ["World"], moods: [] } },
    );
    expect(ranked[0].signals.map((signal) => signal.label)).not.toContain("session_request");
  });

  it("keeps lane keys written before the change working (vocabulary labels and aliases)", () => {
    expect(matchingMyMixLaneIds([lane("Hip-Hop") as never], { genre: "Hip Hop" })).toEqual(["lane_Hip-Hop"]);
    expect(matchingMyMixLaneIds([lane("Drum & Bass") as never], { genre: "DnB" })).toEqual(["lane_Drum & Bass"]);
    expect(matchingMyMixLaneIds([lane("Techno") as never], { genre: "Techno" })).toEqual(["lane_Techno"]);
    expect(matchingMyMixLaneIds([lane("Techno") as never], { genre: "Jazz" })).toEqual([]);
    // A family id key also resolves.
    expect(matchingMyMixLaneIds([lane("african") as never], { genre: "Mandingue" })).toEqual(["lane_african"]);
    expect(matchingMyMixLaneIds([lane("african") as never], { genre: "Afrobeats" })).toEqual(["lane_african"]);
  });

  it("keeps the mood fallback for a lane with no genre", () => {
    const moodOnly: ListeningLane = { ...lane("x"), genreWeights: {}, moodWeights: { Warm: 1 } };
    expect(matchingMyMixLaneIds([moodOnly as never], { genre: "Anything", moods: ["warm"] })).toEqual(["lane_x"]);
  });

  describe("lanes from free-text genres", () => {
    it("keys vocabulary genres by their label and other genres by family id", () => {
      expect(laneGenreFor("Techno")).toEqual({ key: "Techno", profileGenre: "Techno" });
      expect(laneGenreFor("hip hop")).toEqual({ key: "Hip-Hop", profileGenre: "Hip-Hop" });
      expect(laneGenreFor("Mandingue")).toEqual({ key: "african", profileGenre: "Mandingue" });
      expect(laneGenreFor("French Rap")).toEqual({ key: "hip-hop", profileGenre: "French Rap" });
      expect(laneGenreFor("Senegal")).toBeUndefined();
      expect(laneGenreFor(null)).toBeUndefined();
    });

    it("forms a lane from free-text history that used to produce none", () => {
      const history = [
        ...sessionPair("African"),
        ...sessionPair("Mandingue"),
        ...sessionPair("Highlife"),
      ];
      const lanes = computeListeningLanes(history, NOW);
      expect(lanes).toHaveLength(1);
      expect(Object.keys(lanes[0].genreWeights)).toEqual(["african"]);
      expect(lanes[0].label).toBe("African");
      expect(lanes[0].id).toMatch(/^lane_[a-f0-9]{32}$/);

      // The lane claims every African-family release and a World session's too.
      const plan = resolveMyMixPlan({}, lanes, 5)!;
      for (const genre of ["African", "Mandingue", "Highlife", "Afrobeats"]) {
        expect(matchingMyMixLaneIds(plan.lanes, { genre })).toEqual([lanes[0].id]);
      }
      expect(matchingMyMixLaneIds(plan.lanes, { genre: "Techno" })).toEqual([]);
    });

    it("leaves lanes of vocabulary genres exactly as they were, ids included", () => {
      const lanes = computeListeningLanes([...sessionPair("Soul"), ...sessionPair("Soul")], NOW);
      expect(lanes).toHaveLength(1);
      expect(Object.keys(lanes[0].genreWeights)).toEqual(["Soul"]);
      expect(lanes[0].label).toBe("Soul");
    });

    it("still drops a genre no vocabulary or family names", () => {
      expect(computeListeningLanes([...sessionPair("Senegal"), ...sessionPair("Senegal")], NOW)).toEqual([]);
    });

    it("applies the listener's genre controls to the free-text label", () => {
      const controls = (hidden: string[]): TasteMemoryPolicy => ({
        settings: {
          socialMatchingEnabled: false,
          citySceneDiscoveryEnabled: false,
          agentPlaybackTrainingEnabled: true,
          recommendationExplanationPreference: "balanced",
          resetAt: null,
        },
        hidden: new Map([["genre", new Set(hidden)]]),
        downranked: new Map(),
        boosted: new Map(),
      } as unknown as TasteMemoryPolicy);
      const history = [...sessionPair("Mandingue"), ...sessionPair("Mandingue")];
      expect(computeListeningLanes(history, NOW, controls([]))).toHaveLength(1);
      expect(computeListeningLanes(history, NOW, controls(["mandingue"]))).toEqual([]);
    });
  });
});
