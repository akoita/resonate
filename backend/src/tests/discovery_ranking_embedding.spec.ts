/**
 * Ranking effect of embedding-sourced Home candidates (#2003, #2006) — pure
 * unit tests on the shared ranking core.
 */
import {
  DECLARED_PREFERENCE_WEIGHT,
  DiscoveryCandidate,
  DiscoveryRankingService,
  EMBEDDING_SIMILARITY_WEIGHT,
} from "../modules/recommendations/discovery-ranking.service";
import {
  DISCOVERY_EXPLANATION_VARIANTS,
  DISCOVERY_EXPLANATIONS,
  DISCOVERY_REASON_CODES,
} from "../modules/recommendations/discovery-explanations";

const context = { originalQueries: [], expandedQueries: [] };

function candidate(
  id: string,
  extra: Partial<DiscoveryCandidate> = {},
): DiscoveryCandidate {
  return { id, title: id, release: { genre: "Lofi", moods: [] }, ...extra };
}

describe("embedding candidates in the ranking core", () => {
  const ranking = new DiscoveryRankingService();

  it("keeps the weight modest: below declared preference and the learned cap", () => {
    expect(EMBEDDING_SIMILARITY_WEIGHT).toBeLessThan(DECLARED_PREFERENCE_WEIGHT);
    expect(EMBEDDING_SIMILARITY_WEIGHT).toBeLessThan(18);
  });

  it("scores a saved-seed neighbour with a similar_sound reason", async () => {
    const [ranked] = await ranking.rank(
      [candidate("n1", { embeddingSources: ["seed_track"] })],
      context,
    );
    expect(ranked.score).toBe(EMBEDDING_SIMILARITY_WEIGHT);
    expect(ranked.reasonCode).toBe("similar_sound");
    expect(ranked.explanation).toEqual([DISCOVERY_EXPLANATIONS.similar_sound]);
    expect(ranked.signals.map((s) => s.label)).toEqual(["embedding_similarity"]);
  });

  it("scores a note neighbour as something the listener asked for", async () => {
    const [ranked] = await ranking.rank(
      [candidate("n1", { embeddingSources: ["listener_note"] })],
      context,
    );
    expect(ranked.score).toBe(EMBEDDING_SIMILARITY_WEIGHT);
    expect(ranked.reasonCode).toBe("taste_match");
    expect(ranked.explanation).toEqual([DISCOVERY_EXPLANATION_VARIANTS.declared_taste]);
  });

  it("adds both signals when one track is a seed and a note neighbour", async () => {
    const [ranked] = await ranking.rank(
      [candidate("n1", { embeddingSources: ["seed_track", "listener_note"] })],
      context,
    );
    expect(ranked.score).toBe(EMBEDDING_SIMILARITY_WEIGHT * 2);
    // Equal weights: the declared-note label wins the tie by priority.
    expect(ranked.reasonCode).toBe("taste_match");
  });

  it("never outranks a track that matches the listener's stated taste", async () => {
    const ranked = await ranking.rank(
      [
        candidate("neighbour", { embeddingSources: ["seed_track", "listener_note"] }),
        candidate("stated", { matchedQueries: ["lofi"] }),
      ],
      { originalQueries: ["lofi"], expandedQueries: ["lofi"] },
    );
    expect(ranked.map((r) => r.id)).toEqual(["stated", "neighbour"]);
  });

  it("changes nothing for candidates without embedding sources", async () => {
    const [ranked] = await ranking.rank([candidate("plain")], context);
    expect(ranked.score).toBe(0);
    expect(ranked.reasonCode).toBe("catalog");
    expect(ranked.signals).toEqual([]);
  });

  it("emits only reason codes from the shared vocabulary and no raw history", async () => {
    const [ranked] = await ranking.rank(
      [candidate("n1", { embeddingSources: ["seed_track", "listener_note"] })],
      context,
    );
    expect(DISCOVERY_REASON_CODES).toContain(ranked.reasonCode);
    for (const signal of ranked.signals) {
      expect(signal.reason).not.toMatch(/n1|saved|played|track/i);
    }
  });
});
