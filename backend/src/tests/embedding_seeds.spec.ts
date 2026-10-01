/**
 * Embedding seed selection and candidate-source wiring for Home (#2003, #2006)
 * — pure unit tests. Prisma-touching paths live in
 * home_embedding_candidates.integration.spec.ts.
 */
import {
  collectEmbeddingNeighbours,
  NoteNeighbourSource,
  SeedNeighbourSource,
} from "../modules/recommendations/embedding_candidates";
import {
  EMBEDDING_SEED_LIMIT,
  EmbeddingSeedSignal,
  selectEmbeddingSeeds,
} from "../modules/recommendations/embedding_seeds";
import {
  buildPolicy,
  TasteMemoryPolicy,
  TasteMemorySettingsDto,
  TasteSignalControlDto,
} from "../modules/recommendations/taste_memory.service";

const settings: TasteMemorySettingsDto = {
  socialMatchingEnabled: false,
  citySceneDiscoveryEnabled: false,
  agentPlaybackTrainingEnabled: true,
  recommendationExplanationPreference: "balanced",
  resetAt: null,
};

let nextId = 0;
function control(
  signalType: TasteSignalControlDto["signalType"],
  value: string,
  action: TasteSignalControlDto["action"],
): TasteSignalControlDto {
  nextId += 1;
  return {
    id: `c${nextId}`,
    signalType,
    value,
    action,
    source: null,
    createdAt: "2026-09-01T00:00:00.000Z",
  };
}

function policyWith(
  controls: TasteSignalControlDto[] = [],
  resetAt: string | null = null,
): TasteMemoryPolicy {
  return buildPolicy({ ...settings, resetAt }, controls);
}

const DAY = 24 * 60 * 60 * 1000;
const base = Date.UTC(2026, 8, 20);
const at = (days: number) => new Date(base + days * DAY);

function signal(
  trackId: string,
  days: number,
  overrides: Partial<EmbeddingSeedSignal> = {},
): EmbeddingSeedSignal {
  return {
    trackId,
    action: "save",
    createdAt: at(days),
    genre: "Lofi",
    moods: ["chill"],
    artistNames: ["Quiet Fox"],
    ...overrides,
  };
}

const complete = (ratio: number | undefined) => ({
  action: "complete",
  metadata: ratio === undefined ? {} : { outcome: { completionRatio: ratio } },
});

const select = (
  signals: EmbeddingSeedSignal[],
  context: Partial<Parameters<typeof selectEmbeddingSeeds>[1]> = {},
) =>
  selectEmbeddingSeeds(signals, {
    policy: policyWith(),
    agentPlaybackAllowed: true,
    ...context,
  });

describe("selectEmbeddingSeeds", () => {
  it("takes the newest positive signals, one seed per track, up to three", () => {
    const seeds = select([
      signal("t1", 1),
      signal("t2", 5),
      signal("t3", 3),
      signal("t2", 6, { action: "add_to_playlist" }),
      signal("t4", 4),
      signal("t5", 2),
    ]);
    expect(seeds).toEqual(["t2", "t4", "t3"]);
    expect(seeds).toHaveLength(EMBEDDING_SEED_LIMIT);
  });

  it("counts saves and finished plays, but not skips, short plays or bare accepts", () => {
    const seeds = select([
      signal("saved", 1),
      signal("finished", 2, complete(0.95)),
      signal("short", 3, complete(0.4)),
      signal("no-ratio", 4, complete(undefined)),
      signal("skipped", 5, { action: "skip" }),
      signal("accepted", 6, { action: "accept" }),
    ]);
    expect(seeds).toEqual(["finished", "saved"]);
  });

  it("drops seeds whose genre, mood or artist is hidden or downranked", () => {
    const policy = policyWith([
      control("genre", "Drill", "hidden"),
      control("mood", "Dark", "downranked"),
      control("artist", "Loud Band", "hidden"),
    ]);
    const seeds = select(
      [
        signal("drill", 1, { genre: "drill" }),
        signal("dark", 2, { moods: ["Dark"] }),
        signal("loud", 3, { artistNames: [null, "loud band"] }),
        signal("fine", 4),
      ],
      { policy },
    );
    expect(seeds).toEqual(["fine"]);
  });

  it("keeps a boosted genre as a valid seed", () => {
    const policy = policyWith([control("genre", "Lofi", "boosted")]);
    expect(select([signal("t1", 1)], { policy })).toEqual(["t1"]);
  });

  it("ignores signals at or before the taste-memory reset marker", () => {
    const policy = policyWith([], at(3).toISOString());
    const seeds = select(
      [signal("before", 1), signal("at", 3), signal("after", 4)],
      { policy },
    );
    expect(seeds).toEqual(["after"]);
  });

  it("ignores agent-originated signals when agent playback training is off", () => {
    const signals = [
      signal("dj", 3, { metadata: { source: "agent_session" } }),
      signal("dj-flag", 2, { metadata: { agentOriginated: true } }),
      signal("own", 1, { metadata: { source: "player" } }),
    ];
    expect(select(signals, { agentPlaybackAllowed: false })).toEqual(["own"]);
    expect(select(signals, { agentPlaybackAllowed: true })).toEqual([
      "dj",
      "dj-flag",
      "own",
    ]);
  });

  it("returns no seeds without signals", () => {
    expect(select([])).toEqual([]);
  });
});

