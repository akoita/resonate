/**
 * Discovery policy stage (ADR-TE-2, docs/rfc/taste-engine.md §3.4) — pure unit
 * tests. One `describe` per public recommendation rule, plus the deterministic
 * fallback and warehouse/embedding paths the RFC requires to pass the same
 * assertions.
 */
import {
  DISCOVERY_EXPLANATION_VARIANTS,
  DISCOVERY_EXPLANATIONS,
  DISCOVERY_REASON_CODES,
  primaryReasonFor,
} from "../modules/recommendations/discovery-explanations";
import {
  applyFirstListenerReservationOutcome,
  applyDiscoveryPolicy,
  DISCOVERY_POLICY_DEFAULTS,
  discoveryArtistKey,
  hasPositiveFirstListenerTasteSignal,
} from "../modules/recommendations/discovery-policy";
import {
  DiscoveryCandidate,
  DiscoveryRankingService,
  RankedDiscoveryCandidate,
} from "../modules/recommendations/discovery-ranking.service";
import type { TasteMemoryPolicy } from "../modules/recommendations/taste_memory.service";

type Ranked = RankedDiscoveryCandidate;

function ranked(
  id: string,
  score: number,
  extra: Partial<Ranked> = {},
): Ranked {
  return {
    id,
    title: id,
    score,
    signals: [],
    explanation: ["Selected vibe match"],
    reasonCode: "taste_match",
    recentlyPlayed: false,
    ...extra,
  };
}

function tastePolicy(
  hidden: Partial<Record<string, string[]>> = {},
  downranked: Partial<Record<string, string[]>> = {},
  boosted: Partial<Record<string, string[]>> = {},
): TasteMemoryPolicy {
  const toMap = (source: Partial<Record<string, string[]>>) =>
    new Map(
      Object.entries(source).map(([type, values]) => [
        type,
        new Set((values ?? []).map((value) => value.toLowerCase())),
      ]),
    ) as TasteMemoryPolicy["hidden"];
  return {
    settings: {
      socialMatchingEnabled: false,
      citySceneDiscoveryEnabled: false,
      agentPlaybackTrainingEnabled: true,
      recommendationExplanationPreference: "balanced",
      resetAt: null,
    },
    hidden: toMap(hidden),
    downranked: toMap(downranked),
    boosted: toMap(boosted),
  };
}

const ids = (items: Array<{ id: string }>) => items.map((item) => item.id);

