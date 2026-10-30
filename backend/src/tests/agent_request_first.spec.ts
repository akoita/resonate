/**
 * Request-first selection (#2316): the pure pieces. The request decides which
 * tracks are eligible (tiers A, B, C), taste only orders inside a tier, the
 * per-artist cap yields before a short batch, and padding is explicit. The
 * end-to-end behaviour over a catalog is in the golden set
 * (agent_golden_eval.spec.ts and its Postgres twin).
 */
import {
  buildAgentRecommendationQueries,
  deterministicSelectorInput,
  tasteQueriesFor,
} from "../modules/agents/deterministic_recommendation.adapter";
import { expandAgentTasteQueries } from "../modules/agents/agent_taste_expansion";
import {
  constrainsCatalog,
  effectiveEnergyBand,
  keepItemsOnRequest,
  pickMatchesRequest,
  requestScopeFor,
  requestTierOf,
  TEMPO_CONTRADICTION_BPM,
  withoutSeedEvidence,
  type AgentRequestCoveragePick,
} from "../modules/agents/agent_session_request";
import {
  applyDiscoveryPolicy,
  discoveryArtistKey,
} from "../modules/recommendations/discovery-policy";
import {
  DiscoveryRankingService,
  PLAYED_TRACK_DEMOTION,
  RankedDiscoveryCandidate,
} from "../modules/recommendations/discovery-ranking.service";

const pick = (overrides: Partial<AgentRequestCoveragePick> = {}): AgentRequestCoveragePick => ({
  genre: "Rap",
  moods: [],
  tempoMeasured: false,
  ...overrides,
});

describe("requestScopeFor (#2316)", () => {
  it("has no scope without a request: a plain session and My Mix keep the taste-driven path", () => {
    expect(requestScopeFor(undefined)).toBeUndefined();
    expect(requestScopeFor({})).toBeUndefined();
    expect(requestScopeFor({ sessionGenres: [] })).toBeUndefined();
    expect(requestScopeFor({ sessionGenres: ["Rap"], myMix: { lanes: [] } })).toBeUndefined();
  });

  it("gates the catalog when a genre or a seed is named, and only then", () => {
    expect(requestScopeFor({ sessionGenres: ["Rap"] })).toMatchObject({ gated: true, seeded: false, fillSimilar: false });
    expect(requestScopeFor({ artists: ["Nadia Okoro"] })).toMatchObject({ gated: true, seeded: true });
    expect(requestScopeFor({ seedTrackId: "t1" })).toMatchObject({ gated: true, seeded: true });
    expect(requestScopeFor({ seed: { kind: "playlist", id: "p1", label: "Mine" } })).toMatchObject({ gated: true });
    // Mood, energy and tempo ask for every genre: nothing to gate the genre on (they soft-gate instead).
    expect(requestScopeFor({ mood: "Focus", energy: "low" })).toMatchObject({ gated: false, softGated: true });
    expect(requestScopeFor({ requestText: "something for cooking" })).toMatchObject({ gated: false });
  });

  it("builds one effective request from presets, the picker and the described session", () => {
    const scope = requestScopeFor({
      sessionGenres: ["Rap"],
      mood: "Dark",
      request: { genres: ["Trap"], moods: ["Dark", "Moody"], energy: "high", bpm: { min: 120, max: 125 } },
    });
    expect(scope?.request).toEqual({
      genres: ["Rap", "Trap"],
      moods: ["Dark", "Moody"],
      energy: "high",
      bpm: { min: 120, max: 125 },
    });
  });

  it("allows padding only with an explicit true", () => {
    expect(requestScopeFor({ sessionGenres: ["Rap"], fillSimilar: true })?.fillSimilar).toBe(true);
    expect(requestScopeFor({ sessionGenres: ["Rap"], fillSimilar: "yes" })?.fillSimilar).toBe(false);
  });
});

