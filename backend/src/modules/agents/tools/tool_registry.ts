import { PLAYABLE_TRACK_WHERE } from "../../catalog/track-availability";
import { Injectable, Optional } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../../db/prisma";
import { calculatePrice, PricingInput } from "../../../pricing/pricing";
import { EmbeddingService } from "../../embeddings/embedding.service";
import { EmbeddingStore } from "../../embeddings/embedding.store";
import { TrackEmbeddingService, TRACK_EMBEDDABLE_WHERE } from "../../embeddings/track_embedding.service";
import { unitCentroid } from "../../embeddings/vector_centroid";
import { interleaveByShare, playlistPattern, pocketFitBonus, pocketQuota } from "../playlist_seed_pockets";
import { sanitizeArtistNames, normalizeArtistName } from "../agent_session_artists";
import {
  AI_PROMOTIONAL_ELIGIBILITY_WHERE,
  toAiDisclosureRecord,
} from "../../catalog/ai-disclosure.policy";
import { DiscoveryPopularityService } from "../../catalog/discovery-popularity.service";
import { AgentObservabilityService } from "../agent_observability.service";
import { calibratedSemanticFloor, getAgentSemanticMinSimilarity } from "../agent_runtime.config";
import { MEASURED_TEMPO_MIN_CONFIDENCE } from "../measured_track_features";
import {
  expandGenreSearchTerms,
  genreFamiliesFor,
  genreFamilyById,
  releaseGenreFamilies,
} from "../../recommendations/genre_families";
import { isLocalFileClientId } from "../../library/local_file_id";

/** Upper bound on candidates lazily embedded / ranked per tool call. */
const EMBEDDINGS_SIMILARITY_MAX_CANDIDATES = 100;

/** Artist seeds (#2241): own tracks read per artist, tracks whose vectors form the centroid, cache. */
const ARTIST_SEED_OWN_TRACKS = 8;
const ARTIST_SEED_CENTROID_TRACKS = 8;
const ARTIST_SEED_CACHE_TTL_MS = 5 * 60_000;
const ARTIST_SEED_CACHE_MAX = 100;

/**
 * Playlist seeds (#2244). A seeded session is not a replay of the playlist:
 *  - at most `PLAYLIST_SEED_OWN_TRACKS` of the playlist's own tracks (the ones
 *    nearest its centroid) are candidates in any one retrieval, and the
 *    selector drops every other playlist track from the pool (so a batch holds
 *    at most that many, whichever source found them);
 *  - the profile is read from the most recent `PLAYLIST_SEED_SAMPLE_TRACKS`
 *    tracks, so a huge playlist costs the same as a small one;
 *  - the genre mix follows the playlist's pattern (`playlist_seed_pockets.ts`):
 *    pockets of genre family, groove (energy, else tempo band) and common
 *    moods, each on at least 10% of the sampled tracks (at most five). Each
 *    pocket asks for its share of `PLAYLIST_SEED_FAMILY_CANDIDATES` and of the
 *    neighbours, ranked against the sound of the playlist's own tracks in that
 *    pocket and nudged by a shared groove or mood; the order keeps the shares.
 *    A playlist of one-offs falls back to its two most common families and its
 *    overall sound.
 */
export const PLAYLIST_SEED_OWN_TRACKS = 3;
const PLAYLIST_SEED_SAMPLE_TRACKS = 40;
const PLAYLIST_SEED_FAMILY_CANDIDATES = 30;
/** Most ids sent to a SQL NOT IN; the rest are dropped after the query. */
const PLAYLIST_SEED_SQL_EXCLUDE_MAX = 500;

/**
 * The catalog.search match for one query. Genre labels are free text, so a
 * genre query also searches the labels of its genre family ("World" reaches
 * "African", #2088). The title match stays literal. It also matches the stored
 * track descriptor's families (#2240), so "World" reaches a track whose genre
 * says "Bambara" but whose descriptor says world/african. This only READS the
 * stored descriptor: no model call on this path.
 */
function searchTermWhere(query: string): Prisma.TrackWhereInput {
  const descriptorFamilyIds = genreFamiliesFor(query).map((family) => family.id);
  return {
    OR: [
      ...expandGenreSearchTerms(query).map((term) => ({
        release: { genre: { contains: term, mode: "insensitive" as const } },
      })),
      ...(descriptorFamilyIds.length > 0
        ? [{ descriptor: { is: { families: { hasSome: descriptorFamilyIds } } } }]
        : []),
      { title: { contains: query, mode: "insensitive" as const } },
    ],
  };
}

export interface ToolInput {
  [key: string]: unknown;
}

export interface ToolOutput {
  [key: string]: unknown;
}

