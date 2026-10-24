/**
 * The Discovery control of an AI DJ session (#2327), pure unit tests: how many exploration
 * slots each step reserves, and that the request-first tiers (#2316) are respected at every step.
 */
import {
  applyDiscoveryPolicy,
  DISCOVERY_LEVELS,
  DISCOVERY_POLICY_DEFAULTS,
  explorationShareFor,
  isDiscoveryLevel,
  NEW_EXPLORATION_SHARE,
} from "../modules/recommendations/discovery-policy";
import type { RankedDiscoveryCandidate } from "../modules/recommendations/discovery-ranking.service";
import type { RequestTier } from "../modules/agents/agent_session_request";

type Ranked = RankedDiscoveryCandidate;

function ranked(id: string, score: number, extra: Partial<Ranked> = {}): Ranked {
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

/** Twelve candidates in score order: six by familiar artists, six by verified artists never played. */
function page(): Ranked[] {
  const familiar = Array.from({ length: 6 }, (_, index) => ranked(`familiar-${index}`, 100 - index, { artistId: `fam-${index}` }));
  const fresh = Array.from({ length: 6 }, (_, index) => ranked(`fresh-${index}`, 50 - index, { artistId: `new-${index}` }));
  return [...familiar, ...fresh];
}

const verified = new Set(Array.from({ length: 6 }, (_, index) => `new-${index}`));
const played = new Set(Array.from({ length: 6 }, (_, index) => `fam-${index}`));
const context = { verifiedHumanArtistIds: verified, playedArtistIds: played };
const discoveryPicks = (items: Ranked[]) => items.filter((item) => item.reasonCode === "discovery_pick").map((item) => item.id);

describe("Discovery levels (#2327)", () => {
  it("has exactly three steps, and Mixed is today's share", () => {
    expect([...DISCOVERY_LEVELS]).toEqual(["familiar", "mixed", "new"]);
    expect(explorationShareFor("mixed")).toBe(DISCOVERY_POLICY_DEFAULTS.explorationShare);
    expect(explorationShareFor(undefined)).toBe(DISCOVERY_POLICY_DEFAULTS.explorationShare);
    expect(explorationShareFor("wild")).toBe(DISCOVERY_POLICY_DEFAULTS.explorationShare);
    expect(explorationShareFor("familiar")).toBe(0);
    expect(explorationShareFor("new")).toBe(NEW_EXPLORATION_SHARE);
    expect(NEW_EXPLORATION_SHARE).toBeGreaterThan(DISCOVERY_POLICY_DEFAULTS.explorationShare);
  });

  it("recognises only the three steps", () => {
    for (const level of DISCOVERY_LEVELS) expect(isDiscoveryLevel(level)).toBe(true);
    for (const other of ["Mixed", "wild", "", undefined, null, 1, ["new"]]) expect(isDiscoveryLevel(other)).toBe(false);
  });
});

describe("exploration slots per Discovery level (#2327)", () => {
  const run = (level: string | undefined, extra: Record<string, unknown> = {}) =>
    applyDiscoveryPolicy(page(), {
      limit: 12,
      ...context,
      ...(level ? { explorationShare: explorationShareFor(level) } : {}),
      ...extra,
    });

  it("Mixed (and no control at all) reserves 2 of 12, as before", () => {
    for (const level of ["mixed", undefined]) {
      const result = run(level);
      expect(result.exploration).toEqual({ reserved: 2, served: 2 });
      expect(discoveryPicks(result.items)).toEqual(["fresh-0", "fresh-1"]);
    }
  });

  it("Familiar reserves no slot and labels no pick, at any page size", () => {
    for (const limit of [1, 3, 5, 12]) {
      const result = applyDiscoveryPolicy(page(), { limit, ...context, explorationShare: explorationShareFor("familiar") });
      expect([limit, result.exploration]).toEqual([limit, { reserved: 0, served: 0 }]);
      expect(discoveryPicks(result.items)).toEqual([]);
    }
    // The batch is the best fit by score.
    expect(run("familiar").items.slice(0, 6).map((item) => item.id)).toEqual(
      ["familiar-0", "familiar-1", "familiar-2", "familiar-3", "familiar-4", "familiar-5"],
    );
  });

  it("Familiar reserves nothing in session mode either, even when the session is behind", () => {
    const result = applyDiscoveryPolicy(page(), {
      limit: 5,
      ...context,
      explorationShare: explorationShareFor("familiar"),
      priorSessionArtistKeys: ["name:a", "name:b", "name:c"],
      priorExplorationCount: 0,
    });
    expect(result.exploration).toEqual({ reserved: 0, served: 0 });
    expect(discoveryPicks(result.items)).toEqual([]);
  });

  it("New reserves more than Mixed: 5 of 12, best taste fit first", () => {
    const result = run("new");
    expect(result.exploration).toEqual({ reserved: 5, served: 5 });
    expect(discoveryPicks(result.items)).toEqual(["fresh-0", "fresh-1", "fresh-2", "fresh-3", "fresh-4"]);
    expect(result.exploration.served).toBeGreaterThan(run("mixed").exploration.served);
  });

  it("New serves only as many as the catalog can offer, never an unverified or played artist", () => {
    const pool = [
      ...Array.from({ length: 4 }, (_, index) => ranked(`familiar-${index}`, 90 - index, { artistId: `fam-${index}` })),
      ranked("unverified", 80, { artistId: "unv" }),
      ranked("fresh-0", 40, { artistId: "new-0" }),
    ];
    const result = applyDiscoveryPolicy(pool, { limit: 6, ...context, explorationShare: explorationShareFor("new") });
    expect(result.exploration.reserved).toBe(2);
    expect(result.exploration.served).toBe(1);
    expect(discoveryPicks(result.items)).toEqual(["fresh-0"]);
  });

  it("New paces itself across a session instead of catching up in a burst", () => {
    const result = applyDiscoveryPolicy(page(), {
      limit: 5,
      ...context,
      explorationShare: explorationShareFor("new"),
      priorSessionArtistKeys: ["name:a", "name:b", "name:c", "name:d", "name:e"],
      priorExplorationCount: 0,
    });
    // 40% of 5 per page = 2 slots at most per call.
    expect(result.exploration.reserved).toBe(2);
  });

  it("New keeps the diversity cap and the hidden-taste rule", () => {
    const sameArtist = [
      ranked("a", 60, { artistId: "new-0" }),
      ranked("b", 59, { artistId: "new-0" }),
      ranked("c", 58, { artistId: "new-0" }),
      ranked("d", 57, { artistId: "new-1" }),
    ];
    const result = applyDiscoveryPolicy(sameArtist, { limit: 4, ...context, explorationShare: explorationShareFor("new") });
    expect(result.items.filter((item) => item.artistId === "new-0")).toHaveLength(2);
  });
});

describe("Discovery stays inside the request (#2316)", () => {
  const tiers = (entries: Record<string, RequestTier>) => new Map(Object.entries(entries));

  /** Familiar artists on the request (A), fresh artists on the request (A, B) and off the request (C, higher score). */
  function requestPage(): { items: Ranked[]; tierById: Map<string, RequestTier> } {
    const items = [
      ranked("off-fresh-0", 200, { artistId: "new-0" }),
      ranked("off-fresh-1", 190, { artistId: "new-1" }),
      ranked("on-familiar-0", 100, { artistId: "fam-0" }),
      ranked("on-familiar-1", 99, { artistId: "fam-1" }),
      ranked("on-familiar-2", 98, { artistId: "fam-2" }),
      ranked("on-familiar-3", 97, { artistId: "fam-3" }),
      ranked("on-fresh-a", 40, { artistId: "new-2" }),
      ranked("soft-fresh-b", 30, { artistId: "new-3" }),
      ranked("on-familiar-4", 20, { artistId: "fam-4" }),
      ranked("on-familiar-5", 19, { artistId: "fam-5" }),
    ];
    const tierById = tiers({
      "off-fresh-0": "C",
      "off-fresh-1": "C",
      "on-fresh-a": "A",
      "soft-fresh-b": "B",
      "on-familiar-0": "A",
      "on-familiar-1": "A",
      "on-familiar-2": "A",
      "on-familiar-3": "A",
      "on-familiar-4": "A",
      "on-familiar-5": "A",
    });
    return { items, tierById };
  }

  for (const level of DISCOVERY_LEVELS) {
    it(`${level}: exploration slots never go to a track outside the request, even with padding allowed`, () => {
      const { items, tierById } = requestPage();
      for (const allowOffRequest of [false, true]) {
        const result = applyDiscoveryPolicy(items, {
          limit: 10,
          ...context,
          explorationShare: explorationShareFor(level),
          requestFirst: { tierById, allowOffRequest },
        });
        const picks = discoveryPicks(result.items);
        expect([level, allowOffRequest, picks.filter((id) => id.startsWith("off-"))]).toEqual([level, allowOffRequest, []]);
      }
    });
  }

  it("New fills its slots from the request's own fresh tracks, tier A before B", () => {
    const { items, tierById } = requestPage();
    const result = applyDiscoveryPolicy(items, {
      limit: 10,
      ...context,
      explorationShare: explorationShareFor("new"),
      requestFirst: { tierById, allowOffRequest: false },
    });
    expect(discoveryPicks(result.items)).toEqual(["on-fresh-a", "soft-fresh-b"]);
    // The batch itself is still tier first: nothing off the request is in it.
    expect(result.items.map((item) => item.id)).not.toContain("off-fresh-0");
  });

  it("Familiar keeps the request-first order and labels nothing", () => {
    const { items, tierById } = requestPage();
    const result = applyDiscoveryPolicy(items, {
      limit: 10,
      ...context,
      explorationShare: explorationShareFor("familiar"),
      requestFirst: { tierById, allowOffRequest: false },
    });
    expect(discoveryPicks(result.items)).toEqual([]);
    expect(result.items.map((item) => item.id)).toEqual([
      "on-familiar-0",
      "on-familiar-1",
      "on-familiar-2",
      "on-familiar-3",
      "on-fresh-a",
      "on-familiar-4",
      "on-familiar-5",
      "soft-fresh-b",
    ]);
  });

  it("New with no fresh track on the request has nothing to explore with and does not reach for an off-request one", () => {
    const { items, tierById } = requestPage();
    const onlyOffFresh = items.filter((item) => !item.id.includes("fresh") || item.id.startsWith("off-"));
    const result = applyDiscoveryPolicy(onlyOffFresh, {
      limit: 10,
      ...context,
      explorationShare: explorationShareFor("new"),
      requestFirst: { tierById, allowOffRequest: true },
    });
    expect(result.exploration.reserved).toBeGreaterThan(0);
    expect(result.exploration.served).toBe(0);
    expect(discoveryPicks(result.items)).toEqual([]);
  });

  it("the model's order is kept on the LLM path: only allowed candidates take a slot", () => {
    const { items } = requestPage();
    const result = applyDiscoveryPolicy(items, {
      limit: 10,
      ...context,
      explorationShare: explorationShareFor("new"),
      explorationAllowedIds: new Set(["on-fresh-a"]),
    });
    expect(discoveryPicks(result.items)).toEqual(["on-fresh-a"]);
  });
});
