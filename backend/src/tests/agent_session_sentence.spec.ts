/**
 * #2241: the sentence in the semantic query, artist seeds in the selector, and
 * the query-vector cache. Pure unit tests: tools and providers are stubs.
 */
import { AgentSelectorService } from "../modules/agents/agent_selector.service";
import {
  buildSemanticSessionQuery,
  deterministicSelectorInput,
} from "../modules/agents/deterministic_recommendation.adapter";
import { EmbeddingService } from "../modules/embeddings/embedding.service";
import { DiscoveryRankingService } from "../modules/recommendations/discovery-ranking.service";

const item = (id: string, genre: string, extra: Record<string, unknown> = {}) => ({
  id,
  title: id,
  hasListing: false,
  release: { genre, title: `${id} release`, moods: [] as string[], artistId: `artist-${id}` },
  ...extra,
});

describe("semantic session query with the sentence", () => {
  it("is built from the sentence alone, bounded, without doubled punctuation", () => {
    expect(buildSemanticSessionQuery({ requestText: "slow music for cooking!" } as any)).toBe(
      "Listener request: slow music for cooking.",
    );
    const long = buildSemanticSessionQuery({ requestText: "x".repeat(900) } as any) as string;
    expect(long.length).toBeLessThanOrEqual("Listener request: ".length + 501);
  });

  it("joins the chips and is identical on every pick", () => {
    const preferences = { requestText: "cooking", sessionGenres: ["Jazz"], mood: "Warm", genres: [] } as any;
    expect(buildSemanticSessionQuery(preferences)).toContain("Listener request: cooking");
    expect(buildSemanticSessionQuery(preferences)).toContain("Genres: Jazz");
    expect(buildSemanticSessionQuery({ ...preferences })).toBe(buildSemanticSessionQuery(preferences));
  });

  it("stays undefined with nothing the session asked for itself", () => {
    expect(buildSemanticSessionQuery({ requestText: "   ", genres: ["House"] } as any)).toBeUndefined();
  });

  it("passes the named artists to the selector", () => {
    const input = deterministicSelectorInput({
      userId: "u",
      recentTrackIds: [],
      limit: 5,
      preferences: { artists: ["Nadia Okoro"], requestText: "like Nadia Okoro" } as any,
    });
    expect(input.seedArtists).toEqual(["Nadia Okoro"]);
    expect(deterministicSelectorInput({ userId: "u", recentTrackIds: [], limit: 5, preferences: {} as any }))
      .not.toHaveProperty("seedArtists");
  });
});

describe("AgentSelectorService artist seeds", () => {
  function selectorWith(seed: (input: any) => Promise<any>) {
    const seedRun = jest.fn(seed);
    const tools = {
      get: jest.fn((name: string) => {
        if (name === "catalog.artist_seed") return { run: seedRun };
        if (name === "catalog.search") return { run: jest.fn(async () => ({ items: [item("new", "Zzyzx")] })) };
        return { run: jest.fn().mockResolvedValue({ ranked: [], items: [], status: "unavailable" }) };
      }),
    };
    return { selector: new AgentSelectorService(tools as any, new DiscoveryRankingService()), seedRun };
  }

  it("adds the artist's own tracks above unrelated newest tracks and asks for a bounded seed", async () => {
    const { selector, seedRun } = selectorWith(async () => ({
      items: [
        item("own", "Neo Soul", { artistSeed: "own", seedArtist: "Nadia Okoro" }),
        item("near", "Neo Soul", { artistSeed: "neighbour", seedArtist: "Nadia Okoro", semanticScore: 0.6 }),
      ],
    }));
    const result = await selector.select({
      recentTrackIds: ["played"],
      queries: [],
      seedArtists: ["Nadia Okoro"],
      allowExplicit: false,
    });
    expect(seedRun).toHaveBeenCalledWith({
      artists: ["Nadia Okoro"],
      limit: 20,
      allowExplicit: false,
      excludeTrackIds: ["played"],
    });
    expect(result.candidates.slice(0, 2)).toEqual(["own", "near"]);
  });

  it("fails open and skips fully AI-generated seeds", async () => {
    const { selector } = selectorWith(async () => {
      throw new Error("boom");
    });
    expect((await selector.select({ recentTrackIds: [], queries: [], seedArtists: ["X"] })).candidates).toEqual(["new"]);
    const ai = selectorWith(async () => ({
      items: [item("ai", "Pop", { artistSeed: "own", aiDisclosureLevel: "ALL" })],
    }));
    expect((await ai.selector.select({ recentTrackIds: [], queries: [], seedArtists: ["X"] })).candidates).toEqual(["new"]);
  });

  it("does not call the seed tool without artists", async () => {
    const { selector, seedRun } = selectorWith(async () => ({ items: [] }));
    await selector.select({ recentTrackIds: [], queries: [] });
    expect(seedRun).not.toHaveBeenCalled();
  });
});

describe("EmbeddingService query-vector cache", () => {
  const original = process.env.TRACK_EMBEDDING_PROVIDER;
  afterEach(() => {
    if (original === undefined) delete process.env.TRACK_EMBEDDING_PROVIDER;
    else process.env.TRACK_EMBEDDING_PROVIDER = original;
  });

  it("calls the provider once for a repeated query, and again for another", async () => {
    process.env.TRACK_EMBEDDING_PROVIDER = "hash";
    const service = new EmbeddingService();
    const embed = jest.spyOn(service as any, "embed");
    const a = await service.embedQuery("slow music for cooking");
    const b = await service.embedQuery("slow music for cooking");
    expect(b).toBe(a);
    expect(embed).toHaveBeenCalledTimes(1);
    await service.embedQuery("something else");
    expect(embed).toHaveBeenCalledTimes(2);
  });

  it("does not remember a failure, and does nothing when disabled", async () => {
    process.env.TRACK_EMBEDDING_PROVIDER = "hash";
    const service = new EmbeddingService();
    const embed = jest.spyOn(service as any, "embed").mockResolvedValueOnce(null);
    expect(await service.embedQuery("q")).toBeNull();
    expect(await service.embedQuery("q")).not.toBeNull();
    expect(embed).toHaveBeenCalledTimes(2);
    process.env.TRACK_EMBEDDING_PROVIDER = "disabled";
    expect(await service.embedQuery("q2")).toBeNull();
  });
});