export interface Tool {
  name: string;
  run(input: ToolInput): Promise<ToolOutput>;
}

@Injectable()
export class ToolRegistry {
  private tools = new Map<string, Tool>();

  constructor(
    private readonly embeddingService: EmbeddingService,
    private readonly embeddingStore: EmbeddingStore,
    @Optional()
    private readonly observability?: AgentObservabilityService,
    @Optional()
    trackEmbeddings?: TrackEmbeddingService,
    // The WS-4 popularity serving tables (#2246): the trending retrieval source
    // reads them and nothing else. Absent, the source reports it is unavailable.
    @Optional()
    private readonly popularity?: DiscoveryPopularityService,
  ) {
    const trackEmbeddingService =
      trackEmbeddings ??
      new TrackEmbeddingService(this.embeddingService, this.embeddingStore);
    this.register({
      name: "catalog.search",
      run: async (input) => {
        const query = String(input.query ?? "").trim();
        const limit = Number(input.limit ?? 20);
        const explicitAllowed = Boolean(input.allowExplicit ?? false);
        const take = Math.min(Math.max(limit, 1), 50);
        // Request-first sessions pass the session's own tracks (#2316): they are
        // left out in the query itself, so the per-query budget goes to tracks
        // the session can still play.
        const excludeTrackIds = Array.isArray(input.excludeTrackIds)
          ? (input.excludeTrackIds as unknown[]).filter((id): id is string => typeof id === "string" && id.length > 0)
          : [];
        const searchWhere: Prisma.TrackWhereInput = query ? searchTermWhere(query) : {};

        const items = await this.loadCandidateTracks({
          explicitAllowed,
          take,
          extraWhere: excludeTrackIds.length > 0
            ? { AND: [searchWhere, { id: { notIn: excludeTrackIds } }] }
            : searchWhere,
        });
        if (excludeTrackIds.length === 0) return { items };

        // How many of the session's own tracks the query matches, so the caller
        // can tell "everything matching was played" from "nothing matches" (a
        // count only; the ids are the caller's own).
        const excludedMatches = await prisma.track.count({
          where: {
            ...(explicitAllowed ? {} : { explicit: false }),
            ...AI_PROMOTIONAL_ELIGIBILITY_WHERE,
            AND: [PLAYABLE_TRACK_WHERE, searchWhere, { id: { in: excludeTrackIds } }],
          },
        });
        return { items, excludedMatches };
      },
    });

    this.register({
      name: "catalog.semantic_search",
      run: async (input) => {
        const query = String(input.query ?? "").trim();
        const limit = Math.min(Math.max(Math.floor(Number(input.limit ?? 20)) || 20, 1), 50);
        const explicitAllowed = Boolean(input.allowExplicit ?? false);
        const excludeTrackIds = Array.isArray(input.excludeTrackIds)
          ? (input.excludeTrackIds as unknown[]).filter(
            (id): id is string => typeof id === "string",
          )
          : undefined;
        // "More like this" (#2243): a seed track stands in for the query text,
        // using its stored vector. No model call; the seed itself is excluded.
        const seedTrackId =
          typeof input.seedTrackId === "string" ? input.seedTrackId.trim() : "";
        // Provider disabled or failing: report it and let the caller keep its
        // keyword candidates. Never throws.
        if ((!query && !seedTrackId) || !this.embeddingService.modelId) {
          return { items: [], status: "unavailable" };
        }
        const vector = seedTrackId
          ? await this.embeddingStore.get(seedTrackId, this.embeddingService.modelId)
          : await this.embeddingService.embedQuery(query);
        if (!vector) {
          return { items: [], status: "unavailable" };
        }
        const neighbours = await trackEmbeddingService.neighboursOfVector(vector, {
          limit,
          allowExplicit: explicitAllowed,
          excludeTrackIds: seedTrackId
            ? [...(excludeTrackIds ?? []), seedTrackId]
            : excludeTrackIds,
        });
        // Hybrid retrieval asks for top-k plus a calibrated floor; every other
        // caller keeps the fixed floor.
        const floor = input.calibratedFloor === true
          ? calibratedSemanticFloor(Math.max(0, ...neighbours.map((neighbour) => neighbour.score)))
          : getAgentSemanticMinSimilarity();
        const kept = neighbours.filter((neighbour) => neighbour.score >= floor);
        if (kept.length === 0) {
          return { items: [], status: "ok" };
        }
        const rows = await this.loadCandidateTracks({
          explicitAllowed,
          take: kept.length,
          extraWhere: { id: { in: kept.map((neighbour) => neighbour.trackId) } },
        });
        const byId = new Map(rows.map((row) => [row.id, row]));
        const items = kept.flatMap((neighbour) => {
          const row = byId.get(neighbour.trackId);
          return row ? [{ ...row, semanticScore: neighbour.score }] : [];
        });
        return { items, status: "ok" };
      },
    });

    // Artist seeds (#2241): the named artists' own tracks, plus the catalog
    // neighbours of the centroid of their stored track vectors. Names are
    // matched exactly (case-insensitive) against CREDITED names, so only a real
    // catalog artist can ever seed anything. Bounded by `limit`; the centroid
    // needs stored vectors only (no embedding call), so it is skipped quietly
    // when embeddings are off.
    const artistCentroids = new Map<string, { vector: number[]; at: number }>();
    this.register({
      name: "catalog.artist_seed",
      run: async (input) => {
        const names = sanitizeArtistNames(input.artists);
        const limit = Math.min(Math.max(Math.floor(Number(input.limit ?? 20)) || 20, 1), 50);
        const explicitAllowed = Boolean(input.allowExplicit ?? false);
        const excludeTrackIds = Array.isArray(input.excludeTrackIds)
          ? (input.excludeTrackIds as unknown[]).filter((id): id is string => typeof id === "string")
          : [];
        if (names.length === 0) return { items: [], status: "ok" };

        const items: Array<Record<string, unknown>> = [];
        const seen = new Set<string>(excludeTrackIds);
        const centroidModel = this.embeddingService.modelId;
        const neighbourScores = new Map<string, { score: number; artist: string }>();

        for (const name of names) {
          const own = await this.loadCandidateTracks({
            explicitAllowed,
            take: ARTIST_SEED_OWN_TRACKS,
            extraWhere: {
              AND: [
                TRACK_EMBEDDABLE_WHERE,
                { id: { notIn: excludeTrackIds } },
                {
                  OR: [
                    { artist: { equals: name, mode: "insensitive" } },
                    { release: { primaryArtist: { equals: name, mode: "insensitive" } } },
                    {
                      release: {
                        AND: [
                          { OR: [{ primaryArtist: null }, { primaryArtist: "" }] },
                          { artist: { displayName: { equals: name, mode: "insensitive" } } },
                        ],
                      },
                    },
                  ],
                },
              ],
            },
          });
          for (const row of own) {
            if (seen.has(row.id)) continue;
            seen.add(row.id);
            items.push({ ...row, artistSeed: "own", seedArtist: name });
          }

          if (!centroidModel) continue;
          const cacheKey = `${centroidModel}\0${normalizeArtistName(name)}`;
          let centroid = artistCentroids.get(cacheKey);
          if (!centroid || Date.now() - centroid.at > ARTIST_SEED_CACHE_TTL_MS) {
            const vectors = await this.embeddingStore.getMany(
              own.slice(0, ARTIST_SEED_CENTROID_TRACKS).map((row) => row.id),
              centroidModel,
            );
            const vector = unitCentroid(vectors);
            centroid = vector ? { vector, at: Date.now() } : undefined;
            if (centroid) {
              artistCentroids.delete(cacheKey);
              artistCentroids.set(cacheKey, centroid);
              if (artistCentroids.size > ARTIST_SEED_CACHE_MAX) {
                artistCentroids.delete(artistCentroids.keys().next().value as string);
              }
            }
          }
          if (!centroid) continue;
          const neighbours = await trackEmbeddingService.neighboursOfVector(centroid.vector, {
            limit: Math.ceil(limit / names.length),
            allowExplicit: explicitAllowed,
            excludeTrackIds: [...excludeTrackIds, ...own.map((row) => row.id)],
          });
          const floor = input.calibratedFloor === true
            ? calibratedSemanticFloor(Math.max(0, ...neighbours.map((neighbour) => neighbour.score)))
            : getAgentSemanticMinSimilarity();
          for (const neighbour of neighbours) {
            if (neighbour.score < floor || seen.has(neighbour.trackId)) continue;
            const previous = neighbourScores.get(neighbour.trackId);
            if (!previous || neighbour.score > previous.score) {
              neighbourScores.set(neighbour.trackId, { score: neighbour.score, artist: name });
            }
          }
        }

        if (neighbourScores.size > 0) {
          const rows = await this.loadCandidateTracks({
            explicitAllowed,
            take: neighbourScores.size,
            extraWhere: { id: { in: [...neighbourScores.keys()] } },
          });
          const byId = new Map(rows.map((row) => [row.id, row]));
          const ordered = [...neighbourScores.entries()].sort((a, b) => b[1].score - a[1].score);
          for (const [trackId, { score, artist }] of ordered) {
            const row = byId.get(trackId);
            if (row) items.push({ ...row, artistSeed: "neighbour", seedArtist: artist, semanticScore: score });
          }
        }
        // Own tracks come first, so the cap never drops an artist's own catalog for neighbours.
        return { items: items.slice(0, limit), status: "ok" };
      },
    });

    // Playlist seeds (#2244): the neighbours of the centroid of a playlist's
    // stored track vectors, plus tracks of the playlist's genre-family mix, plus
    // at most PLAYLIST_SEED_OWN_TRACKS of the playlist's own tracks. Access is
    // checked HERE, on every call, for the caller in `userId`: only the owner's
    // playlists and public ones seed anything; any other playlist answers
    // `status: "forbidden"` with no items. Reads stored vectors and descriptors
    // only (no embedding call); it returns `playlistTrackIds` so the selector can
    // keep the playlist's other tracks out of the session's pool.
    this.register({
      name: "catalog.playlist_seed",
      run: async (input) => {
        const playlistId = typeof input.playlistId === "string" ? input.playlistId.trim() : "";
        const userId = typeof input.userId === "string" ? input.userId.trim() : "";
        const limit = Math.min(Math.max(Math.floor(Number(input.limit ?? 20)) || 20, 1), 50);
        const explicitAllowed = Boolean(input.allowExplicit ?? false);
        const excludeTrackIds = Array.isArray(input.excludeTrackIds)
          ? (input.excludeTrackIds as unknown[]).filter((id): id is string => typeof id === "string")
          : [];
        if (!playlistId) return { items: [], status: "ok" };

        const playlist = await prisma.playlist.findFirst({
          where: {
            id: playlistId,
            OR: [...(userId ? [{ userId }] : []), { visibility: "public" }],
          },
          select: { trackIds: true },
        });
        if (!playlist) return { items: [], status: "forbidden" };

        // A listener's own device files are not catalog tracks; they must not
        // take sample slots from the tracks that describe the playlist (#2507).
        const playlistTrackIds = [...new Set(playlist.trackIds)].filter((id) => !isLocalFileClientId(id));
        if (playlistTrackIds.length === 0) return { items: [], status: "ok", playlistTrackIds };
        const inPlaylist = new Set(playlistTrackIds);
        const sample = playlistTrackIds.slice(-PLAYLIST_SEED_SAMPLE_TRACKS);

        // The pattern of the sample: genre family (stored descriptor families, else the release
        // genre's), groove (measured energy, else tempo band) and release moods, as pockets.
        const sampleRows = await prisma.track.findMany({
          where: { id: { in: sample } },
          select: {
            id: true,
            release: { select: { genre: true, moods: true } },
            descriptor: { select: { families: true, energyBand: true, tempoBand: true } },
          },
        });
        const pattern = playlistPattern(sampleRows.map((row) => {
          const stored = row.descriptor?.families ?? [];
          return {
            id: row.id,
            families: stored.length > 0
              ? stored
              : releaseGenreFamilies(row.release?.genre ?? "").map((family) => family.id),
            energyBand: row.descriptor?.energyBand ?? null,
            tempoBand: row.descriptor?.tempoBand ?? null,
            moods: row.release?.moods ?? [],
          };
        }));
        // Several pockets each get their share and their own sound; otherwise the overall sound leads.
        const perPocket = pattern.proportional && pattern.pockets.length > 1;

        // The sound of the whole sample, and of each pocket's own tracks.
        const model = this.embeddingService.modelId;
        const vectors = model ? await this.embeddingStore.getManyById(sample, model) : new Map<string, number[]>();
        const centroid = unitCentroid([...vectors.values()]);
        const pocketSound = new Map<string, number[] | null>();
        for (const pocket of pattern.pockets) {
          const own = perPocket ? pocket.trackIds.flatMap((id) => (vectors.has(id) ? [vectors.get(id)!] : [])) : [];
          pocketSound.set(pocket.key, (own.length > 0 ? unitCentroid(own) : null) ?? centroid);
        }

        const excluded = new Set<string>([...excludeTrackIds, ...playlistTrackIds]);
        const sqlExclude = [...excluded].slice(0, PLAYLIST_SEED_SQL_EXCLUDE_MAX);
        const scores = new Map<string, number>();
        const origin = new Map<string, "neighbour" | "family">();
        // Which pocket found a candidate, and its fit nudge there, for the proportional order.
        const foundBy = new Map<string, string>();
        const fit = new Map<string, number>();

        // Neighbours: of each pocket's sound, else of the whole playlist.
        const neighbourQueries = perPocket
          ? pattern.pockets.map((pocket) => ({
            pocketKey: pocket.key as string | null,
            vector: pocketSound.get(pocket.key) ?? null,
            limit: pocketQuota(pocket.share, limit),
          }))
          : [{ pocketKey: null as string | null, vector: centroid, limit }];
        for (const query of neighbourQueries) {
          if (!query.vector) continue;
          const neighbours = await trackEmbeddingService.neighboursOfVector(query.vector, {
            limit: query.limit,
            allowExplicit: explicitAllowed,
            excludeTrackIds: sqlExclude,
          });
          const floor = input.calibratedFloor === true
            ? calibratedSemanticFloor(Math.max(0, ...neighbours.map((neighbour) => neighbour.score)))
            : getAgentSemanticMinSimilarity();
          for (const neighbour of neighbours) {
            if (neighbour.score < floor || excluded.has(neighbour.trackId)) continue;
            if ((scores.get(neighbour.trackId) ?? -Infinity) >= neighbour.score) continue;
            scores.set(neighbour.trackId, neighbour.score);
            origin.set(neighbour.trackId, "neighbour");
            if (query.pocketKey) foundBy.set(neighbour.trackId, query.pocketKey);
          }
        }

        // Family tracks: each pocket asks for its share of its family (in its groove when it has
        // one), ranked against its own sound.
        const pocketRows = await Promise.all(pattern.pockets.map((pocket) => {
          const genreFamily = genreFamilyById(pocket.familyId);
          const genreTerms = genreFamily ? expandGenreSearchTerms(genreFamily.label) : [];
          const groove: Prisma.TrackWhereInput[] = perPocket && pocket.groove
            ? [{
              descriptor: {
                is: pocket.groove.kind === "energy"
                  ? { energyBand: pocket.groove.band }
                  : { tempoBand: pocket.groove.band },
              },
            }]
            : [];
          return this.loadCandidateTracks({
            explicitAllowed,
            take: perPocket
              ? pocketQuota(pocket.share, PLAYLIST_SEED_FAMILY_CANDIDATES, 5)
              : Math.ceil(PLAYLIST_SEED_FAMILY_CANDIDATES / pattern.pockets.length),
            extraWhere: {
              AND: [
                TRACK_EMBEDDABLE_WHERE,
                { id: { notIn: sqlExclude } },
                {
                  OR: [
                    { descriptor: { is: { families: { has: pocket.familyId } } } },
                    ...genreTerms.map((term) => ({
                      release: { genre: { contains: term, mode: "insensitive" as const } },
                    })),
                  ],
                },
                ...groove,
              ],
            },
          });
        }));
        for (const [index, pocket] of pattern.pockets.entries()) {
          const fresh = pocketRows[index].filter((row) => !excluded.has(row.id) && !origin.has(row.id));
          const sound = pocketSound.get(pocket.key) ?? null;
          const pocketScores = sound && model
            ? await this.embeddingStore.similarity(sound, fresh.map((row) => row.id), model)
            : [];
          for (const entry of pocketScores) scores.set(entry.trackId, entry.score);
          for (const row of fresh) {
            origin.set(row.id, "family");
            foundBy.set(row.id, pocket.key);
            fit.set(row.id, pocketFitBonus(pocket, {
              energyBand: row.descriptor?.energyBand ?? null,
              tempoBand: row.descriptor?.tempoBand ?? null,
              moods: row.release?.moods ?? [],
            }));
          }
        }

        const items: Array<Record<string, unknown>> = [];
        const wanted = [...origin.keys()];
        if (wanted.length > 0) {
          const rows = await this.loadCandidateTracks({
            explicitAllowed,
            take: wanted.length,
            extraWhere: { AND: [TRACK_EMBEDDABLE_WHERE, { id: { in: wanted } }] },
          });
          const byId = new Map(rows.map((row) => [row.id, row]));
          // Scored candidates first (best first, nudged by their pocket fit); a family track
          // without a vector keeps its place after them.
          const rank = (id: string) => {
            const score = scores.get(id);
            return score === undefined ? undefined : score + (fit.get(id) ?? 0);
          };
          const ordered = wanted
            .map((id, index) => ({ id, index, score: scores.get(id), rank: rank(id) }))
            .sort((a, b) =>
              (b.rank ?? -2) !== (a.rank ?? -2) ? (b.rank ?? -2) - (a.rank ?? -2) : a.index - b.index)
            .filter((entry) => byId.has(entry.id));
          // Several pockets keep their shares in the order too, so a cut keeps the playlist's mix.
          const mixed = perPocket
            ? interleaveByShare(
              [
                ...pattern.pockets.map((pocket) => ({
                  share: pocket.share,
                  items: ordered.filter((entry) => foundBy.get(entry.id) === pocket.key),
                })),
                { share: 0, items: ordered.filter((entry) => !foundBy.has(entry.id)) },
              ],
              (entry) => entry.id,
            )
            : ordered;
          for (const entry of mixed) {
            const row = byId.get(entry.id);
            if (!row) continue;
            items.push({
              ...row,
              playlistSeed: origin.get(entry.id),
              ...(entry.score !== undefined ? { semanticScore: entry.score } : {}),
            });
          }
        }

        // The playlist's own tracks: the PLAYLIST_SEED_OWN_TRACKS nearest its sound (playlist
        // order without one), not already in the session. Several pockets take them across the
        // pockets, each nearest its own pocket's sound.
        const alreadyInSession = new Set(excludeTrackIds);
        const ownPool = playlistTrackIds.filter((id) => !alreadyInSession.has(id));
        let ownOrder = ownPool;
        const ownScores = new Map<string, number>();
        if (centroid && model && ownPool.length > 0) {
          const ranked = await this.embeddingStore.similarity(centroid, ownPool.slice(0, 100), model);
          for (const entry of ranked) ownScores.set(entry.trackId, entry.score);
          const rankedIds = ranked.map((entry) => entry.trackId);
          ownOrder = [...rankedIds, ...ownPool.filter((id) => !ownScores.has(id))];
          if (perPocket) {
            const lists: Array<{ share: number; items: string[] }> = [];
            for (const pocket of pattern.pockets) {
              const sound = pocketSound.get(pocket.key);
              const members = pocket.trackIds.filter((id) => !alreadyInSession.has(id));
              if (!sound || members.length === 0) continue;
              const nearest = await this.embeddingStore.similarity(sound, members, model);
              for (const entry of nearest) {
                ownScores.set(entry.trackId, Math.max(entry.score, ownScores.get(entry.trackId) ?? -Infinity));
              }
              lists.push({ share: pocket.share, items: nearest.map((entry) => entry.trackId) });
            }
            ownOrder = interleaveByShare([...lists, { share: 0, items: ownOrder }], (id) => id);
          }
        }
        const ownWanted = ownOrder.slice(0, PLAYLIST_SEED_OWN_TRACKS * 4);
        if (ownWanted.length > 0) {
          const rows = await this.loadCandidateTracks({
            explicitAllowed,
            take: ownWanted.length,
            extraWhere: { AND: [TRACK_EMBEDDABLE_WHERE, { id: { in: ownWanted } }] },
          });
          const byId = new Map(rows.map((row) => [row.id, row]));
          let taken = 0;
          for (const id of ownWanted) {
            const row = byId.get(id);
            if (!row || taken >= PLAYLIST_SEED_OWN_TRACKS) continue;
            taken += 1;
            const score = ownScores.get(id);
            items.push({
              ...row,
              playlistSeed: "own",
              ...(score !== undefined ? { semanticScore: score } : {}),
            });
          }
        }

        const ownItems = items.filter((item) => item.playlistSeed === "own");
        const otherItems = items.filter((item) => item.playlistSeed !== "own");
        return {
          items: [...otherItems.slice(0, Math.max(0, limit - ownItems.length)), ...ownItems],
          status: "ok",
          playlistTrackIds: [...inPlaylist],
        };
      },
    });

    // Audio-feature range retrieval (#2242): tracks whose MEASURED full-mix
    // features fit the request, so "calm" or "122 BPM" can retrieve a track no
    // tag mentions. Energy matches the stored descriptor's energy band and tempo
    // the original stem's measured BPM (confidence-gated, the same gate the
    // ranker uses); inferred values never retrieve. Reads stored values only.
    this.register({
      name: "catalog.audio_range",
      run: async (input) => {
        const limit = Math.min(Math.max(Math.floor(Number(input.limit ?? 20)) || 20, 1), 50);
        const explicitAllowed = Boolean(input.allowExplicit ?? false);
        const excludeTrackIds = Array.isArray(input.excludeTrackIds)
          ? (input.excludeTrackIds as unknown[]).filter((id): id is string => typeof id === "string")
          : [];
        const energy = input.energy === "low" || input.energy === "medium" || input.energy === "high"
          ? input.energy
          : undefined;
        const tempo = input.tempoBpm as { min?: number | null; max?: number | null } | undefined;
        const minBpm = typeof tempo?.min === "number" && Number.isFinite(tempo.min) ? tempo.min : undefined;
        const maxBpm = typeof tempo?.max === "number" && Number.isFinite(tempo.max) ? tempo.max : undefined;
        if (!energy && minBpm === undefined && maxBpm === undefined) return { items: [], status: "ok" };

        const and: Prisma.TrackWhereInput[] = [];
        if (excludeTrackIds.length > 0) and.push({ id: { notIn: excludeTrackIds } });
        if (energy) and.push({ descriptor: { is: { energyBand: energy } } });
        if (minBpm !== undefined || maxBpm !== undefined) {
          and.push({
            stems: {
              some: {
                type: "original",
                isCurrent: true,
                AND: [
                  { audioFeatures: { path: ["tempoConfidence"], gte: MEASURED_TEMPO_MIN_CONFIDENCE } },
                  ...(minBpm !== undefined ? [{ audioFeatures: { path: ["tempoBpm"], gte: minBpm } }] : []),
                  ...(maxBpm !== undefined ? [{ audioFeatures: { path: ["tempoBpm"], lte: maxBpm } }] : []),
                ],
              },
            },
          });
        }
        const items = await this.loadCandidateTracks({
          explicitAllowed,
          take: limit,
          extraWhere: { AND: and },
        });
        return { items, status: "ok" };
      },
    });

    // Trending retrieval (#2246): the tracks the serving tables rank highest in
    // the given genre families this week. Reads `TrackPopularity` through the
    // service that feeds Home's Trending rail (minimum audience and freshness
    // enforced there, no warehouse scan), then loads the tracks the way every
    // other retrieval does, so the explicit preference and the AI-promotion
    // filter apply. Ranking order is NOT carried over: the selector's ranking
    // core decides; this only says which tracks may enter the pool.
    this.register({
      name: "catalog.trending",
      run: async (input) => {
        if (!this.popularity) return { items: [], status: "unavailable" };
        const limit = Math.min(Math.max(Math.floor(Number(input.limit ?? 20)) || 20, 1), 50);
        const explicitAllowed = Boolean(input.allowExplicit ?? false);
        const terms = Array.isArray(input.families)
          ? (input.families as unknown[]).filter((term): term is string => typeof term === "string")
          : [];
        const excludeTrackIds = new Set(
          Array.isArray(input.excludeTrackIds)
            ? (input.excludeTrackIds as unknown[]).filter((id): id is string => typeof id === "string")
            : [],
        );
        if (terms.length === 0) return { items: [], status: "ok" };
        const trending = (
          await this.popularity.getTrendingForGenreTerms({ terms, window: "7d", limit: limit + excludeTrackIds.size })
        ).filter((row) => !excludeTrackIds.has(row.trackId));
        if (trending.length === 0) return { items: [], status: "ok" };
        const rows = trending.slice(0, limit);
        const loaded = await this.loadCandidateTracks({
          explicitAllowed,
          take: rows.length,
          extraWhere: { id: { in: rows.map((row) => row.trackId) } },
        });
        const byId = new Map(loaded.map((item) => [item.id, item]));
        return {
          status: "ok",
          items: rows.flatMap((row) => {
            const item = byId.get(row.trackId);
            return item ? [{ ...item, trendingFamily: row.term }] : [];
          }),
        };
      },
    });

    // How many EXPLICIT tracks match the session's requested terms (and are
    // promotion-eligible): the "explicit" part of "held back" in the request
    // coverage. A count only; no track is returned, so the explicit preference
    // is never bypassed.
    this.register({
      name: "catalog.explicit_matches",
      run: async (input) => {
        const terms = Array.isArray(input.terms)
          ? (input.terms as unknown[])
              .filter((term): term is string => typeof term === "string")
              .map((term) => term.trim())
              .filter(Boolean)
              .slice(0, 8)
          : [];
        if (terms.length === 0) return { count: 0 };
        const excludeTrackIds = Array.isArray(input.excludeTrackIds)
          ? (input.excludeTrackIds as unknown[]).filter((id): id is string => typeof id === "string")
          : [];
        const count = await prisma.track.count({
          where: {
            explicit: true,
            ...AI_PROMOTIONAL_ELIGIBILITY_WHERE,
            ...(excludeTrackIds.length > 0 ? { id: { notIn: excludeTrackIds } } : {}),
            OR: terms.flatMap((term) => searchTermWhere(term).OR ?? []),
          },
        });
        return { count };
      },
    });

    this.register({
      name: "pricing.quote",
      run: async (input) => {
        const licenseType = (input.licenseType as any) ?? "personal";
        const base: PricingInput = {
          basePlayPriceUsd: 0.02,
          remixSurchargeMultiplier: 3,
          commercialMultiplier: 5,
          volumeDiscountPercent: 5,
          floorUsd: 0.01,
          ceilingUsd: 1,
        };
        const priceUsd = calculatePrice(licenseType, base, Boolean(input.volume));
        return { priceUsd };
      },
    });

    this.register({
      name: "analytics.signal",
      run: async (input) => {
        return {
          trackId: input.trackId,
          plays: 0,
          score: 0,
        };
      },
    });

    this.register({
      name: "embeddings.similarity",
      run: async (input) => {
        const query = String(input.query ?? "");
        const candidateIds = ((input.candidates as string[]) ?? []).slice(
          0,
          EMBEDDINGS_SIMILARITY_MAX_CANDIDATES,
        );
        // Provider disabled or failing: an empty ranking tells the selector to
        // keep its deterministic order (#1452). Never throws.
        const model = this.embeddingService.modelId;
        if (!model) {
          return { ranked: [], status: "unavailable" };
        }
        const queryVector = await this.embeddingService.embedQuery(query);
        if (!queryVector) {
          return { ranked: [], status: "unavailable" };
        }
        // Lazily embed candidates that have no current vector (idempotent:
        // unchanged tracks are skipped without a model call).
        await trackEmbeddingService.embedTracks(candidateIds);
        return {
          ranked: await this.embeddingStore.similarity(
            queryVector,
            candidateIds,
            model,
          ),
          status: "ok",
        };
      },
    });
  }

