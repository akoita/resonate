import { EMBEDDING_NEIGHBOURS_PER_SEED } from "./embedding_seeds";

/**
 * Where an embedding-sourced Home candidate came from (#2003). Categorical
 * only: it names the kind of seed, never the seed track or the note text.
 */
export type EmbeddingCandidateSource = "seed_track" | "listener_note";

/** The slice of `TrackEmbeddingService` the Home candidate source reads. */
export interface SeedNeighbourSource {
  isEnabled(): boolean;
  embeddingNeighbours(
    seedTrackId: string,
    options: { limit?: number; allowExplicit?: boolean },
  ): Promise<Array<{ trackId: string }>>;
}

/** The slice of `TasteNoteEmbeddingService` the Home candidate source reads. */
export interface NoteNeighbourSource {
  isEnabled(): boolean;
  notesNeighbours(
    userId: string,
    options: { perNoteLimit?: number; allowExplicit?: boolean },
  ): Promise<Array<Array<{ trackId: string }>>>;
}

/**
 * Track ids reached by embedding search, each with the kinds of seed that
 * reached it, in first-reached order. Bounded by construction: at most
 * `seedTrackIds.length` x 10 seed neighbours plus 2 notes x 10.
 *
 * Stored vectors only, and every failure degrades to "no neighbours": Home must
 * rank without this source exactly as it did before it existed. With the
 * provider disabled, or no seeds and no notes with vectors, the map is empty.
 */
export async function collectEmbeddingNeighbours(
  sources: { tracks?: SeedNeighbourSource; notes?: NoteNeighbourSource },
  input: { userId: string; seedTrackIds: string[]; allowExplicit: boolean },
): Promise<Map<string, EmbeddingCandidateSource[]>> {
  const found = new Map<string, EmbeddingCandidateSource[]>();
  const add = (trackId: string, source: EmbeddingCandidateSource) => {
    const kinds = found.get(trackId) ?? [];
    if (!kinds.includes(source)) kinds.push(source);
    found.set(trackId, kinds);
  };

  const [seedLists, noteLists] = await Promise.all([
    sources.tracks?.isEnabled() && input.seedTrackIds.length > 0
      ? Promise.all(
          input.seedTrackIds.map((seed) =>
            sources.tracks!
              .embeddingNeighbours(seed, {
                limit: EMBEDDING_NEIGHBOURS_PER_SEED,
                allowExplicit: input.allowExplicit,
              })
              .catch(() => []),
          ),
        )
      : Promise.resolve([]),
    sources.notes?.isEnabled()
      ? sources.notes
          .notesNeighbours(input.userId, {
            perNoteLimit: EMBEDDING_NEIGHBOURS_PER_SEED,
            allowExplicit: input.allowExplicit,
          })
          .catch(() => [])
      : Promise.resolve([]),
  ]);

  for (const list of seedLists) {
    for (const { trackId } of list) add(trackId, "seed_track");
  }
  for (const list of noteLists) {
    for (const { trackId } of list) add(trackId, "listener_note");
  }
  return found;
}
