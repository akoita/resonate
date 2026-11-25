import { ForbiddenException, Injectable, Optional, NotFoundException, ServiceUnavailableException, ConflictException } from "@nestjs/common";
import { prisma } from "../../db/prisma";
import { EventBus } from "../shared/event_bus";
import {
  applyConsentChoices,
  currentChoices,
  parseConsentChoices,
  SAFE_DEFAULT_CHOICES,
  type ConsentChoices,
} from "./consent_choices";
import {
  loadParticipationAgreement,
  participationAgreementRequired,
  PARTICIPATION_AGREEMENT_REQUIRED_CODE,
  PARTICIPATION_AGREEMENT_UNAVAILABLE_CODE,
} from "./participation_agreement";

const HISTORY_LIMIT = 50;

/**
 * Uploads need the current agreement accepted (#2666). A plain function so the
 * ingestion path can call it without a new constructor dependency.
 */
export async function assertParticipationAccepted(artistId: string) {
  if (!participationAgreementRequired()) return;
  const agreement = loadParticipationAgreement();
  const accepted = await prisma.participationAcceptance.findUnique({
    where: { artistId_version: { artistId, version: agreement.version } },
    select: { id: true },
  });
  if (accepted && agreement.available) return;
  throw new ForbiddenException({
    code: PARTICIPATION_AGREEMENT_REQUIRED_CODE,
    message: agreement.available
      ? "Accept the current artist participation agreement before uploading. You can read it in Settings, Artist."
      : "Artist uploads are not open yet: the participation agreement has not been published.",
  });
}

type ArtistRow = {
  id: string;
  userId: string | null;
  managementOwnerUserId: string | null;
  remixConsent: string;
  aiRemixApproval: string;
  aiSourceUse: string;
  stemListing: string;
};

const ARTIST_SELECT = {
  id: true,
  userId: true,
  managementOwnerUserId: true,
  remixConsent: true,
  aiRemixApproval: true,
  aiSourceUse: true,
  stemListing: true,
} as const;

/**
 * The participation agreement and the artist's consent choices (#2666).
 * Only the artist account, or the account that manages the profile, may
 * accept the agreement or change the choices.
 */
@Injectable()
export class ParticipationService {
  constructor(@Optional() private readonly eventBus?: EventBus) {}

  agreement() {
    return loadParticipationAgreement();
  }

  /** What this artist accepted, what is current, their choices and the change history. */
  async status(userId: string, artistId: string) {
    const artist = await this.requireArtistOwner(userId, artistId);
    return this.describe(artist);
  }

  /**
   * Accept the current version with the artist's choices. The caller sends
   * the version and the hash of the text they were shown; a mismatch means
   * the text changed under them and nothing is recorded.
   */
  async accept(userId: string, artistId: string, input: { version?: unknown; textHash?: unknown; choices?: unknown }) {
    const agreement = loadParticipationAgreement();
    if (!agreement.available) {
      throw new ServiceUnavailableException({
        code: PARTICIPATION_AGREEMENT_UNAVAILABLE_CODE,
        message: "The participation agreement has not been published yet, so artist sign-up is not open.",
      });
    }
    if (input.version !== agreement.version || input.textHash !== agreement.textHash) {
      throw new ConflictException({
        code: "participation_agreement_changed",
        message: "The agreement was updated while you were reading it. Read the new version, then accept again.",
      });
    }
    const choices = parseConsentChoices(input.choices, { requireAll: true }) as ConsentChoices;
    const artist = await this.requireArtistOwner(userId, artistId);
    const now = new Date();
    const changes = await prisma.$transaction(async (tx) => {
      await tx.participationAcceptance.upsert({
        where: { artistId_version: { artistId: artist.id, version: agreement.version } },
        create: { artistId: artist.id, userId, version: agreement.version, textHash: agreement.textHash, acceptedAt: now },
        update: {},
      });
      return applyConsentChoices(tx, artist, userId, choices, "onboarding", { now, recordUnchanged: true });
    });
    this.publishRemixConsentChange(artist.id, userId, changes);
    const refreshed = await prisma.artist.findUniqueOrThrow({ where: { id: artist.id }, select: ARTIST_SELECT });
    return this.describe(refreshed);
  }