  /**
   * Shared candidate loader for the AI DJ catalog tools: explicit filter, AI
   * promotional eligibility (ADR-BM-5), and the annotated result shape.
   * `hasListing` is data for the caller's own filter; it never orders, boosts
   * or demotes results (ADR-TE-2 rule 6), so the default order stays
   * newest-first exactly as queried.
   */
  private async loadCandidateTracks(options: {
    explicitAllowed: boolean;
    take: number;
    extraWhere: Prisma.TrackWhereInput;
    orderBy?: Prisma.TrackOrderByWithRelationInput;
  }) {
    const whereBase = options.explicitAllowed ? {} : { explicit: false };
    const items = await prisma.track.findMany({
      where: {
        ...whereBase,
        // Fully generated tracks remain available through direct catalog APIs,
        // but are excluded from this promotional/agent-ranking seam (ADR-BM-5).
        ...AI_PROMOTIONAL_ELIGIBILITY_WHERE,
        // Only tracks that can be played publicly right now (published release,
        // not withdrawn, not held or removed, public rights route).
        AND: [PLAYABLE_TRACK_WHERE, options.extraWhere],
      },
      include: {
        // `artistId` and `moods` feed the shared discovery policy stage
        // (exploration + diversity) and intent matching in the selector;
        // `primaryArtist` and the uploader label let it resolve the credited
        // artist the diversity cap keys on.
        release: {
          select: {
            title: true,
            genre: true,
            moods: true,
            artistId: true,
            artworkUrl: true,
            primaryArtist: true,
            artist: { select: { displayName: true } },
          },
        },
        // #2240: stored descriptor (families, sub-genres, bands); data for the
        // ranker, read-only here.
        descriptor: {
          select: {
            families: true,
            subGenres: true,
            tempoBand: true,
            energyBand: true,
            vocal: true,
          },
        },
        stems: {
          where: { isCurrent: true },
          select: {
            listings: {
              where: {
                status: "active",
                amount: { gt: 0n },
                expiresAt: { gt: new Date() },
              },
              select: { id: true },
              take: 1,
            },
          },
        },
      },
      orderBy: options.orderBy ?? { createdAt: "desc" },
      take: options.take,
    });

    return items.map((t) => {
      const hasListing = (t.stems ?? []).some((s) => s.listings.length > 0);
      const {
        stems,
        generationMetadata: _generationMetadata,
        aiDisclosureLevel: _aiDisclosureLevel,
        aiContributionFacets: _aiContributionFacets,
        aiDisclosureSource: _aiDisclosureSource,
        aiDisclosureVersion: _aiDisclosureVersion,
        aiDeclaredAt: _aiDeclaredAt,
        ...rest
      } = t;
      return {
        ...rest,
        aiDisclosure: toAiDisclosureRecord(t),
        hasListing,
      };
    });
  }

  register(tool: Tool) {
    this.tools.set(tool.name, {
      name: tool.name,
      run: async (input) => {
        const startedAt = new Date();
        try {
          const output = await tool.run(input);
          await this.observability?.traceToolCall({
            toolName: tool.name,
            input,
            output,
            startedAt,
            endedAt: new Date(),
          });
          return output;
        } catch (error) {
          await this.observability?.traceToolCall({
            toolName: tool.name,
            input,
            error,
            startedAt,
            endedAt: new Date(),
          });
          throw error;
        }
      },
    });
  }

  get(name: string) {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Tool not found: ${name}`);
    }
    return tool;
  }
}
