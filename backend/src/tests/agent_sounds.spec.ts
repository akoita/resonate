import {
  familyTasteWeights,
  getAgentSoundsCacheTtlMs,
  getAgentSoundsMinTracks,
  soundsForListener,
  tallyCatalogSounds,
  type SoundsTrackRow,
} from "../modules/agents/agent_sounds";

function row(genre: string | null, options: Partial<SoundsTrackRow> = {}): SoundsTrackRow {
  return { explicit: false, genre, descriptorFamilies: null, ...options };
}

function repeat(count: number, make: (index: number) => SoundsTrackRow): SoundsTrackRow[] {
  return Array.from({ length: count }, (_, index) => make(index));
}

const find = (aggregate: ReturnType<typeof tallyCatalogSounds>, id: string) =>
  aggregate.families.find((family) => family.id === id)!;

describe("tallyCatalogSounds (#2249)", () => {
  it("counts a track toward every family its genre belongs to", () => {
    const aggregate = tallyCatalogSounds([row("Afrobeats"), row("French Rap")]);
    expect(find(aggregate, "afrobeats").total).toBe(1);
    expect(find(aggregate, "world").total).toBe(1);
    expect(find(aggregate, "hip-hop").total).toBe(1);
    expect(find(aggregate, "jazz").total).toBe(0);
  });

  it("counts a descriptor-only match", () => {
    const aggregate = tallyCatalogSounds([row("Bambara", { descriptorFamilies: ["world", "african"] })]);
    expect(find(aggregate, "world").total).toBe(1);
    expect(find(aggregate, "african").total).toBe(1);
    expect(find(aggregate, "pop").total).toBe(0);
  });

  it("keeps counts with and without explicit tracks", () => {
    const aggregate = tallyCatalogSounds([row("Rap"), row("Rap", { explicit: true }), row("Trap", { explicit: true })]);
    expect(find(aggregate, "hip-hop")).toMatchObject({ total: 3, clean: 1 });
  });

  it("returns every family, even with no tracks", () => {
    const aggregate = tallyCatalogSounds([]);
    expect(aggregate.families.length).toBeGreaterThan(10);
    expect(aggregate.families.every((family) => family.total === 0 && family.clean === 0)).toBe(true);
  });
});

describe("soundsForListener (#2249)", () => {
  const aggregate = tallyCatalogSounds([
    ...repeat(8, () => row("Hip-Hop")),
    ...repeat(5, () => row("Jazz")),
    ...repeat(2, () => row("Rock")),
    ...repeat(4, () => row("Pop", { explicit: true })),
  ]);

  it("omits families below the minimum playable-track threshold", () => {
    const sounds = soundsForListener(aggregate, { allowExplicit: true, minTracks: 3 });
    expect(sounds.minTracks).toBe(3);
    expect(sounds.families.map((family) => family.id)).not.toContain("rock");
    expect(sounds.families.every((family) => family.count >= 3)).toBe(true);
  });

  it("applies the explicit preference to the count and the threshold", () => {
    const withExplicit = soundsForListener(aggregate, { allowExplicit: true, minTracks: 3 });
    const without = soundsForListener(aggregate, { allowExplicit: false, minTracks: 3 });
    expect(withExplicit.families.find((family) => family.id === "pop")?.count).toBe(4);
    expect(without.families.map((family) => family.id)).not.toContain("pop");
  });

  it("orders by catalog size when the listener has no taste", () => {
    const sounds = soundsForListener(aggregate, { allowExplicit: true, minTracks: 3 });
    expect(sounds.families.map((family) => family.id)).toEqual(["hip-hop", "jazz", "pop"]);
  });

  it("orders by the listener's taste ahead of catalog size", () => {
    const sounds = soundsForListener(aggregate, {
      allowExplicit: true,
      minTracks: 3,
      genreWeights: { jazz: 4, Pop: 1, "Hip-Hop": -2 },
    });
    expect(sounds.families.map((family) => family.id)).toEqual(["jazz", "pop", "hip-hop"]);
  });

  it("names the family the listener's taste favours most, never one only the catalog favours (#2249)", () => {
    const withTaste = soundsForListener(aggregate, {
      allowExplicit: true,
      minTracks: 3,
      genreWeights: { jazz: 4, Pop: 1 },
    });
    expect(withTaste.topFamilyId).toBe("jazz");
    // No taste at all: the biggest family leads the row but is not the listener's top family.
    expect(soundsForListener(aggregate, { allowExplicit: true, minTracks: 3 }).topFamilyId).toBeUndefined();
    // Taste only for a family the catalog cannot fill (Rock has 2 tracks): no top family.
    const unfillable = soundsForListener(aggregate, { allowExplicit: true, minTracks: 3, genreWeights: { Rock: 9 } });
    expect(unfillable.topFamilyId).toBeUndefined();
    // A negative weight is not taste.
    expect(
      soundsForListener(aggregate, { allowExplicit: true, minTracks: 3, genreWeights: { Jazz: -3 } }).topFamilyId,
    ).toBeUndefined();
  });

  it("breaks ties by label so the order is stable", () => {
    const tied = tallyCatalogSounds([
      ...repeat(3, () => row("Jazz")),
      ...repeat(3, () => row("Pop")),
    ]);
    const sounds = soundsForListener(tied, { allowExplicit: true, minTracks: 3 });
    expect(sounds.families.map((family) => family.label)).toEqual(["Jazz", "Pop"]);
  });
});

describe("familyTasteWeights", () => {
  it("adds positive genre weights to every family the genre belongs to and ignores the rest", () => {
    const taste = familyTasteWeights({ Afrobeats: 2, Jazz: -1, Unknownish: 5 });
    expect(taste.get("afrobeats")).toBe(2);
    expect(taste.get("world")).toBe(2);
    expect(taste.has("jazz")).toBe(false);
  });

  it("is empty without a profile", () => {
    expect(familyTasteWeights(null).size).toBe(0);
  });
});

describe("Sounds configuration", () => {
  const originalMin = process.env.AGENT_SOUNDS_MIN_TRACKS;
  const originalTtl = process.env.AGENT_SOUNDS_CACHE_TTL_MS;
  afterEach(() => {
    if (originalMin === undefined) delete process.env.AGENT_SOUNDS_MIN_TRACKS;
    else process.env.AGENT_SOUNDS_MIN_TRACKS = originalMin;
    if (originalTtl === undefined) delete process.env.AGENT_SOUNDS_CACHE_TTL_MS;
    else process.env.AGENT_SOUNDS_CACHE_TTL_MS = originalTtl;
  });

  it("defaults the minimum to 3 and the cache to 10 minutes", () => {
    delete process.env.AGENT_SOUNDS_MIN_TRACKS;
    delete process.env.AGENT_SOUNDS_CACHE_TTL_MS;
    expect(getAgentSoundsMinTracks()).toBe(3);
    expect(getAgentSoundsCacheTtlMs()).toBe(600_000);
  });

  it("reads overrides and ignores garbage", () => {
    process.env.AGENT_SOUNDS_MIN_TRACKS = "7";
    expect(getAgentSoundsMinTracks()).toBe(7);
    process.env.AGENT_SOUNDS_MIN_TRACKS = "nope";
    expect(getAgentSoundsMinTracks()).toBe(3);
    process.env.AGENT_SOUNDS_MIN_TRACKS = "0";
    expect(getAgentSoundsMinTracks()).toBe(1);
  });
});