describe("requestTierOf (#2316)", () => {
  const scope = requestScopeFor({ sessionGenres: ["Rap"], energy: "high" })!;

  it("is A when every filter matches, B when only a soft filter is missed, C outside the genre", () => {
    expect(requestTierOf(scope, pick({ energyBand: "high" }))).toBe("A");
    expect(requestTierOf(scope, pick({ energyBand: "medium" }))).toBe("B");
    expect(requestTierOf(scope, pick({ genre: "Pop", energyBand: "high" }))).toBe("C");
  });

  it("is C for an on-genre pick that contradicts a soft filter", () => {
    expect(requestTierOf(scope, pick({ energyBand: "low" }))).toBe("C");
  });

  it("keeps a generic Pop or Dance Pop release out of an Afro-Pop request (#2453)", () => {
    const afro = requestScopeFor({ sessionGenres: ["Afrobeat", "Afro-Pop", "Amapiano"] })!;
    expect(requestTierOf(afro, pick({ genre: "Afro-Pop" }))).toBe("A");
    expect(requestTierOf(afro, pick({ genre: "Amapiano" }))).toBe("A");
    expect(requestTierOf(afro, pick({ genre: "Dance Pop" }))).toBe("C");
    expect(requestTierOf(afro, pick({ genre: "Pop" }))).toBe("C");
    // Dance Pop is still on-request for Pop Hits, through the pop family.
    const pop = requestScopeFor({ sessionGenres: ["Pop", "Synthpop"] })!;
    expect(requestTierOf(pop, pick({ genre: "Dance Pop" }))).toBe("A");
    expect(requestTierOf(pop, pick({ genre: "Techno" }))).toBe("C");
    expect(requestTierOf(pop, pick({ genre: "Deep House" }))).toBe("C");
  });

  it("reads a genre through the stored descriptor families too", () => {
    const world = requestScopeFor({ sessionGenres: ["World"] })!;
    expect(requestTierOf(world, pick({ genre: "Senegal", descriptorFamilies: ["world"] }))).toBe("A");
    expect(requestTierOf(world, pick({ genre: "Senegal" }))).toBe("C");
  });

  it("counts a seed as the request: a seed hit is on it, anything else is not", () => {
    const seeded = requestScopeFor({ artists: ["Nadia Okoro"] })!;
    expect(requestTierOf(seeded, pick({ genre: "Neo Soul", seedMatched: true }))).toBe("A");
    expect(requestTierOf(seeded, pick({ genre: "Neo Soul", seedMatched: false }))).toBe("C");
    // A path with no seed evidence (an LLM pick) is only gated by a genre.
    expect(requestTierOf(withoutSeedEvidence(seeded), pick({ genre: "Neo Soul" }))).toBe("A");
  });

  it("never produces C for a request that sets no filter and names no genre or seed", () => {
    const sentence = requestScopeFor({ requestText: "something for cooking" })!;
    expect(sentence.gated).toBe(false);
    expect(sentence.softGated).toBe(false);
    expect(requestTierOf(sentence, pick({ genre: "Pop", moods: ["Dark"], energyBand: "high", tempoBpm: 200, tempoMeasured: true }))).toBe("A");
  });
});