function trackSource(
  neighbours: Record<string, string[]>,
  enabled = true,
): SeedNeighbourSource & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    isEnabled: () => enabled,
    embeddingNeighbours: async (seed, options) => {
      calls.push(`${seed}:${options.limit}:${options.allowExplicit}`);
      return (neighbours[seed] ?? []).map((trackId) => ({ trackId }));
    },
  };
}

function noteSource(lists: string[][], enabled = true): NoteNeighbourSource {
  return {
    isEnabled: () => enabled,
    notesNeighbours: async () =>
      lists.map((list) => list.map((trackId) => ({ trackId }))),
  };
}

describe("collectEmbeddingNeighbours", () => {
  const input = { userId: "u1", seedTrackIds: ["s1", "s2"], allowExplicit: false };

  it("attributes neighbours to their seed kind, deduped across sources", async () => {
    const found = await collectEmbeddingNeighbours(
      {
        tracks: trackSource({ s1: ["a", "b"], s2: ["b", "c"] }),
        notes: noteSource([["c", "d"], ["e"]]),
      },
      input,
    );
    expect([...found.entries()]).toEqual([
      ["a", ["seed_track"]],
      ["b", ["seed_track"]],
      ["c", ["seed_track", "listener_note"]],
      ["d", ["listener_note"]],
      ["e", ["listener_note"]],
    ]);
  });

  it("asks for ten neighbours per seed and passes the explicit setting", async () => {
    const tracks = trackSource({});
    await collectEmbeddingNeighbours({ tracks }, { ...input, allowExplicit: true });
    expect(tracks.calls).toEqual(["s1:10:true", "s2:10:true"]);
  });

  it("is empty when the provider is disabled, with no model or store calls", async () => {
    const tracks = trackSource({ s1: ["a"] }, false);
    const notes = noteSource([["b"]], false);
    const spy = jest.spyOn(notes, "notesNeighbours");
    const found = await collectEmbeddingNeighbours({ tracks, notes }, input);
    expect(found.size).toBe(0);
    expect(tracks.calls).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  it("is empty when the sources are absent", async () => {
    expect((await collectEmbeddingNeighbours({}, input)).size).toBe(0);
  });

  it("makes no seed lookups without seeds, but still reads notes", async () => {
    const tracks = trackSource({ s1: ["a"] });
    const found = await collectEmbeddingNeighbours(
      { tracks, notes: noteSource([["n"]]) },
      { ...input, seedTrackIds: [] },
    );
    expect(tracks.calls).toEqual([]);
    expect([...found.keys()]).toEqual(["n"]);
  });

  it("fails open: one failing source never removes the other", async () => {
    const failingTracks: SeedNeighbourSource = {
      isEnabled: () => true,
      embeddingNeighbours: async () => {
        throw new Error("boom");
      },
    };
    const failingNotes: NoteNeighbourSource = {
      isEnabled: () => true,
      notesNeighbours: async () => {
        throw new Error("boom");
      },
    };
    const onlyNotes = await collectEmbeddingNeighbours(
      { tracks: failingTracks, notes: noteSource([["n"]]) },
      input,
    );
    expect([...onlyNotes.keys()]).toEqual(["n"]);
    const onlyTracks = await collectEmbeddingNeighbours(
      { tracks: trackSource({ s1: ["a"] }), notes: failingNotes },
      input,
    );
    expect([...onlyTracks.keys()]).toEqual(["a"]);
  });
});
