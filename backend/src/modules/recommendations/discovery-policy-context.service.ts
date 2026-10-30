import { Injectable } from "@nestjs/common";
import { prisma } from "../../db/prisma";
import { resolveCreditedArtistName, resolveCreditedArtistNames } from "../shared/artist_attribution";
import { deriveCreatorVerificationStates } from "../trust/verification-semantics";
import { discoveryArtistKey } from "./discovery-policy";
import type { DiscoveryCandidate } from "./discovery-ranking.service";
import {
  buildSteeringEvents,
  SESSION_STEERING_ACTIONS,
  SessionSteering,
  steeringArtistKey,
  steeringFamilyIds,
} from "./session_steering";

const DISCOVERY_PICK_REASON = "discovery_pick";

/**
 * Which listener signals say a track was PLAYED (#2316): the player records
 * `accept` when a DJ track starts, and `complete`, `replay` and `loop` as it is
 * heard. A skip, a save or a Home impression is not a play.
 */
const PLAYED_SIGNAL_ACTIONS = ["accept", "complete", "replay", "loop"];
/** Request-first sessions demote tracks played within this many days. */
export const RECENT_PLAY_WINDOW_DAYS = 14;
/** At most this many distinct recently played tracks are read. */
export const RECENT_PLAY_LIMIT = 50;
const RECENT_PLAY_READ_CAP = 300;
/** In-session steering (#2247) reads at most this many of the session's latest signal rows. */
const SESSION_STEERING_READ_CAP = 120;

function reasonCodeOf(metadata: unknown): unknown {
  if (!metadata || typeof metadata !== "object") return undefined;
  const recommendation = (metadata as Record<string, unknown>).recommendation;
  if (!recommendation || typeof recommendation !== "object") return undefined;
  return (recommendation as Record<string, unknown>).reasonCode;
}

export interface DiscoveryPolicyContext {
  /** Candidate artist ids whose creator is human-verified. */
  verifiedHumanArtistIds: Set<string>;
  /** Candidate artist ids the listener has any recorded interaction with. */
  playedArtistIds: Set<string>;
}

/**
 * Loads the two lookups the discovery policy stage needs for exploration
 * (ADR-TE-2 rule 2, docs/rfc/taste-engine.md §3.4 step 3): which of the
 * candidates' artists are verified humans, and which the listener has already
 * played. Reads creator verification and the listener's own interaction
 * history only; no payment, placement or partner data.
 *
 * Bounded: every query is scoped to the given artist ids and runs once per
 * call (three batched queries, no per-artist round trips).
 */
@Injectable()
export class DiscoveryPolicyContextService {
  async loadContext(
    userId: string | undefined,
    artistIds: string[],
  ): Promise<DiscoveryPolicyContext> {
    const ids = [...new Set(artistIds.filter(Boolean))];
    if (ids.length === 0) {
      return { verifiedHumanArtistIds: new Set(), playedArtistIds: new Set() };
    }
    const [verifiedHumanArtistIds, playedArtistIds] = await Promise.all([
      this.loadVerifiedHumanArtists(ids),
      userId ? this.loadPlayedArtists(userId, ids) : Promise.resolve(new Set<string>()),
    ]);
    return { verifiedHumanArtistIds, playedArtistIds };
  }

  /**
   * Diversity-cap key (`discoveryArtistKey`) per track id, in one batched
   * query. Session mode of the policy stage needs the credited artists of the
   * prior session tracks (diversity cap per 10 session tracks); it reuses
   * `loadTrackCandidates`, so the session window and the page resolve the
   * credited artist identically. Unknown track ids are simply absent.
   * `performerCap` keys on the credited performer alone (request-first, #2316).
   */
  async artistKeysForTracks(
    trackIds: string[],
    performerCap = false,
  ): Promise<Map<string, string>> {
    const candidates = await this.loadTrackCandidates(trackIds, { performerCap });
    return new Map(
      [...candidates].map(([id, candidate]) => [id, discoveryArtistKey(candidate)]),
    );
  }

