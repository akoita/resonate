/**
 * Seeded AI DJ sessions (#2244): the pure parts. No database. The playlist
 * source's access check and retrieval are covered against Postgres in
 * `agent_dj_seeded_sessions.integration.spec.ts`.
 */
import { Logger } from "@nestjs/common";
import { HYBRID_RETRIEVAL_VARIANT } from "../modules/agents/agent_hybrid_retrieval";
import { sameSessionFilters, sessionFilterSummary } from "../modules/agents/agent_session_filters";
import {
  parseSessionSeedShape,
  rememberedSessionSeed,
  selectorSeedsFor,
  sessionSeedFilter,
} from "../modules/agents/agent_session_seed";
import { AgentSelectorService } from "../modules/agents/agent_selector.service";
import { deterministicSelectorInput } from "../modules/agents/deterministic_recommendation.adapter";
import { DiscoveryRankingService } from "../modules/recommendations/discovery-ranking.service";

describe("session seed helpers", () => {
  it("accepts a known kind with a bounded id and trims the label", () => {
    expect(parseSessionSeedShape({ kind: "playlist", id: " p1 ", label: "  Late night  " })).toEqual({
      kind: "playlist",
      id: "p1",
      label: "Late night",
    });
    expect(parseSessionSeedShape({ kind: "track", id: "t1" })).toEqual({ kind: "track", id: "t1", label: "" });
    expect(parseSessionSeedShape({ kind: "artist", id: "a1", label: "x".repeat(300) })?.label).toHaveLength(120);
  });

  it.each([
    null,
    undefined,
    "playlist:p1",
    [],
    { kind: "album", id: "x" },
    { kind: "playlist" },
    { kind: "playlist", id: "" },
    { kind: "playlist", id: "   " },
    { kind: "playlist", id: 7 },
    { kind: "playlist", id: "p".repeat(101) },
  ])("rejects %j", (raw) => {
    expect(parseSessionSeedShape(raw)).toBeUndefined();
    expect(rememberedSessionSeed(raw)).toBeUndefined();
  });

  it("maps each kind to the selector's seeds", () => {
    expect(selectorSeedsFor({ kind: "track", id: "t1", label: "A Song" })).toEqual({ trackIds: ["t1"] });
    expect(selectorSeedsFor({ kind: "playlist", id: "p1", label: "Mine" })).toEqual({ playlistId: "p1" });
    expect(selectorSeedsFor({ kind: "artist", id: "a1", label: "Nadia Okoro" })).toEqual({ artists: ["Nadia Okoro"] });
    expect(selectorSeedsFor(undefined)).toBeUndefined();
  });

  it("keeps only the kind and label for Session History, never the id", () => {
    expect(sessionSeedFilter({ kind: "playlist", label: "Late night" })).toEqual({ kind: "playlist", label: "Late night" });
    expect(sessionSeedFilter({ kind: "playlist", label: "   " })).toBeUndefined();
    expect(sessionSeedFilter({ kind: "nope", label: "x" })).toBeUndefined();
    expect(sessionSeedFilter(undefined)).toBeUndefined();
    const summary = sessionFilterSummary({
      seed: { kind: "playlist", id: "private-playlist-id", label: "Late night" } as never,
      allowExplicit: false,
    });
    expect(summary.seed).toEqual({ kind: "playlist", label: "Late night" });
    expect(JSON.stringify(summary)).not.toContain("private-playlist-id");
    // A change of seed is a change of the stored summary.
    expect(sameSessionFilters(summary, sessionFilterSummary({ allowExplicit: false }))).toBe(false);
    expect(sessionFilterSummary({ allowExplicit: false })).not.toHaveProperty("seed");
  });

  it("builds the selector request from the session's remembered seed, alongside a sentence's artists", () => {
    const base = { userId: "u1", recentTrackIds: [], limit: 5 };
    const input = deterministicSelectorInput({
      ...base,
      preferences: {
        artists: ["Sentence Artist"],
        seed: { kind: "playlist", id: "p1", label: "Mine" },
      },
    });
    expect(input.seeds).toEqual({ playlistId: "p1" });
    expect(input.seedArtists).toEqual(["Sentence Artist"]);
    expect(deterministicSelectorInput({ ...base, preferences: {} })).not.toHaveProperty("seeds");
  });
});