  /** Change choices from Settings. Withdrawals apply to new uses from now on. */
  async updateChoices(userId: string, artistId: string, input: unknown) {
    const choices = parseConsentChoices(input, { requireAll: false });
    const artist = await this.requireArtistOwner(userId, artistId);
    const changes = await prisma.$transaction((tx) => applyConsentChoices(tx, artist, userId, choices, "settings"));
    this.publishRemixConsentChange(artist.id, userId, changes);
    const refreshed = await prisma.artist.findUniqueOrThrow({ where: { id: artist.id }, select: ARTIST_SELECT });
    return this.describe(refreshed);
  }

  /** The operator view of one artist: accepted versions, choices and history. */
  async describeForOperator(artistId: string) {
    const artist = await prisma.artist.findUnique({ where: { id: artistId }, select: ARTIST_SELECT });
    if (!artist) throw new NotFoundException("Artist profile not found");
    return this.describe(artist);
  }

  /**
   * Refuse an upload for an artist who has not accepted the current version
   * (#2666). Off only with `PARTICIPATION_AGREEMENT_REQUIRED=false`.
   */
  async assertAccepted(artistId: string) {
    await assertParticipationAccepted(artistId);
  }

  /** Published remixes follow a remix consent change (#2601), wherever it was made. */
  private publishRemixConsentChange(
    artistId: string,
    userId: string,
    changes: Array<{ setting: string; previous: string; next: string }>,
  ) {
    const change = changes.find((c) => c.setting === "remixConsent" && c.previous !== c.next);
    if (!change || !this.eventBus) return;
    this.eventBus.publish({
      eventName: "artist.remix_consent_updated",
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      artistId,
      userId,
      previous: change.previous === "disabled" ? "disabled" : "allowed",
      next: change.next === "disabled" ? "disabled" : "allowed",
    });
  }

  private async describe(artist: ArtistRow) {
    const agreement = loadParticipationAgreement();
    const [acceptances, history] = await Promise.all([
      prisma.participationAcceptance.findMany({
        where: { artistId: artist.id },
        orderBy: { acceptedAt: "desc" },
        select: { version: true, textHash: true, acceptedAt: true },
      }),
      prisma.artistConsentChange.findMany({
        where: { artistId: artist.id },
        orderBy: { changedAt: "desc" },
        take: HISTORY_LIMIT,
        select: { setting: true, previousValue: true, value: true, source: true, changedAt: true },
      }),
    ]);
    const current = acceptances.find((a) => a.version === agreement.version) ?? null;
    return {
      artistId: artist.id,
      agreement: {
        version: agreement.version,
        textHash: agreement.textHash,
        placeholder: agreement.placeholder,
        available: agreement.available,
      },
      required: participationAgreementRequired(),
      accepted: current
        ? { version: current.version, textHash: current.textHash, acceptedAt: current.acceptedAt.toISOString() }
        : null,
      needsAcceptance: !current,
      acceptances: acceptances.map((a) => ({ version: a.version, textHash: a.textHash, acceptedAt: a.acceptedAt.toISOString() })),
      choices: currentChoices(artist),
      defaultChoices: SAFE_DEFAULT_CHOICES,
      history: history.map((h) => ({ ...h, changedAt: h.changedAt.toISOString() })),
    };
  }

  private async requireArtistOwner(userId: string, artistId: string): Promise<ArtistRow> {
    const artist = await prisma.artist.findUnique({ where: { id: artistId }, select: ARTIST_SELECT });
    if (!artist) throw new NotFoundException("Artist profile not found");
    const owner = artist.managementOwnerUserId ?? artist.userId;
    if (owner !== userId && artist.userId !== userId) {
      throw new ForbiddenException("Only the artist, or the account that manages the profile, can do this.");
    }
    return artist;
  }
}