describe("soft-gated requests: mood, energy or tempo with no genre or seed", () => {
  it("marks exactly the requests with a soft filter and no genre or seed", () => {
    expect(requestScopeFor({ mood: "Zen", energy: "low" })).toMatchObject({ gated: false, softGated: true });
    expect(requestScopeFor({ energy: "high" })).toMatchObject({ softGated: true });
    expect(requestScopeFor({ tempoBpm: { min: 120, max: 125 } })).toMatchObject({ softGated: true });
    expect(requestScopeFor({ sessionGenres: ["Rap"], energy: "high" })).toMatchObject({ gated: true, softGated: false });
    expect(requestScopeFor({ artists: ["Nadia Okoro"], energy: "high" })).toMatchObject({ gated: true, softGated: false });
    expect(requestScopeFor({ requestText: "cooking" })).toMatchObject({ gated: false, softGated: false });
    expect(constrainsCatalog(requestScopeFor({ mood: "Zen" }))).toBe(true);
    expect(constrainsCatalog(requestScopeFor({ sessionGenres: ["Rap"] }))).toBe(true);
    expect(constrainsCatalog(requestScopeFor({ requestText: "cooking" }))).toBe(false);
    expect(constrainsCatalog(undefined)).toBe(false);
  });

  it("withoutSeedEvidence turns a seed-only scope with soft filters into a soft-gated one", () => {
    const seeded = requestScopeFor({ artists: ["Nadia Okoro"], energy: "low" })!;
    expect(withoutSeedEvidence(seeded)).toMatchObject({ gated: false, softGated: true });
    expect(withoutSeedEvidence(requestScopeFor({ artists: ["Nadia Okoro"] })!)).toMatchObject({ gated: false, softGated: false });
    const soft = requestScopeFor({ energy: "low" })!;
    expect(withoutSeedEvidence(soft)).toMatchObject({ gated: false, softGated: true });
    expect(withoutSeedEvidence(requestScopeFor({ sessionGenres: ["Rap"], energy: "low" })!)).toMatchObject({ gated: true, softGated: false });
  });

  describe("energy", () => {
    const zen = requestScopeFor({ energy: "low" })!;
    it("A on the same band, C on the opposite band, C on a miss with no match", () => {
      expect(requestTierOf(zen, pick({ energyBand: "low" }))).toBe("A");
      expect(requestTierOf(zen, pick({ energyBand: "high" }))).toBe("C");
      expect(requestTierOf(zen, pick({ energyBand: "medium" }))).toBe("C");
      expect(requestTierOf(zen, pick({}))).toBe("C");
    });
    it("a medium request never contradicts", () => {
      const medium = requestScopeFor({ energy: "medium" })!;
      expect(requestTierOf(medium, pick({ energyBand: "medium" }))).toBe("A");
      expect(requestTierOf(medium, pick({ energyBand: "high" }))).toBe("C");
      expect(requestTierOf(medium, pick({ energyBand: "low" }))).toBe("C");
    });
  });

  describe("tempo", () => {
    const range = requestScopeFor({ tempoBpm: { min: 120, max: 125 } })!;
    it("matches a measured tempo in the range, contradicts one more than 15 BPM outside it", () => {
      expect(requestTierOf(range, pick({ tempoBpm: 122, tempoMeasured: true }))).toBe("A");
      expect(requestTierOf(range, pick({ tempoBpm: 125 + TEMPO_CONTRADICTION_BPM, tempoMeasured: true }))).toBe("C");
      expect(requestTierOf(range, pick({ tempoBpm: 120 - TEMPO_CONTRADICTION_BPM - 1, tempoMeasured: true }))).toBe("C");
    });
    it("a near miss or an unmeasured tempo is no match, and no match is outside a soft-gated request", () => {
      expect(requestTierOf(range, pick({ tempoBpm: 135, tempoMeasured: true }))).toBe("C");
      expect(requestTierOf(range, pick({ tempoBpm: 200, tempoMeasured: false }))).toBe("C");
    });
    it("an open side only contradicts on the bounded side", () => {
      const under = requestScopeFor({ tempoBpm: { min: null, max: 100 } })!;
      expect(requestTierOf(under, pick({ tempoBpm: 60, tempoMeasured: true }))).toBe("A");
      expect(requestTierOf(under, pick({ tempoBpm: 140, tempoMeasured: true }))).toBe("C");
    });
  });

  describe("mood", () => {
    const zen = requestScopeFor({ mood: "Zen" })!;
    it("matches a requested mood; other or missing moods never contradict but have no match", () => {
      expect(requestTierOf(zen, pick({ moods: ["zen", "Calm"] }))).toBe("A");
      expect(requestTierOf(zen, pick({ moods: ["Aggressive"] }))).toBe("C");
      expect(requestTierOf(zen, pick({ moods: [] }))).toBe("C");
    });
  });

  describe("several soft filters", () => {
    const zen = requestScopeFor({ mood: "Zen", energy: "low" })!;
    it("A when all match, B when some match, C when none match or any contradicts", () => {
      expect(requestTierOf(zen, pick({ moods: ["Zen"], energyBand: "low" }))).toBe("A");
      expect(requestTierOf(zen, pick({ moods: ["Zen"], energyBand: "medium" }))).toBe("B");
      expect(requestTierOf(zen, pick({ moods: [], energyBand: "low" }))).toBe("B");
      expect(requestTierOf(zen, pick({ moods: ["Zen"], energyBand: "high" }))).toBe("C");
      expect(requestTierOf(zen, pick({ moods: ["Dark"], energyBand: "medium" }))).toBe("C");
    });
  });

  describe("gated scopes (genre or seed) with a soft filter", () => {
    it("a miss is B and a contradiction is C; the genre gate still comes first", () => {
      const rap = requestScopeFor({ sessionGenres: ["Rap"], mood: "Dark", energy: "low" })!;
      expect(requestTierOf(rap, pick({ moods: ["Dark"], energyBand: "low" }))).toBe("A");
      expect(requestTierOf(rap, pick({ moods: ["Happy"], energyBand: "medium" }))).toBe("B");
      expect(requestTierOf(rap, pick({ moods: ["Dark"], energyBand: "high" }))).toBe("C");
      expect(requestTierOf(rap, pick({ genre: "Pop", moods: ["Dark"], energyBand: "low" }))).toBe("C");
      const seeded = requestScopeFor({ artists: ["Nadia Okoro"], energy: "low" })!;
      expect(requestTierOf(seeded, pick({ genre: "Neo Soul", seedMatched: true, energyBand: "high" }))).toBe("C");
      expect(requestTierOf(seeded, pick({ genre: "Neo Soul", seedMatched: true, energyBand: "medium" }))).toBe("B");
    });
  });

  it("coverage counts a soft predicate as a match only on the same outcome the tier reads", () => {
    const scope = requestScopeFor({ mood: "Zen", energy: "low" })!;
    const picks = [pick({ moods: ["Zen"], energyBand: "low" }), pick({ moods: ["Zen"], energyBand: "high" })];
    expect(pickMatchesRequest(scope.request, picks[0])).toBe(true);
    expect(pickMatchesRequest(scope.request, picks[1])).toBe(false);
  });
});