describe("discovery policy (ADR-TE-2)", () => {
  describe("rule 1: declared taste first", () => {
    it("removes items hidden by genre, mood and artist", () => {
      const list = [
        ranked("hidden-genre", 90, { release: { genre: "Polka" } }),
        ranked("hidden-mood", 80, { release: { moods: ["Angry", "Dark"] } }),
        ranked("hidden-artist-name", 70, { artist: "Some Band" }),
        ranked("hidden-artist-credit", 60, {
          release: { artistDisplayName: "Some Band" },
        }),
        ranked("hidden-artist-id", 55, { artistId: "artist-hidden" }),
        ranked("kept", 50, { release: { genre: "House", moods: ["Warm"] } }),
      ];
      const result = applyDiscoveryPolicy(list, {
        limit: 10,
        tastePolicy: tastePolicy({
          genre: ["polka"],
          mood: ["angry"],
          artist: ["Some Band", "artist-hidden"],
        }),
      });
      expect(ids(result.items)).toEqual(["kept"]);
      expect(result.dropped.hidden).toBe(5);
    });

    it("removes candidates that only surfaced through a hidden query", () => {
      const result = applyDiscoveryPolicy(
        [
          ranked("via-scene", 40, { matchedQueries: ["Lagos Nights"] }),
          ranked("ok", 30),
        ],
        { limit: 5, tastePolicy: tastePolicy({ scene: ["lagos nights"] }) },
      );
      expect(ids(result.items)).toEqual(["ok"]);
    });

    it("never lets a hidden item through, even as the best exploration candidate", () => {
      const result = applyDiscoveryPolicy(
        [
          ranked("hidden-star", 99, {
            artistId: "a-new",
            release: { genre: "Polka" },
          }),
          ranked("plain", 10, { artistId: "a-old" }),
        ],
        {
          limit: 2,
          tastePolicy: tastePolicy({ genre: ["Polka"] }),
          verifiedHumanArtistIds: new Set(["a-new"]),
        },
      );
      expect(ids(result.items)).toEqual(["plain"]);
      expect(result.exploration).toEqual({ reserved: 1, served: 0 });
    });

    it("keeps downranked items (the ranking core already scored them down)", () => {
      const result = applyDiscoveryPolicy(
        [ranked("soft", 5, { release: { genre: "Metal" } })],
        { limit: 3, tastePolicy: tastePolicy({}, { genre: ["Metal"] }) },
      );
      expect(ids(result.items)).toEqual(["soft"]);
    });
  });

  describe("rule 2: fully AI-generated tracks stay off unless asked for", () => {
    const list = [
      ranked("all", 90, { aiDisclosureLevel: "ALL" }),
      ranked("all-lower", 85, { aiDisclosureLevel: "all" }),
      ranked("partly", 80, { aiDisclosureLevel: "PARTLY" }),
      ranked("none", 70, { aiDisclosureLevel: "NONE" }),
      ranked("undeclared", 60, { aiDisclosureLevel: "UNDECLARED" }),
      ranked("unknown", 50),
    ];

    it("removes fully AI-generated tracks by default", () => {
      const result = applyDiscoveryPolicy(list, { limit: 10 });
      expect(ids(result.items)).toEqual([
        "partly",
        "none",
        "undeclared",
        "unknown",
      ]);
      expect(result.dropped.aiGenerated).toBe(2);
    });

    it("keeps them when the request explicitly asked for AI content", () => {
      const result = applyDiscoveryPolicy(list, {
        limit: 10,
        allowAiContent: true,
      });
      expect(ids(result.items)).toContain("all");
      expect(result.dropped.aiGenerated).toBe(0);
    });

    it("never offers a fully AI-generated track as a discovery pick", () => {
      const result = applyDiscoveryPolicy(
        [
          ranked("ai-new", 99, { artistId: "a1", aiDisclosureLevel: "ALL" }),
          ranked("human-new", 5, { artistId: "a2", aiDisclosureLevel: "NONE" }),
        ],
        { limit: 5, verifiedHumanArtistIds: new Set(["a1", "a2"]) },
      );
      expect(ids(result.items)).toEqual(["human-new"]);
      expect(result.items[0].reasonCode).toBe("discovery_pick");
    });

    it("never gives a fully AI-generated track exploration priority when AI was requested", () => {
      const result = applyDiscoveryPolicy(
        [
          ranked("requested-ai", 100, {
            artistId: "a1",
            aiDisclosureLevel: "ALL",
            signals: [{ label: "taste_match", weight: 1, reason: "matches taste" }],
          }),
        ],
        { limit: 1, allowAiContent: true, verifiedHumanArtistIds: new Set(["a1"]) },
      );
      expect(result.items[0]?.id).toBe("requested-ai");
      expect(result.items[0]?.reasonCode).not.toBe("discovery_pick");
      expect(result.exploration.served).toBe(0);
    });
  });

  describe("rule 3: exploration share", () => {
    const verified = new Set(["new1", "new2", "new3", "played"]);
    const played = new Set(["played"]);
    const base = (): Ranked[] => [
      ranked("familiar-1", 100, { artistId: "fam1" }),
      ranked("familiar-2", 95, { artistId: "fam2" }),
      ranked("unverified-new", 90, { artistId: "unv" }),
      ranked("played-verified", 85, { artistId: "played" }),
      ranked("new-a", 40, { artistId: "new1" }),
      ranked("new-b", 60, { artistId: "new2" }),
      ranked("new-c", 20, { artistId: "new3" }),
      ranked("familiar-3", 30, { artistId: "fam3" }),
      ranked("familiar-4", 25, { artistId: "fam4" }),
      ranked("familiar-5", 22, { artistId: "fam5" }),
    ].sort((a, b) => b.score - a.score); // the ranking core hands over score order

    it("reserves 20% of the page for verified, never-played human artists, best taste fit first", () => {
      const result = applyDiscoveryPolicy(base(), {
        limit: 10,
        verifiedHumanArtistIds: verified,
        playedArtistIds: played,
      });
      expect(result.exploration).toEqual({ reserved: 2, served: 2 });
      const picks = result.items.filter((i) => i.reasonCode === "discovery_pick");
      expect(ids(picks)).toEqual(["new-b", "new-a"]);
      expect(picks[0].explanation[0]).toBe(DISCOVERY_EXPLANATIONS.discovery_pick);
    });

    it("pulls a discovery pick onto a short page ahead of higher-scoring familiar items", () => {
      const result = applyDiscoveryPolicy(base(), {
        limit: 3,
        verifiedHumanArtistIds: verified,
        playedArtistIds: played,
      });
      expect(result.exploration).toEqual({ reserved: 1, served: 1 });
      expect(ids(result.items)).toEqual(["familiar-1", "familiar-2", "new-b"]);
    });

    it("never labels a candidate with no positive taste score as a discovery pick", () => {
      const result = applyDiscoveryPolicy(
        [
          ranked("familiar", 50, { artistId: "fam1" }),
          ranked("zero-fit", 0, { artistId: "new1" }),
        ],
        { limit: 2, verifiedHumanArtistIds: verified, playedArtistIds: played },
      );
      expect(result.exploration).toEqual({ reserved: 1, served: 0 });
      expect(result.items.some((i) => i.reasonCode === "discovery_pick")).toBe(false);
    });

    it("prioritizes fresh candidates only inside the reserved share and only with a positive taste signal", () => {
      const result = applyDiscoveryPolicy(
        [
          ranked("ordinary-exploration", 90, { artistId: "new1" }),
          ranked("first-listener", 20, {
            artistId: "new2",
            releaseId: "release-new",
            firstListenerEligible: true,
            signals: [{ label: "taste_match", weight: 40, reason: "matches selected taste" }],
          }),
          ranked("first-listener-no-signal", 100, {
            artistId: "new3",
            releaseId: "release-no-signal",
            firstListenerEligible: true,
          }),
        ],
        { limit: 5, verifiedHumanArtistIds: verified, playedArtistIds: played },
      );

      expect(result.exploration).toEqual({ reserved: 1, served: 1 });
      expect(result.items.find((item) => item.id === "first-listener")?.reasonCode)
        .toBe("discovery_pick");
      expect(result.items.find((item) => item.id === "first-listener-no-signal")?.reasonCode)
        .not.toBe("discovery_pick");
      expect(result.items.find((item) => item.id === "ordinary-exploration")?.reasonCode)
        .not.toBe("discovery_pick");
    });

    it("recognizes only named, positive user taste signals for fresh placements", () => {
      expect(
        hasPositiveFirstListenerTasteSignal(
          ranked("taste", 1, {
            signals: [{ label: "session_intent_fit", weight: 12, reason: "fits focus" }],
          }),
        ),
      ).toBe(true);
      expect(
        hasPositiveFirstListenerTasteSignal(
          ranked("catalog-only", 100, {
            signals: [{ label: "catalog_freshness", weight: 100, reason: "new" }],
          }),
        ),
      ).toBe(false);
      expect(
        hasPositiveFirstListenerTasteSignal(
          ranked("negative", 100, {
            signals: [{ label: "taste_match", weight: -5, reason: "downranked" }],
          }),
        ),
      ).toBe(false);
    });

    it("does not promote a second fresh candidate after a reservation error", () => {
      const pool = [
        ranked("fresh-a", 100, {
          artistId: "new1",
          releaseId: "release-a",
          firstListenerEligible: true,
          signals: [{ label: "taste_match", weight: 1, reason: "fit" }],
        }),
        ranked("fresh-b", 90, {
          artistId: "new2",
          releaseId: "release-b",
          firstListenerEligible: true,
          signals: [{ label: "taste_match", weight: 1, reason: "fit" }],
        }),
        ranked("baseline-a", 80, { artistId: "fam1" }),
        ranked("baseline-b", 70, { artistId: "fam2" }),
        ranked("baseline-c", 60, { artistId: "fam3" }),
      ];
      const options = { limit: 3, verifiedHumanArtistIds: verified, playedArtistIds: played };
      const initial = applyDiscoveryPolicy(pool, options);
      const resolved = applyFirstListenerReservationOutcome(pool, initial, new Set(), options);

      expect(initial.items.find((item) => item.firstListenerEligible)?.reasonCode)
        .toBe("discovery_pick");
      expect(ids(resolved.items)).toEqual(["baseline-a", "baseline-b", "baseline-c"]);
      expect(resolved.items.some((item) => item.firstListenerEligible)).toBe(false);
    });

    it("fills a cap-denied fresh slot from ordinary candidates without an unreserved fresh pick", () => {
      const pool = [
        ranked("fresh-denied", 100, {
          artistId: "new1",
          releaseId: "release-denied",
          firstListenerEligible: true,
          signals: [{ label: "taste_match", weight: 1, reason: "fit" }],
        }),
        ranked("fresh-also-denied", 90, {
          artistId: "new2",
          releaseId: "release-also-denied",
          firstListenerEligible: true,
          signals: [{ label: "taste_match", weight: 1, reason: "fit" }],
        }),
        ranked("baseline-a", 80, { artistId: "fam1" }),
        ranked("baseline-b", 70, { artistId: "fam2" }),
        ranked("baseline-c", 60, { artistId: "fam3" }),
      ];
      const options = { limit: 3, verifiedHumanArtistIds: verified, playedArtistIds: played };
      const initial = applyDiscoveryPolicy(pool, options);
      const resolved = applyFirstListenerReservationOutcome(pool, initial, new Set(), options);

      expect(ids(resolved.items)).toEqual(["baseline-a", "baseline-b", "baseline-c"]);
      expect(resolved.exploration.served).toBe(0);
      expect(resolved.items.every((item) => item.reasonCode !== "discovery_pick")).toBe(true);
    });

    it("keeps accepted reservations and removes all other fresh candidates before filling", () => {
      const pool = [
        ranked("fresh-accepted", 100, {
          artistId: "new1",
          releaseId: "release-accepted",
          firstListenerEligible: true,
          signals: [{ label: "taste_match", weight: 1, reason: "fit" }],
        }),
        ranked("fresh-denied", 90, {
          artistId: "new2",
          releaseId: "release-denied",
          firstListenerEligible: true,
          signals: [{ label: "taste_match", weight: 1, reason: "fit" }],
        }),
        ranked("baseline-a", 80, { artistId: "fam1" }),
        ranked("baseline-b", 70, { artistId: "fam2" }),
        ranked("baseline-c", 60, { artistId: "fam3" }),
      ];
      const options = { limit: 5, verifiedHumanArtistIds: verified, playedArtistIds: played };
      const initial = applyDiscoveryPolicy(pool, options);
      const resolved = applyFirstListenerReservationOutcome(
        pool,
        initial,
        new Set(["release-accepted"]),
        options,
      );

      expect(ids(resolved.items)).toContain("fresh-accepted");
      expect(resolved.items.find((item) => item.id === "fresh-accepted")?.reasonCode)
        .toBe("discovery_pick");
      expect(ids(resolved.items)).not.toContain("fresh-denied");
      expect(resolved.items.filter((item) => item.firstListenerEligible))
        .toEqual([expect.objectContaining({ id: "fresh-accepted" })]);
    });

    it("never uses unverified artists, played artists, or candidates with no artist id", () => {
      const result = applyDiscoveryPolicy(
        [
          ranked("unverified", 90, { artistId: "unv" }),
          ranked("played", 80, { artistId: "played" }),
          ranked("anonymous", 70),
        ],
        { limit: 3, verifiedHumanArtistIds: verified, playedArtistIds: played },
      );
      expect(result.exploration.served).toBe(0);
      expect(
        result.items.some((item) => item.reasonCode === "discovery_pick"),
      ).toBe(false);
    });

    it("falls back to normal ranked order, unlabeled, when nobody is eligible", () => {
      const result = applyDiscoveryPolicy(
        [ranked("a", 30), ranked("b", 20), ranked("c", 10)],
        { limit: 3 },
      );
      expect(ids(result.items)).toEqual(["a", "b", "c"]);
      expect(result.exploration).toEqual({ reserved: 1, served: 0 });
      for (const item of result.items) {
        expect(item.reasonCode).not.toBe("discovery_pick");
        expect(item.explanation).not.toContain(
          DISCOVERY_EXPLANATIONS.discovery_pick,
        );
      }
    });

    it("reserves at least one slot even on a tiny page", () => {
      for (const limit of [1, 2, 4]) {
        const result = applyDiscoveryPolicy(base(), {
          limit,
          verifiedHumanArtistIds: verified,
          playedArtistIds: played,
        });
        expect(result.exploration.reserved).toBe(1);
        expect(result.exploration.served).toBe(1);
        expect(result.items).toHaveLength(limit);
      }
      expect(DISCOVERY_POLICY_DEFAULTS.explorationShare).toBe(0.2);
    });

    it("does not relabel a recently served track as a discovery pick", () => {
      const result = applyDiscoveryPolicy(
        [ranked("recent", 0, { artistId: "new1", recentlyPlayed: true })],
        { limit: 1, verifiedHumanArtistIds: verified },
      );
      expect(result.exploration.served).toBe(0);
      expect(result.items[0].reasonCode).toBe("taste_match");
    });

    it("counts the session, not the call: one-track next picks are not always discovery", () => {
      const list = [
        ranked("familiar", 80, { artistId: "fam1" }),
        ranked("fresh", 40, { artistId: "new1" }),
      ];
      const common = { limit: 1, verifiedHumanArtistIds: new Set(["new1"]) };

      // Start of session: the one slot is the exploration slot.
      const first = applyDiscoveryPolicy(list, {
        ...common,
        priorSessionArtistKeys: [],
      });
      expect(ids(first.items)).toEqual(["fresh"]);

      // Mid-session with an exploration pick already served: back to ranking.
      const mid = applyDiscoveryPolicy(list, {
        ...common,
        priorSessionArtistKeys: ["id:a", "id:b", "id:c", "id:d"],
        priorExplorationCount: 1,
      });
      expect(mid.exploration.reserved).toBe(0);
      expect(ids(mid.items)).toEqual(["familiar"]);

      // Five tracks in with none: due for one again.
      const due = applyDiscoveryPolicy(list, {
        ...common,
        priorSessionArtistKeys: ["id:a", "id:b", "id:c", "id:d"],
        priorExplorationCount: 0,
      });
      expect(ids(due.items)).toEqual(["fresh"]);
    });

    describe("late-session reserve with a full prior window", () => {
      const prior = Array.from({ length: 9 }, (_, i) => `id:p${i}`);
      const pool = (): Ranked[] =>
        [
          ranked("fam-1", 100, { artistId: "f1" }),
          ranked("fam-2", 95, { artistId: "f2" }),
          ranked("fam-3", 90, { artistId: "f3" }),
          ranked("new-a", 80, { artistId: "n1" }),
          ranked("new-b", 70, { artistId: "n2" }),
          ranked("new-c", 60, { artistId: "n3" }),
          ranked("new-d", 50, { artistId: "n4" }),
        ];
      const common = {
        limit: 5,
        verifiedHumanArtistIds: new Set(["n1", "n2", "n3", "n4"]),
        priorSessionArtistKeys: prior,
      };

      it("reserves the remaining share of the window: 9 prior + 5 = 14 -> 3, minus 2 served = 1", () => {
        const result = applyDiscoveryPolicy(pool(), {
          ...common,
          priorExplorationCount: 2,
        });
        expect(result.exploration).toEqual({ reserved: 1, served: 1 });
      });

      it("reserves nothing once prior exploration already meets the target", () => {
        const result = applyDiscoveryPolicy(pool(), {
          ...common,
          priorExplorationCount: 3,
        });
        expect(result.exploration).toEqual({ reserved: 0, served: 0 });
        expect(
          result.items.filter((i) => i.reasonCode === "discovery_pick"),
        ).toHaveLength(0);
      });

      it("never inflates the reserve when the prior count is unknown: share over the page only", () => {
        const result = applyDiscoveryPolicy(pool(), common);
        // max(1, round(5 * 0.2)) = 1, not round(14 * 0.2) = 3 of 5 picks.
        expect(result.exploration).toEqual({ reserved: 1, served: 1 });
        expect(
          result.items.filter((i) => i.reasonCode === "discovery_pick"),
        ).toHaveLength(1);
      });

      it("a known zero is still due, but never catches up in a burst", () => {
        // Window share is round(14 * 0.2) = 3, but one call reserves at most
        // its own page share, max(1, round(5 * 0.2)) = 1.
        const result = applyDiscoveryPolicy(pool(), {
          ...common,
          priorExplorationCount: 0,
        });
        expect(result.exploration.reserved).toBe(1);
      });
    });
  });

  describe("rule 4: diversity cap", () => {
    it("allows at most two tracks per artist per page", () => {
      const list = [
        ranked("a1", 90, { artistId: "A" }),
        ranked("a2", 80, { artistId: "A" }),
        ranked("a3", 70, { artistId: "A" }),
        ranked("b1", 60, { artistId: "B" }),
        ranked("a4", 50, { artistId: "A" }),
      ];
      const result = applyDiscoveryPolicy(list, { limit: 5 });
      expect(ids(result.items)).toEqual(["a1", "a2", "b1"]);
      expect(result.dropped.diversity).toBe(2);
    });

    it("keys by credited name when there is no artist id, and never collides unknown artists", () => {
      const named = [
        ranked("n1", 90, { release: { artistDisplayName: "Ada  Lovelace" } }),
        ranked("n2", 80, { artist: "ada lovelace" }),
        ranked("n3", 70, { release: { artistDisplayName: "ADA LOVELACE" } }),
      ];
      expect(ids(applyDiscoveryPolicy(named, { limit: 5 }).items)).toEqual([
        "n1",
        "n2",
      ]);

      const unknown = [ranked("u1", 9), ranked("u2", 8), ranked("u3", 7)];
      expect(ids(applyDiscoveryPolicy(unknown, { limit: 5 }).items)).toEqual([
        "u1",
        "u2",
        "u3",
      ]);
      expect(discoveryArtistKey(unknown[0])).not.toBe(discoveryArtistKey(unknown[1]));
    });

    it("counts exploration picks toward the cap", () => {
      const list = [
        ranked("fam-1", 90, { artistId: "V" }),
        ranked("fam-2", 80, { artistId: "V" }),
        ranked("disc", 10, { artistId: "V" }),
        ranked("other", 5, { artistId: "O" }),
      ];
      // V is verified and unplayed, so "fam-1" (top score) is the exploration
      // pick; the cap still stops a third V track from appearing.
      const result = applyDiscoveryPolicy(list, {
        limit: 4,
        verifiedHumanArtistIds: new Set(["V"]),
      });
      expect(result.items.filter((i) => i.artistId === "V")).toHaveLength(2);
      expect(ids(result.items)).toEqual(["fam-1", "fam-2", "other"]);
    });

    it("seeds the cap from prior session tracks (per 10 session tracks)", () => {
      const list = [
        ranked("a1", 90, { artistId: "A" }),
        ranked("b1", 80, { artistId: "B" }),
        ranked("a2", 70, { artistId: "A" }),
      ];
      const result = applyDiscoveryPolicy(list, {
        limit: 3,
        priorSessionArtistKeys: ["id:A", "id:x", "id:y"],
      });
      expect(ids(result.items)).toEqual(["a1", "b1"]);
    });

    it("only considers the last 9 prior session tracks", () => {
      const prior = ["id:A", "id:A", ...Array.from({ length: 9 }, (_, i) => `id:z${i}`)];
      const result = applyDiscoveryPolicy([ranked("a1", 10, { artistId: "A" })], {
        limit: 1,
        priorSessionArtistKeys: prior,
      });
      expect(ids(result.items)).toEqual(["a1"]);
    });

    it("honours a custom cap", () => {
      const list = [1, 2, 3].map((n) => ranked(`a${n}`, 10 - n, { artistId: "A" }));
      expect(
        applyDiscoveryPolicy(list, { limit: 5, maxPerArtist: 1 }).items,
      ).toHaveLength(1);
    });
  });

  describe("rule 5: every item carries a categorical explanation", () => {
    it("guarantees a non-empty explanation and a reason code", () => {
      const bare = {
        ...ranked("bare", 1),
        explanation: [],
        reasonCode: undefined,
        signals: [{ label: "expanded_taste_match", weight: 28, reason: "x" }],
      } as unknown as Ranked;
      const result = applyDiscoveryPolicy([bare, ranked("ok", 0)], { limit: 5 });
      for (const item of result.items) {
        expect(item.explanation.length).toBeGreaterThan(0);
        expect(item.explanation.every((line) => line.trim().length > 0)).toBe(true);
        expect(DISCOVERY_REASON_CODES).toContain(item.reasonCode);
      }
      expect(result.items[0].reasonCode).toBe("nearby_taste");
      expect(result.items[0].explanation).toEqual([
        DISCOVERY_EXPLANATIONS.nearby_taste,
      ]);
    });

    it("has a sentence for every reason code and none that names a listener", () => {
      for (const code of DISCOVERY_REASON_CODES) {
        expect(DISCOVERY_EXPLANATIONS[code].length).toBeGreaterThan(0);
      }
      const all = [
        ...Object.values(DISCOVERY_EXPLANATIONS),
        ...Object.values(DISCOVERY_EXPLANATION_VARIANTS),
      ];
      expect(all.some((line) => /purchas(able|e) stem|listing/i.test(line))).toBe(false);
    });

    it("derives the primary reason deterministically from signals", () => {
      expect(primaryReasonFor([])).toBe("catalog");
      expect(
        primaryReasonFor([
          { label: "learned_preference", weight: 18, reason: "g" },
          { label: "taste_match", weight: 40, reason: "q" },
        ]),
      ).toBe("taste_match");
      // equal weight: fixed label priority, independent of signal order
      const a = { label: "cohort_context", weight: 12, reason: "c" };
      const b = { label: "semantic_similarity", weight: 12, reason: "s" };
      expect(primaryReasonFor([a, b])).toBe("scene");
      expect(primaryReasonFor([b, a])).toBe("scene");
      // penalties and unexplained signals never become the reason
      expect(
        primaryReasonFor([
          { label: "audio_features", weight: 9, reason: "120 BPM" },
          { label: "recently_played", weight: -100, reason: "dup" },
        ]),
      ).toBe("catalog");
      expect(
        primaryReasonFor([
          { label: "bigquery_taste_score", weight: 15, reason: "Focus session intent" },
        ]),
      ).toBe("session_fit");
    });
  });

  describe("rule 6: no input through which ranking could be bought", () => {
    const candidates = (listed: boolean): DiscoveryCandidate[] => [
      {
        id: "t1",
        artistId: "a1",
        hasListing: listed,
        release: { genre: "House" },
        matchedQueries: ["House"],
      },
      {
        id: "t2",
        artistId: "a2",
        hasListing: false,
        release: { genre: "House" },
        matchedQueries: ["House"],
      },
      { id: "t3", artistId: "a3", hasListing: listed, release: { genre: "Jazz" } },
    ];
    const context = {
      originalQueries: ["House"],
      expandedQueries: ["House"],
      learnedGenreWeights: { House: 3 },
    };

    it("an active stem listing changes neither score nor order", async () => {
      const service = new DiscoveryRankingService();
      const withListing = await service.rank(candidates(true), context);
      const without = await service.rank(candidates(false), context);

      expect(withListing.map((c) => [c.id, c.score])).toEqual(
        without.map((c) => [c.id, c.score]),
      );
      expect(ids(withListing)).toEqual(ids(without));
      for (const item of withListing) {
        expect(item.signals.map((s) => s.label)).not.toContain("listed");
        expect(item.explanation.join(" ")).not.toMatch(/purchasable|listing/i);
      }
    });

    it("a listing is not even a tiebreak between equal scores", async () => {
      const service = new DiscoveryRankingService();
      const tie = (listedFirst: boolean): DiscoveryCandidate[] => [
        { id: "x", hasListing: listedFirst },
        { id: "y", hasListing: !listedFirst },
      ];
      expect(ids(await service.rank(tie(true), context))).toEqual(["x", "y"]);
      expect(ids(await service.rank(tie(false), context))).toEqual(["x", "y"]);
    });

    it("the policy stage ignores listings too", async () => {
      const service = new DiscoveryRankingService();
      const run = async (listed: boolean) =>
        applyDiscoveryPolicy(await service.rank(candidates(listed), context), {
          limit: 3,
        });
      expect(ids((await run(true)).items)).toEqual(ids((await run(false)).items));
    });
  });

  describe("deterministic path and enriched path pass the same assertions", () => {
    const pool = (): DiscoveryCandidate[] => [
      ...["A", "A", "A", "B", "B", "B"].map((artist, n) => ({
        id: `fam-${n}`,
        artistId: artist,
        aiDisclosureLevel: "NONE",
        release: { genre: "House", moods: ["Warm"] },
        matchedQueries: ["House"],
      })),
      {
        id: "ai-track",
        artistId: "C",
        aiDisclosureLevel: "ALL",
        release: { genre: "House" },
        matchedQueries: ["House"],
      },
      {
        id: "hidden-track",
        artistId: "D",
        release: { genre: "Polka" },
        matchedQueries: ["House"],
      },
      {
        id: "new-verified",
        artistId: "N",
        aiDisclosureLevel: "NONE",
        release: { genre: "Deep House" },
        matchedQueries: ["Deep House"],
      },
    ];
    const policyOptions = {
      limit: 5,
      tastePolicy: tastePolicy({ genre: ["polka"] }),
      verifiedHumanArtistIds: new Set(["N"]),
      playedArtistIds: new Set(["A", "B"]),
    };

    function assertRules(items: Ranked[]) {
      expect(items.length).toBeLessThanOrEqual(5);
      expect(ids(items)).not.toContain("hidden-track");
      expect(ids(items)).not.toContain("ai-track");
      const perArtist = new Map<string, number>();
      for (const item of items) {
        perArtist.set(item.artistId!, (perArtist.get(item.artistId!) ?? 0) + 1);
        expect(item.explanation.length).toBeGreaterThan(0);
        expect(DISCOVERY_REASON_CODES).toContain(item.reasonCode);
        expect(item.signals.map((s) => s.label)).not.toContain("listed");
      }
      expect(Math.max(...perArtist.values())).toBeLessThanOrEqual(2);
      const pick = items.find((item) => item.id === "new-verified");
      expect(pick?.reasonCode).toBe("discovery_pick");
    }

    it("holds on the deterministic path (taste signals only)", async () => {
      const service = new DiscoveryRankingService();
      const rankedPool = await service.rank(pool(), {
        originalQueries: ["House"],
        expandedQueries: ["House", "Deep House"],
        tastePolicy: policyOptions.tastePolicy,
      });
      const { items, exploration } = applyDiscoveryPolicy(rankedPool, policyOptions);
      assertRules(items);
      expect(exploration.served).toBe(1);
    });

    it("holds with warehouse and embedding signals switched on", async () => {
      const service = new DiscoveryRankingService();
      const similarityScores = new Map(
        pool().map((c, n) => [c.id, n === 0 ? 1 : 0.5]),
      );
      const bigQueryTasteScores = new Map(
        pool().map((c) => [
          c.id,
          {
            trackId: c.id,
            score: c.id === "ai-track" || c.id === "hidden-track" ? 1 : 0.6,
            explanation: "listening pattern and focus session intent",
          },
        ]),
      );
      const rankedPool = await service.rank(pool(), {
        originalQueries: ["House"],
        expandedQueries: ["House", "Deep House"],
        tastePolicy: policyOptions.tastePolicy,
        similarityScores,
        bigQueryTasteScores,
      });
      // The warehouse loves the tracks the listener hid or that are AI; the
      // policy must still keep them out.
      expect(ids(rankedPool.slice(0, 2)).sort()).toEqual(
        ["ai-track", "hidden-track"].sort(),
      );
      const { items } = applyDiscoveryPolicy(rankedPool, policyOptions);
      assertRules(items);
    });
  });

  describe("My Mix quota allocation", () => {
    it("uses each lane's intent-ranked order", () => {
      const result = applyDiscoveryPolicy(
        [ranked("global-high", 100), ranked("lane-high", 90), ranked("lane-request-fit", 10)],
        {
          limit: 1,
          laneQuotas: [{ id: "lane", requested: 1, strength: 1 }],
          laneMatchesByCandidateId: new Map([
            ["lane-high", ["lane"]],
            ["lane-request-fit", ["lane"]],
          ]),
          laneCandidateOrderByLaneId: new Map([["lane", ["lane-request-fit", "lane-high"]]]),
        },
      );
      expect(ids(result.items)).toEqual(["lane-request-fit"]);
      expect(result.laneAssignments).toEqual(new Map([["lane-request-fit", "lane"]]));
    });

    it("transfers an empty lane's demand to the strongest eligible lane, including zero-quota lanes", () => {
      const result = applyDiscoveryPolicy(
        [ranked("weak-only", 100), ranked("strong-secondary", 50), ranked("strong-primary", 5)],
        {
          limit: 3,
          laneQuotas: [
            { id: "weak", requested: 3, strength: 1 },
            { id: "strong", requested: 0, strength: 3 },
          ],
          laneMatchesByCandidateId: new Map([
            ["weak-only", ["weak"]],
            ["strong-secondary", ["strong"]],
            ["strong-primary", ["strong"]],
          ]),
          laneCandidateOrderByLaneId: new Map([
            ["weak", ["weak-only"]],
            ["strong", ["strong-primary", "strong-secondary"]],
          ]),
        },
      );
      expect(result.laneAssignments).toEqual(new Map([
        ["weak-only", "weak"],
        ["strong-primary", "strong"],
        ["strong-secondary", "strong"],
      ]));
    });

    it("keeps unrelated widened tracks unassigned while preserving global exploration", () => {
      const result = applyDiscoveryPolicy(
        [
          ranked("unrelated-new", 100, { artistId: "new" }),
          ranked("lane-fit", 50, { artistId: "familiar" }),
          ranked("ordinary-fallback", 10, { artistId: "other" }),
        ],
        {
          limit: 2,
          verifiedHumanArtistIds: new Set(["new"]),
          laneQuotas: [{ id: "lane", requested: 1, strength: 1 }],
          laneMatchesByCandidateId: new Map([["lane-fit", ["lane"]]]),
          laneCandidateOrderByLaneId: new Map([["lane", ["lane-fit"]]]),
        },
      );
      expect(result.laneAssignments?.get("lane-fit")).toBe("lane");
      expect(result.laneAssignments?.has("unrelated-new")).toBe(false);
      expect(result.exploration.served).toBe(1);
      expect(result.items.find((candidate) => candidate.id === "unrelated-new")?.reasonCode).toBe("discovery_pick");
      expect(ids(result.items)).toEqual(["unrelated-new", "lane-fit"]);
    });
  });
});
