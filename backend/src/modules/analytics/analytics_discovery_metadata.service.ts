import { Injectable } from "@nestjs/common";
import { prisma } from "../../db/prisma";
import { resolveCreditedArtistIds } from "../shared/artist_attribution";
import { pseudonymousAnalyticsActorId } from "./analytics_identity";
import type { AnalyticsEventEnvelope } from "./analytics_event";

const ENGAGEMENT_EVENTS = new Set([
  "playback.started", "playback.completed", "library.saved", "playlist.track_added",
  "commerce.settled", "payment.settled", "x402.purchase", "agent.purchase_completed",
]);
const SETTLED_EVENTS = new Set(["commerce.settled", "payment.settled", "x402.purchase", "agent.purchase_completed"]);

/** Server-owned catalog dimensions; client payloads never certify eligibility. */
@Injectable()
export class AnalyticsDiscoveryMetadataService {
  async enrich(event: AnalyticsEventEnvelope): Promise<AnalyticsEventEnvelope> {
    if (!ENGAGEMENT_EVENTS.has(event.eventName)) return event;
    const payload = { ...event.payload };
    delete payload.genre;
    delete payload.aiDisclosureLevel;
    delete payload.selfEngagement;
    delete payload.creditedArtistId;
    delete payload.creditedArtistIds;
    const trackId = typeof payload.trackId === "string" ? payload.trackId
      : event.subjectType === "track" ? event.subjectId : undefined;
    if (!trackId) return { ...event, payload };
    const track = await prisma.track.findUnique({
      where: { id: trackId },
      select: {
        aiDisclosureLevel: true, artist: true,
        release: { select: {
          id: true, genre: true, artistId: true, primaryArtist: true,
          artist: { select: { userId: true, displayName: true } },
          artistCredits: { select: { artistId: true, role: true, displayName: true, identityStatus: true, artist: { select: { userId: true } } } },
        } },
      },
    });
    if (!track) return { ...event, payload };
    let actorId = event.actorId;
    // Paid listening is tied to the authenticated session, not a wallet count.
    if (SETTLED_EVENTS.has(event.eventName) && event.sessionId) {
      const session = await prisma.session.findUnique({ where: { id: event.sessionId }, select: { userId: true } });
      if (session) actorId = pseudonymousAnalyticsActorId(session.userId);
    }
    const owner = track.release.artist.userId;
    const ownerActor = pseudonymousAnalyticsActorId(owner);
    const creditedIds = resolveCreditedArtistIds({
      trackArtist: track.artist, credits: track.release.artistCredits,
      primaryArtist: track.release.primaryArtist, accountDisplayName: track.release.artist.displayName,
    });
    const credits = track.release.artistCredits.filter((credit) => creditedIds.includes(credit.artistId));
    const selfActors = new Set(credits.flatMap((credit) =>
      [credit.artist.userId, pseudonymousAnalyticsActorId(credit.artist.userId)].filter(Boolean),
    ));
    const hasListener = typeof actorId === "string" && /^user_[a-f0-9]{32}$/.test(actorId);
    return {
      ...event,
      actorId,
      payload: {
        ...payload, trackId, releaseId: track.release.id, artistId: track.release.artistId,
        genre: track.release.genre,
        aiDisclosureLevel: track.aiDisclosureLevel,
        creditedArtistId: creditedIds[0] ?? null,
        creditedArtistIds: creditedIds,
        // Unknown identities fail closed in marts; they are never an audience.
        ...(hasListener ? { selfEngagement: actorId === ownerActor || actorId === owner || selfActors.has(actorId) } : {}),
      },
    };
  }
}