describe("effectiveEnergyBand", () => {
  it("prefers a measured feature band, then the descriptor band, then the inferred feature band", () => {
    expect(effectiveEnergyBand({ energyBand: "high", featureSources: { energy: "measured" } }, "low")).toBe("high");
    expect(effectiveEnergyBand({ energyBand: "high", featureSources: { energy: "inferred" } }, "low")).toBe("low");
    expect(effectiveEnergyBand({ energyBand: "high", featureSources: { energy: "inferred" } }, null)).toBe("high");
    expect(effectiveEnergyBand({ energyBand: "high" }, undefined)).toBe("high");
    expect(effectiveEnergyBand(undefined, "medium")).toBe("medium");
    expect(effectiveEnergyBand(undefined, undefined)).toBeUndefined();
    // A measured source without a band falls through to the descriptor.
    expect(effectiveEnergyBand({ featureSources: { energy: "measured" } }, "low")).toBe("low");
  });
});

describe("keepItemsOnRequest (what a model may see, #2316)", () => {
  const items = [
    { id: "rap", release: { genre: "French Rap" } },
    { id: "pop", release: { genre: "Pop" } },
    { id: "african", release: { genre: "African" }, descriptor: { families: ["world"] } },
  ];

  it("keeps only items of the requested genre unless similar sounds are allowed", () => {
    expect(keepItemsOnRequest(items, requestScopeFor({ sessionGenres: ["Rap"] })).map((i) => i.id)).toEqual(["rap"]);
    expect(keepItemsOnRequest(items, requestScopeFor({ sessionGenres: ["World"] })).map((i) => i.id)).toEqual(["african"]);
    expect(keepItemsOnRequest(items, requestScopeFor({ sessionGenres: ["Rap"], fillSimilar: true }))).toHaveLength(3);
    expect(keepItemsOnRequest(items, undefined)).toHaveLength(3);
  });
});

describe("queries: the request is searched, taste is not (#2316)", () => {
  const preferences = {
    genres: ["Pop", "Lo-fi", "Rap"],
    sessionGenres: ["Rap"],
    mood: "Dark",
    learnedGenreWeights: { Pop: 5 },
  };

  it("searches the session's own genres and moods only; learned favourites and saved vibes are taste", () => {
    expect(buildAgentRecommendationQueries(preferences)).toEqual(["Rap", "Dark"]);
    expect(tasteQueriesFor(preferences)).toEqual(["Pop", "Lo-fi"]);
    const input = deterministicSelectorInput({ userId: "u", recentTrackIds: [], preferences, limit: 12 });
    expect(input.queries).toEqual(["Rap", "Dark"]);
    expect(input.tasteQueries).toEqual(["Pop", "Lo-fi"]);
    expect(input.requestScope?.gated).toBe(true);
  });

  it("keeps today's queries for a session without a request, and for one that names only mood or energy", () => {
    expect(buildAgentRecommendationQueries({ genres: ["Pop", "Lo-fi"] })).toEqual(["Pop", "Lo-fi"]);
    expect(buildAgentRecommendationQueries({ genres: ["Pop"], mood: "Focus", energy: "low" })).toEqual(["Pop", "Focus"]);
    expect(tasteQueriesFor({ genres: ["Pop"], mood: "Focus" })).toEqual([]);
    expect(deterministicSelectorInput({ userId: "u", recentTrackIds: [], preferences: { genres: ["Pop"] }, limit: 5 }))
      .not.toHaveProperty("requestScope");
  });
});