// ---------------------------------------------------------------------------
// The selector's playlist seed: the cap on the playlist's own tracks
// ---------------------------------------------------------------------------

type Item = {
  id: string;
  title: string;
  hasListing: boolean;
  semanticScore?: number;
  playlistSeed?: string;
  release: { genre: string; title: string; moods: string[]; artistId: string };
};

function item(id: string, extra: Partial<Item> = {}): Item {
  return {
    id,
    title: id,
    hasListing: false,
    release: { genre: "Soul", title: `${id} release`, moods: [], artistId: `artist-${id}` },
    ...extra,
  };
}

function build(playlist: { items: Item[]; playlistTrackIds?: string[]; status?: string }, keyword: Item[] = []) {
  const playlistSeed = jest.fn(async () => ({ status: "ok", ...playlist }));
  const runs: Record<string, jest.Mock> = {
    "catalog.search": jest.fn(async () => ({ items: keyword })),
    "catalog.playlist_seed": playlistSeed,
  };
  const registry = {
    get: jest.fn((name: string) => ({
      run: runs[name] ?? jest.fn().mockResolvedValue({ items: [], status: "unavailable" }),
    })),
  };
  return {
    selector: new AgentSelectorService(registry as any, new DiscoveryRankingService()),
    playlistSeed,
  };
}

describe.each([
  ["legacy retrieval", {}],
  ["hybrid retrieval", { retrievalVariant: HYBRID_RETRIEVAL_VARIANT }],
])("AgentSelectorService playlist seed (%s)", (_name, variant) => {
  afterEach(() => jest.restoreAllMocks());

  it("asks the playlist source for the caller's playlist and adds its candidates", async () => {
    const { selector, playlistSeed } = build({
      items: [
        item("n1", { playlistSeed: "neighbour", semanticScore: 0.9 }),
        item("f1", { playlistSeed: "family" }),
        item("o1", { playlistSeed: "own", semanticScore: 0.95 }),
      ],
      playlistTrackIds: ["o1", "p2"],
    });
    const result = await selector.select({
      userId: "listener-1",
      queries: [],
      recentTrackIds: ["played"],
      seeds: { playlistId: "pl-1" },
      allowExplicit: false,
      limit: 10,
      ...variant,
    });
    expect(playlistSeed).toHaveBeenCalledWith(
      expect.objectContaining({
        playlistId: "pl-1",
        userId: "listener-1",
        allowExplicit: false,
        excludeTrackIds: ["played"],
      }),
    );
    expect([...result.candidates].sort()).toEqual(["f1", "n1", "o1"]);
  });

  it("drops every other track of the playlist from the pool, whichever source found it", async () => {
    const { selector } = build(
      {
        items: [item("n1", { playlistSeed: "neighbour", semanticScore: 0.9 }), item("o1", { playlistSeed: "own" })],
        playlistTrackIds: ["o1", "p2", "p3"],
      },
      // The keyword source also finds p2 and p3 (they are Soul too).
      [item("p2"), item("p3"), item("k1")],
    );
    const result = await selector.select({
      userId: "listener-1",
      queries: ["Soul"],
      recentTrackIds: [],
      seeds: { playlistId: "pl-1" },
      limit: 10,
      ...variant,
    });
    expect(result.candidates).not.toContain("p2");
    expect(result.candidates).not.toContain("p3");
    expect([...result.candidates].sort()).toEqual(["k1", "n1", "o1"]);
  });

  it("seeds nothing and fails open when the playlist is not accessible or the source fails", async () => {
    jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    const forbidden = build({ items: [], status: "forbidden" }, [item("k1")]);
    const blocked = await forbidden.selector.select({
      userId: "listener-1",
      queries: ["Soul"],
      recentTrackIds: [],
      seeds: { playlistId: "someone-elses" },
      ...variant,
    });
    expect(blocked.candidates).toEqual(["k1"]);

    const failing = build({ items: [] }, [item("k1")]);
    failing.playlistSeed.mockRejectedValue(new Error("db down"));
    const failed = await failing.selector.select({
      userId: "listener-1",
      queries: ["Soul"],
      recentTrackIds: [],
      seeds: { playlistId: "pl-1" },
      ...variant,
    });
    expect(failed.candidates).toEqual(["k1"]);
  });
});