  /**
   * How many of the given tracks were exploration ("discovery pick") picks
   * for this listener, for the session-mode exploration share. One bounded
   * query over the listener's `accept` AgentSignals for those tracks. A track
   * counts once, by its most recent accept signal: it is a discovery pick when
   * that signal's `metadata.recommendation.reasonCode` is `discovery_pick`.
   * Unknown user or no ids is 0. Errors propagate; callers must treat a
   * failure as "unknown" (undefined), never as 0.
   */
  async countDiscoveryPicks(
    userId: string | undefined,
    trackIds: string[],
  ): Promise<number> {
    const ids = [...new Set(trackIds.filter(Boolean))];
    if (!userId || ids.length === 0) return 0;
    const signals = await prisma.agentSignal.findMany({
      where: { userId, action: "accept", trackId: { in: ids } },
      orderBy: { createdAt: "desc" },
      select: { trackId: true, metadata: true },
    });
    const seen = new Set<string>();
    let picks = 0;
    for (const signal of signals) {
      if (seen.has(signal.trackId)) continue;
      seen.add(signal.trackId);
      if (reasonCodeOf(signal.metadata) === DISCOVERY_PICK_REASON) picks += 1;
    }
    return picks;
  }

  /**
   * The tracks this listener recently PLAYED, newest first (#2316), from their
   * own play signals. Home impressions (`servedTrackIds`) are deliberately not
   * included: being shown a track is not hearing it. One bounded query; errors
   * propagate and callers treat a failure as "no history". A listener who
   * switched off playback learning has no signals, so nothing is demoted.
   */
  async recentPlayedTrackIds(userId: string | undefined, now: Date = new Date()): Promise<string[]> {
    if (!userId) return [];
    const since = new Date(now.getTime() - RECENT_PLAY_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const rows = await prisma.agentSignal.findMany({
      where: { userId, action: { in: PLAYED_SIGNAL_ACTIONS }, createdAt: { gte: since } },
      orderBy: { createdAt: "desc" },
      take: RECENT_PLAY_READ_CAP,
      select: { trackId: true },
    });
    return [...new Set(rows.map((row) => row.trackId))].slice(0, RECENT_PLAY_LIMIT);
  }

  /**
   * In-session steering (#2247): the steering events of ONE AI DJ session, read
   * from its existing AgentSignal rows (nothing new is stored). A row belongs to
   * the session when it carries the session id (the explicit "Not this" skip) or
   * the DJ session id in its metadata (playback signals mirrored by analytics,
   * which never fill the column). A listener who switched off playback learning
   * has no rows, so the session is not steered. An event's age is how many of the
   * session's picks (their pick notes) were made after it. One signals query, one
   * pick-note query and one batched track read; errors propagate and the caller
   * treats a failure as "no steering".
   * `performerCap` keys artists on the credited performer alone (request-first, #2316).
   */
  async sessionSteering(
    userId: string | undefined,
    sessionId: string | undefined,
    options: { performerCap?: boolean } = {},
  ): Promise<SessionSteering> {
    if (!userId || !sessionId) return { events: [] };
    const rows = await prisma.agentSignal.findMany({
      where: {
        userId,
        action: { in: [...SESSION_STEERING_ACTIONS] },
        OR: [{ sessionId }, { metadata: { path: ["agentSessionId"], equals: sessionId } }],
      },
      orderBy: { createdAt: "desc" },
      take: SESSION_STEERING_READ_CAP,
      select: { trackId: true, action: true, createdAt: true },
    });
    if (rows.length === 0) return { events: [] };
    const [candidates, notes] = await Promise.all([
      this.loadTrackCandidates(rows.map((row) => row.trackId), { performerCap: options.performerCap }),
      prisma.agentPickNote.findMany({
        where: { userId, license: { sessionId } },
        select: { createdAt: true },
      }),
    ]);
    const facts = new Map(
      [...candidates].map(([id, candidate]) => [
        id,
        {
          families: steeringFamilyIds(candidate.release?.genre, candidate.descriptorFamilies),
          artistKey: steeringArtistKey(discoveryArtistKey(candidate)),
        },
      ]),
    );
    return {
      events: buildSteeringEvents({
        signals: rows,
        pickTimes: notes.map((note) => note.createdAt),
        facts,
      }),
    };
  }

  /**
   * Ranking candidates for arbitrary track ids (picks made outside the
   * candidate pipeline, such as LLM runtime picks), in one batched query.
   * Same fields the Home and DJ candidate mappers use: genre, moods, titles,
   * credited artist (#1492), artistId and AI disclosure level. Unknown ids are
   * absent from the map. Commercial availability is deliberately not read.
   */
  async loadTrackCandidates(
    trackIds: string[],
    options: { performerCap?: boolean } = {},
  ): Promise<Map<string, DiscoveryCandidate>> {
    const ids = [...new Set(trackIds.filter(Boolean))];
    if (ids.length === 0) return new Map();
    const tracks = await prisma.track.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        title: true,
        artist: true,
        aiDisclosureLevel: true,
        // Stored descriptor families (#2240): a second source for genre requests,
        // so an LLM pick is judged against the request like a ranked candidate.
        descriptor: { select: { families: true, energyBand: true } },
        release: {
          select: {
            title: true,
            genre: true,
            moods: true,
            artistId: true,
            primaryArtist: true,
            artist: { select: { displayName: true } },
          },
        },
      },
    });
    return new Map(
      tracks.map((track) => {
        const credited = resolveCreditedArtistNames({
          trackArtist: track.artist,
          primaryArtist: track.release.primaryArtist,
        });
        return [
          track.id,
          {
            id: track.id,
            title: track.title,
            artist: track.artist,
            artistId: track.release.artistId,
            aiDisclosureLevel: track.aiDisclosureLevel,
            descriptorFamilies: track.descriptor?.families ?? [],
            descriptorEnergyBand: track.descriptor?.energyBand ?? null,
            release: {
              genre: track.release.genre,
              title: track.release.title,
              moods: track.release.moods,
              // Display and hidden-artist matching keep the established order
              // (credit, then the uploader label as a last resort).
              artistDisplayName: resolveCreditedArtistName({
                trackArtist: track.artist,
                primaryArtist: track.release.primaryArtist,
                accountDisplayName: track.release.artist?.displayName,
              }),
              // Request-first sessions key the diversity cap on the performer
              // only (#2316); other callers keep the established key.
              ...(options.performerCap ? { creditedArtistName: credited[0] ?? null } : {}),
            },
          },
        ];
      }),
    );
  }

  /**
   * Artist.userId -> CuratorReputation(walletAddress = userId lowercased),
   * mirroring `PayoutEligibilityService.resolveHumanVerificationState` for a
   * set of artists instead of one.
   */
  private async loadVerifiedHumanArtists(artistIds: string[]): Promise<Set<string>> {
    const artists = await prisma.artist.findMany({
      where: { id: { in: artistIds }, userId: { not: null } },
      select: { id: true, userId: true },
    });
    const wallets = [
      ...new Set(
        artists.map((artist) => (artist.userId as string).toLowerCase()),
      ),
    ];
    if (wallets.length === 0) return new Set();

    const reputations = await prisma.curatorReputation.findMany({
      where: { walletAddress: { in: wallets } },
      select: {
        walletAddress: true,
        humanVerificationStatus: true,
        humanVerifiedAt: true,
      },
    });
    const verifiedWallets = new Set(
      reputations
        .filter(
          (record) =>
            deriveCreatorVerificationStates({
              humanVerificationStatus: record.humanVerificationStatus,
              humanVerifiedAt: record.humanVerifiedAt,
            }).humanVerificationStatus === "human_verified",
        )
        .map((record) => record.walletAddress),
    );
    return new Set(
      artists
        .filter((artist) =>
          verifiedWallets.has((artist.userId as string).toLowerCase()),
        )
        .map((artist) => artist.id),
    );
  }

  /** Any AgentSignal (any action) on a track of the artist counts as played. */
  private async loadPlayedArtists(
    userId: string,
    artistIds: string[],
  ): Promise<Set<string>> {
    const signals = await prisma.agentSignal.findMany({
      where: { userId, track: { release: { artistId: { in: artistIds } } } },
      distinct: ["trackId"],
      select: { track: { select: { release: { select: { artistId: true } } } } },
    });
    return new Set(signals.map((signal) => signal.track.release.artistId));
  }
}