describe("taste expansion reads a hyphen as a space (#2316)", () => {
  it("expands Hip-Hop like Hip Hop", () => {
    const expected = expandAgentTasteQueries(["Hip Hop"]);
    expect(expected).toContain("rap");
    expect(expandAgentTasteQueries(["Hip-Hop"])).toEqual(expect.arrayContaining(["rap", "trap", "drill"]));
    expect(expandAgentTasteQueries(["Deep-House"])).toContain("house");
  });

  it("still matches entries that keep their hyphen", () => {
    expect(expandAgentTasteQueries(["Lo-fi"])).toContain("chillhop");
  });
});

type Ranked = RankedDiscoveryCandidate;
const ranked = (id: string, score: number, extra: Partial<Ranked> = {}): Ranked => ({
  id,
  title: id,
  score,
  signals: [],
  explanation: ["Selected vibe match"],
  reasonCode: "taste_match",
  recentlyPlayed: false,
  ...extra,
});
const withArtist = (name: string | null) => ({ artistId: "uploader", release: { creditedArtistName: name } });

describe("discovery policy, request-first (#2316)", () => {
  const ids = (items: Ranked[]) => items.map((item) => item.id);

  it("chooses tier first, score second, and leaves tier C out unless padding is allowed", () => {
    const candidates = [
      ranked("c-high", 90),
      ranked("b-mid", 50),
      ranked("a-low", 10),
      ranked("a-high", 30),
    ];
    const tierById = new Map([["c-high", "C" as const], ["b-mid", "B" as const], ["a-low", "A" as const], ["a-high", "A" as const]]);

    const strict = applyDiscoveryPolicy(candidates, { limit: 4, requestFirst: { tierById, allowOffRequest: false } });
    expect(ids(strict.items)).toEqual(["a-low", "a-high", "b-mid"]);

    const padded = applyDiscoveryPolicy(candidates, { limit: 4, requestFirst: { tierById, allowOffRequest: true } });
    expect(ids(padded.items)).toEqual(["a-low", "a-high", "b-mid", "c-high"]);
  });

  it("relaxes the per-artist cap for matching tracks before it settles for a short batch, and reports it", () => {
    const sameArtist = (id: string, score: number) => ranked(id, score, withArtist("Fabolous"));
    const result = applyDiscoveryPolicy(
      [sameArtist("f1", 40), sameArtist("f2", 39), sameArtist("f3", 38), ranked("o1", 5, withArtist("Other"))],
      { limit: 12, requestFirst: { tierById: new Map(), allowOffRequest: false } },
    );
    expect(ids(result.items)).toEqual(["f1", "f2", "f3", "o1"]);
    expect(result.capRelaxed).toMatchObject({ artists: 1, top: { tracks: 3 } });
    expect(result.capRelaxedIds).toEqual(new Set(["f3"]));
  });

  it("keeps the cap when the batch is already full, and reports what it held back", () => {
    const sameArtist = (id: string, score: number) => ranked(id, score, withArtist("Fabolous"));
    const result = applyDiscoveryPolicy(
      [sameArtist("f1", 40), sameArtist("f2", 39), sameArtist("f3", 38), ranked("o1", 5, withArtist("Other"))],
      { limit: 3, requestFirst: { tierById: new Map(), allowOffRequest: false } },
    );
    expect(ids(result.items)).toEqual(["f1", "f2", "o1"]);
    expect(result.capRelaxed).toBeUndefined();
    expect(result.heldBackForVariety).toEqual(["f3"]);
  });

  it("relaxes the cap for A and B before it pads with C", () => {
    const sameArtist = (id: string, score: number) => ranked(id, score, withArtist("Fabolous"));
    const tierById = new Map([["f3", "A" as const], ["pad", "C" as const]]);
    const result = applyDiscoveryPolicy(
      [sameArtist("f1", 40), sameArtist("f2", 39), sameArtist("f3", 38), ranked("pad", 80, withArtist("Pop Act"))],
      { limit: 4, requestFirst: { tierById, allowOffRequest: true } },
    );
    expect(ids(result.items)).toEqual(["f1", "f2", "f3", "pad"]);
  });

  it("gives exploration slots only to tracks of the request", () => {
    const verified = new Set(["pop-artist", "rap-artist"]);
    const candidates = [
      ranked("pop", 90, { artistId: "pop-artist" }),
      ranked("rap", 20, { artistId: "rap-artist" }),
      ranked("rap-2", 10, { artistId: "rap-artist-2" }),
    ];
    const tierById = new Map([["pop", "C" as const], ["rap", "A" as const], ["rap-2", "A" as const]]);
    const result = applyDiscoveryPolicy(candidates, {
      limit: 3,
      verifiedHumanArtistIds: verified,
      requestFirst: { tierById, allowOffRequest: true },
    });
    const discovery = result.items.filter((item) => item.reasonCode === "discovery_pick").map((item) => item.id);
    expect(discovery).toEqual(["rap"]);
  });

  it("can restrict exploration without reordering (the LLM path keeps the model's order)", () => {
    const result = applyDiscoveryPolicy(
      [ranked("pop", 90, { artistId: "pop-artist" }), ranked("rap", 20, { artistId: "rap-artist" })],
      {
        limit: 2,
        verifiedHumanArtistIds: new Set(["pop-artist", "rap-artist"]),
        explorationAllowedIds: new Set(["rap"]),
      },
    );
    expect(ids(result.items)).toEqual(["pop", "rap"]);
    expect(result.items.filter((item) => item.reasonCode === "discovery_pick").map((item) => item.id)).toEqual(["rap"]);
  });

  it("is exactly the established policy without requestFirst", () => {
    const sameArtist = (id: string, score: number) => ranked(id, score, withArtist("Fabolous"));
    const result = applyDiscoveryPolicy([sameArtist("f1", 40), sameArtist("f2", 39), sameArtist("f3", 38)], { limit: 12 });
    expect(ids(result.items)).toEqual(["f1", "f2"]);
    expect(result.capRelaxed).toBeUndefined();
  });
});

describe("cap identity (#2316)", () => {
  it("keys on the credited performer, and an uncredited track stands alone, never as its uploader", () => {
    const base = { id: "t1", artistId: "uploader", artist: null };
    expect(discoveryArtistKey({ ...base, release: { artistDisplayName: "Uploader Co", creditedArtistName: "Fabolous" } }))
      .toBe(discoveryArtistKey({ ...base, id: "t2", release: { artistDisplayName: "Other Co", creditedArtistName: "FABOLOUS (ft. Drake)" } }));
    expect(discoveryArtistKey({ ...base, release: { artistDisplayName: "Uploader Co", creditedArtistName: null } })).toBe("track:t1");
    expect(discoveryArtistKey({ ...base, id: "t2", release: { artistDisplayName: "Uploader Co", creditedArtistName: null } })).toBe("track:t2");
  });

  it("keeps the established key when a caller (Home) does not name the performer", () => {
    expect(discoveryArtistKey({ id: "t1", artistId: "uploader", artist: null, release: { artistDisplayName: "Uploader Co" } }))
      .toBe("name:uploader co");
    expect(discoveryArtistKey({ id: "t1", artistId: "uploader", artist: null })).toBe("id:uploader");
  });
});

describe("ranking: played tracks step down gently, Home is unchanged (#2316)", () => {
  const ranking = new DiscoveryRankingService();
  const candidate = (id: string) => ({ id, title: id, matchedQueries: ["Rap"], release: { genre: "Rap" } });
  const context = { originalQueries: ["Rap"], expandedQueries: ["Rap"] };

  it("takes one small step for a played track and keeps it eligible", async () => {
    const [fresh, played] = [
      (await ranking.rank([candidate("a")], context))[0],
      (await ranking.rank([candidate("a")], { ...context, playedTrackIds: ["a"] }))[0],
    ];
    expect(fresh.score - played.score).toBe(PLAYED_TRACK_DEMOTION);
    expect(played.score).toBeGreaterThan(0);
    expect(played.recentlyPlayed).toBe(true);
  });

  it("still buries a session duplicate, exactly as Home and the plain DJ do", async () => {
    const [duplicate] = await ranking.rank([candidate("a")], { ...context, recentTrackIds: ["a"] });
    expect(duplicate.score).toBe(0);
    expect(duplicate.signals.find((signal) => signal.label === "recently_played")?.weight).toBe(-100);
  });

  it("ranks a Home call (no played-track context) as before, whatever the request-first fields are", async () => {
    const home = await ranking.rank([candidate("a"), candidate("b")], { ...context, recentTrackIds: ["b"] });
    expect(home.map((entry) => [entry.id, entry.score])).toEqual([["a", 40], ["b", 0]]);
    expect(home.every((entry) => entry.signals.every((signal) => signal.weight !== -PLAYED_TRACK_DEMOTION))).toBe(true);
  });
});
