import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";
import {
  PunchlineMomentCollectedEvent,
  PunchlineSetCompletedEvent,
} from "../../events/event_types";
import { EventBus } from "../shared/event_bus";
import { PUNCHLINE_RIGHTS_SUMMARY } from "./punchline-rights";
import { PunchlineUnlockService } from "./punchline-unlock.service";
import { resolveCreditedArtistName } from "../shared/artist_attribution";
import {
  evaluatePurchaseDelivery,
  linkConsentToPurchase,
  type DeliveryDecision,
} from "../purchase_consent/purchase_consent_delivery";

/**
 * Collect / ownership grant for Punchline collectibles (#485).
 *
 * A fan collects one edition of a published moment. Ownership is an off-chain
 * DB grant (Path A — see the feature page): a `PunchlineCollectible` row with a
 * per-moment edition number. Scarcity and fairness are enforced at the
 * database level, not in application memory:
 *
 *   - `@@unique([momentId, editionNumber])` makes edition allocation race-safe:
 *     concurrent collects that compute the same next edition collide on the
 *     constraint and retry with a fresh count, so a moment can NEVER oversell.
 *   - `@@unique([momentId, collectorUserId])` caps collecting at one edition per
 *     fan per moment (set-completion mechanics (#488) count owned moments, and
 *     free claims must not be sweepable by a single account).
 *
 * Payment rails:
 *   - **free_claim** (priceCents = 0): granted immediately by `collectMoment`.
 *   - **x402** (priceCents > 0): settled on the x402 personal rail by
 *     `PunchlineX402Service`, which verifies the on-chain USDC payment and then
 *     calls `allocatePaidEditionWithSettlement` to grant the edition and record
 *     the settlement in a single transaction (#1462). Priced moments routed to
 *     the free endpoint are rejected with `payment_required`.
 */

export type PunchlineCollectErrorCode =
  | "moment_not_found"
  | "drop_not_published"
  | "sold_out"
  | "already_collected"
  | "payment_required"
  | "paid_but_unfulfilled"
  | "collect_failed";

export class PunchlineCollectException extends BadRequestException {
  constructor(
    public readonly code: PunchlineCollectErrorCode,
    message: string,
  ) {
    super({ code, message });
    this.name = "PunchlineCollectException";
  }
}

/** How many times a collect retries after losing an edition-number race. */
const EDITION_RACE_RETRIES = 5;

const FREE_CLAIM_RAIL = "free_claim";
const PAID_RAIL = "x402";

@Injectable()
export class PunchlineCollectService {
  private readonly logger = new Logger(PunchlineCollectService.name);

  constructor(
    private readonly eventBus: EventBus,
    @Optional() private readonly unlockService?: PunchlineUnlockService,
  ) {}

  /**
   * Collect one edition of a published moment for the calling fan.
   * Returns the grant plus whether this collect completed the drop's set
   * (the #488 unlock hook — reward granting lands there).
   */
  async collectMoment(
    userId: string,
    momentId: string,
    options?: { collectorWallet?: string | null },
  ) {
    const moment = await prisma.punchlineMoment.findUnique({
      where: { id: momentId },
      include: {
        drop: {
          select: { id: true, trackId: true, artistId: true, status: true },
        },
      },
    });
    if (!moment) {
      throw new PunchlineCollectException(
        "moment_not_found",
        `Moment ${momentId} was not found.`,
      );
    }
    if (moment.drop.status !== "published") {
      throw new PunchlineCollectException(
        "drop_not_published",
        "This drop is not published, so its moments cannot be collected.",
      );
    }

    // Priced moments settle on the x402 rail via PunchlineX402Service; the free
    // endpoint must never grant a paid edition for free.
    if (moment.priceCents > 0) {
      throw new PunchlineCollectException(
        "payment_required",
        "This moment is priced — collect it through the paid checkout.",
      );
    }

    const wallet = this.normalizeWallet(options?.collectorWallet);

    const collectible = await this.allocateEdition(userId, moment.id, {
      editionSize: moment.editionSize,
      collectorWallet: wallet,
      pricePaidCents: 0,
      paymentRail: FREE_CLAIM_RAIL,
      paymentRef: null,
    });

    return this.finalizeCollect(userId, moment, collectible);
  }

  /**
   * Shared post-allocation finalize for both rails: emit the collected event
   * with the real amounts recorded on the grant, evaluate set completion, grant
   * the complete-set reward once (#488), and shape the collect response. Called
   * by the free path and by `PunchlineX402Service` after a paid grant.
   */
  async finalizeCollect(
    userId: string,
    moment: {
      id: string;
      editionSize: number;
      drop: { id: string; trackId: string; artistId: string };
    },
    collectible: {
      id: string;
      editionNumber: number;
      status: string;
      paymentRail: string;
      pricePaidCents: number;
      paymentRef?: string | null;
      acquiredAt: Date | null;
    },
  ) {
    const collectedEvent: PunchlineMomentCollectedEvent = {
      eventName: "punchline.moment_collected",
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      momentId: moment.id,
      dropId: moment.drop.id,
      trackId: moment.drop.trackId,
      artistId: moment.drop.artistId,
      collectorUserId: userId,
      editionNumber: collectible.editionNumber,
      pricePaidCents: collectible.pricePaidCents,
      paymentRail: collectible.paymentRail,
    };
    this.eventBus.publish(collectedEvent);

    // #1776: a collectible whose delivery is held (paid, no immediate-delivery
    // consent, withdrawal period running) is recorded but not yet delivered, so
    // it does not complete a set or earn the reward until it is released.
    const held = collectible.status === "pending";
    const { setCompleted, unlock } = held
      ? { setCompleted: false, unlock: null }
      : await this.completeSetIfReady(userId, moment.drop);
    const delivery = held
      ? await this.describeDelivery(userId, moment.id, collectible)
      : ({ state: "released" } as const);

    return {
      collectible: {
        id: collectible.id,
        momentId: moment.id,
        dropId: moment.drop.id,
        editionNumber: collectible.editionNumber,
        editionSize: moment.editionSize,
        status: collectible.status,
        paymentRail: collectible.paymentRail,
        pricePaidCents: collectible.pricePaidCents,
        acquiredAt: collectible.acquiredAt,
      },
      delivery,
      setCompleted,
      unlock,
      rightsSummary: PUNCHLINE_RIGHTS_SUMMARY,
    };
  }

  /**
   * Detect set completion and grant the drop's complete-set reward exactly once
   * (#488). Shared by a collect that is delivered immediately and by the release
   * of a held collectible. A grant failure must never fail the caller.
   */
  private async completeSetIfReady(
    userId: string,
    drop: { id: string; trackId: string; artistId: string },
  ) {
    const setCompleted = await this.evaluateSetCompletion(userId, drop.id);
    let unlock: Awaited<
      ReturnType<PunchlineUnlockService["grantForCompletedSet"]>
    > = null;
    if (setCompleted) {
      const setEvent: PunchlineSetCompletedEvent = {
        eventName: "punchline.set_completed",
        eventVersion: 1,
        occurredAt: new Date().toISOString(),
        dropId: drop.id,
        trackId: drop.trackId,
        artistId: drop.artistId,
        collectorUserId: userId,
      };
      this.eventBus.publish(setEvent);

      try {
        unlock =
          (await this.unlockService?.grantForCompletedSet(userId, drop.id)) ??
          null;
      } catch (error) {
        this.logger.error(
          `Unlock grant failed for drop ${drop.id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    return { setCompleted, unlock };
  }

  /** The delivery state of a collectible: released, or held with the release date (#1776). */
  private async describeDelivery(
    userId: string,
    momentId: string,
    collectible: { id: string; status: string; paymentRef?: string | null; acquiredAt: Date | null; createdAt?: Date },
  ): Promise<
    { state: "released" } | { state: "held"; availableAt: string }
  > {
    if (collectible.status !== "pending") return { state: "released" };
    const decision = await this.decideDelivery(userId, momentId, collectible);
    return decision.state === "held"
      ? { state: "held", availableAt: decision.availableAt.toISOString() }
      : { state: "released" };
  }

  private decideDelivery(
    userId: string,
    momentId: string,
    collectible: { id: string; paymentRef?: string | null; acquiredAt: Date | null; createdAt?: Date },
  ): Promise<DeliveryDecision> {
    return evaluatePurchaseDelivery(userId, {
      surface: "punchline_collect",
      subjectId: momentId,
      purchasedAt: collectible.acquiredAt ?? collectible.createdAt ?? new Date(),
      refs: [collectible.paymentRef, collectible.id],
    });
  }

  /**
   * Release this fan's held paid collectibles whose consent was recorded or
   * whose withdrawal period has ended (#1776). Lazy by design: it runs when the
   * fan reads their collection, so no scheduled job is needed. A release can
   * complete a set, which grants the complete-set reward then.
   */
  async releaseHeldCollectibles(userId: string): Promise<number> {
    const pending = await prisma.punchlineCollectible.findMany({
      where: { collectorUserId: userId, status: "pending" },
      include: {
        moment: {
          select: {
            id: true,
            drop: { select: { id: true, trackId: true, artistId: true } },
          },
        },
      },
    });
    let released = 0;
    for (const collectible of pending) {
      const decision = await this.decideDelivery(userId, collectible.momentId, collectible);
      if (decision.state !== "released") continue;
      const updated = await prisma.punchlineCollectible.updateMany({
        where: { id: collectible.id, status: "pending" },
        data: { status: "owned" },
      });
      if (updated.count === 0) continue;
      released += 1;
      if (decision.basis === "consent") {
        await linkConsentToPurchase(decision.consentId, { purchaseRef: collectible.id });
      }
      await this.completeSetIfReady(userId, collectible.moment.drop);
    }
    return released;
  }

  /**
   * Shape an ALREADY-granted collect response without emitting events — the
   * idempotent replay surface for the paid rail (#1462). Returns null when the
   * fan holds no edition of the moment.
   */
  async describeExistingCollect(userId: string, momentId: string) {
    // A replay after the consent was recorded or the hold elapsed delivers it (#1776).
    await this.releaseHeldCollectibles(userId);
    const collectible = await prisma.punchlineCollectible.findUnique({
      where: {
        momentId_collectorUserId: { momentId, collectorUserId: userId },
      },
      include: {
        moment: {
          select: {
            id: true,
            editionSize: true,
            drop: { select: { id: true, trackId: true, artistId: true } },
          },
        },
      },
    });
    if (!collectible) {
      return null;
    }
    const setCompleted = await this.evaluateSetCompletion(
      userId,
      collectible.moment.drop.id,
    );
    return {
      collectible: {
        id: collectible.id,
        momentId: collectible.moment.id,
        dropId: collectible.moment.drop.id,
        editionNumber: collectible.editionNumber,
        editionSize: collectible.moment.editionSize,
        status: collectible.status,
        paymentRail: collectible.paymentRail,
        pricePaidCents: collectible.pricePaidCents,
        acquiredAt: collectible.acquiredAt,
      },
      delivery: await this.describeDelivery(userId, momentId, collectible),
      setCompleted,
      unlock: null,
      rightsSummary: PUNCHLINE_RIGHTS_SUMMARY,
    };
  }

  /**
   * The caller's owned collectibles, newest first — the queryable ownership
   * surface (#485 acceptance) the inventory view (#487) renders.
   */
  async listMyCollectibles(userId: string) {
    // Lazy release of held paid collectibles (#1776), then list owned and held.
    await this.releaseHeldCollectibles(userId);
    const rows = await prisma.punchlineCollectible.findMany({
      where: { collectorUserId: userId, status: { in: ["owned", "pending"] } },
      orderBy: { createdAt: "desc" },
      take: 200,
      include: {
        moment: {
          include: {
            drop: {
              select: {
                id: true,
                trackId: true,
                artistId: true,
                title: true,
                status: true,
                track: {
                  select: {
                    title: true,
                    releaseId: true,
                    // Credited-artist inputs (#1492) so the inventory shows the
                    // real artist, not the uploader/manager account label.
                    artist: true,
                    release: { select: { primaryArtist: true } },
                  },
                },
                artist: { select: { displayName: true } },
                // Total moments in the drop — the inventory renders set
                // progress ("you own N of M") without a second query.
                _count: { select: { moments: true } },
              },
            },
          },
        },
      },
    });

    const holds = await Promise.all(
      rows.map((row) => this.describeDelivery(userId, row.momentId, row)),
    );

    return {
      items: rows.map((row, index) => ({
        id: row.id,
        status: row.status,
        delivery: holds[index],
        editionNumber: row.editionNumber,
        editionSize: row.moment.editionSize,
        acquiredAt: row.acquiredAt,
        paymentRail: row.paymentRail,
        pricePaidCents: row.pricePaidCents,
        moment: {
          id: row.moment.id,
          title: row.moment.title,
          lyricText: row.moment.lyricText,
          artworkUrl: row.moment.artworkUrl,
          startMs: row.moment.startMs,
          endMs: row.moment.endMs,
          clipAssetUri: row.moment.clipAssetUri,
          rightsLabel: row.moment.rightsLabel,
          // #2522: so the Moments tab names each moment by its kind.
          momentKind: row.moment.momentKind,
          sourceStemType: row.moment.sourceStemType,
        },
        drop: {
          id: row.moment.drop.id,
          title: row.moment.drop.title,
          trackId: row.moment.drop.trackId,
          trackTitle: row.moment.drop.track?.title ?? null,
          releaseId: row.moment.drop.track?.releaseId ?? null,
          artistId: row.moment.drop.artistId,
          artistName: resolveCreditedArtistName({
            trackArtist: row.moment.drop.track?.artist,
            primaryArtist: row.moment.drop.track?.release?.primaryArtist,
            accountDisplayName: row.moment.drop.artist?.displayName,
          }),
          momentCount: row.moment.drop._count?.moments ?? 0,
        },
      })),
      meta: { count: rows.length },
    };
  }

  /**
   * Allocate the next edition number under the two DB unique constraints.
   * Sold-out is decided from the row count; a lost race on
   * [momentId, editionNumber] retries with a fresh count, and a violation of
   * [momentId, collectorUserId] means this fan already owns the moment.
   */
  private async allocateEdition(
    userId: string,
    momentId: string,
    input: {
      editionSize: number;
      collectorWallet: string | null;
      pricePaidCents: number;
      paymentRail: string;
      paymentRef: string | null;
    },
  ) {
    const existing = await prisma.punchlineCollectible.findUnique({
      where: {
        momentId_collectorUserId: { momentId, collectorUserId: userId },
      },
      select: { id: true },
    });
    if (existing) {
      throw new PunchlineCollectException(
        "already_collected",
        "You already own an edition of this moment.",
      );
    }

    for (let attempt = 0; attempt <= EDITION_RACE_RETRIES; attempt++) {
      const taken = await prisma.punchlineCollectible.count({
        where: { momentId },
      });
      if (taken >= input.editionSize) {
        throw new PunchlineCollectException(
          "sold_out",
          "All editions of this moment have been collected.",
        );
      }

      try {
        return await prisma.punchlineCollectible.create({
          data: {
            momentId,
            collectorUserId: userId,
            collectorWallet: input.collectorWallet,
            editionNumber: taken + 1,
            status: "owned",
            paymentRail: input.paymentRail,
            pricePaidCents: input.pricePaidCents,
            paymentRef: input.paymentRef,
            acquiredAt: new Date(),
          },
        });
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        ) {
          const target = Array.isArray(error.meta?.target)
            ? (error.meta?.target as string[]).join(",")
            : String(error.meta?.target ?? "");
          if (target.includes("collectorUserId")) {
            throw new PunchlineCollectException(
              "already_collected",
              "You already own an edition of this moment.",
            );
          }
          // Lost the edition-number race — loop and recount.
          continue;
        }
        throw error;
      }
    }

    this.logger.warn(
      `Edition allocation exhausted retries for moment ${momentId}`,
    );
    throw new PunchlineCollectException(
      "collect_failed",
      "This moment is being collected quickly — please try again.",
    );
  }

  /**
   * Paid-rail allocation (#1462). Grants the next edition AND records the x402
   * settlement in a SINGLE transaction, so a settlement can never exist without
   * its edition and vice-versa. A lost edition-number race rolls the whole
   * transaction back (settlement included) and retries with a fresh count —
   * never double-settling. Terminal failures (`sold_out`, `already_collected`)
   * throw a typed exception the caller turns into a `refund_due` record: the
   * fan paid but no edition could be granted.
   *
   * `settlementData` must be a fully-built settlement row (the caller owns
   * amounts, proof hash, receipt); `receiptId`/txHash uniqueness is stable
   * across retries because rolled-back attempts commit nothing.
   */
  async allocatePaidEditionWithSettlement(
    userId: string,
    momentId: string,
    input: {
      editionSize: number;
      collectorWallet: string | null;
      pricePaidCents: number;
      paymentRef: string;
      /** "pending" holds the delivery until consent or the end of the withdrawal period (#1776). */
      status?: "owned" | "pending";
    },
    settlementData: Prisma.X402SettlementUncheckedCreateInput,
  ) {
    // Fast fail before touching money if the fan already owns an edition.
    const existing = await prisma.punchlineCollectible.findUnique({
      where: {
        momentId_collectorUserId: { momentId, collectorUserId: userId },
      },
      select: { id: true },
    });
    if (existing) {
      throw new PunchlineCollectException(
        "already_collected",
        "You already own an edition of this moment.",
      );
    }

    for (let attempt = 0; attempt <= EDITION_RACE_RETRIES; attempt++) {
      try {
        return await prisma.$transaction(async (tx) => {
          const taken = await tx.punchlineCollectible.count({
            where: { momentId },
          });
          if (taken >= input.editionSize) {
            throw new PunchlineCollectException(
              "sold_out",
              "All editions of this moment have been collected.",
            );
          }

          const collectible = await tx.punchlineCollectible.create({
            data: {
              momentId,
              collectorUserId: userId,
              collectorWallet: input.collectorWallet,
              editionNumber: taken + 1,
              status: input.status ?? "owned",
              paymentRail: PAID_RAIL,
              pricePaidCents: input.pricePaidCents,
              paymentRef: input.paymentRef,
              acquiredAt: new Date(),
            },
          });

          await tx.x402Settlement.create({ data: settlementData });

          return collectible;
        });
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        ) {
          const target = Array.isArray(error.meta?.target)
            ? (error.meta?.target as string[]).join(",")
            : String(error.meta?.target ?? "");
          if (target.includes("collectorUserId")) {
            throw new PunchlineCollectException(
              "already_collected",
              "You already own an edition of this moment.",
            );
          }
          if (target.includes("editionNumber")) {
            // Lost the edition-number race — the whole tx (settlement too)
            // rolled back; recount and retry.
            continue;
          }
          // A settlement-uniqueness collision means this exact payment was
          // already recorded concurrently — the caller's replay check owns the
          // idempotent response; surface it rather than double-granting.
          throw new PunchlineCollectException(
            "already_collected",
            "This payment has already been recorded.",
          );
        }
        throw error;
      }
    }

    this.logger.warn(
      `Paid edition allocation exhausted retries for moment ${momentId}`,
    );
    throw new PunchlineCollectException(
      "collect_failed",
      "This moment is being collected quickly — please try again.",
    );
  }

  /** True when the collector now owns every moment in the drop. */
  private async evaluateSetCompletion(
    userId: string,
    dropId: string,
  ): Promise<boolean> {
    const [momentCount, ownedCount] = await Promise.all([
      prisma.punchlineMoment.count({ where: { dropId } }),
      prisma.punchlineCollectible.count({
        where: {
          collectorUserId: userId,
          status: "owned",
          moment: { dropId },
        },
      }),
    ]);
    return momentCount > 0 && ownedCount >= momentCount;
  }

  private normalizeWallet(wallet?: string | null): string | null {
    if (typeof wallet !== "string") {
      return null;
    }
    const trimmed = wallet.trim();
    if (!/^0x[a-fA-F0-9]{40}$/.test(trimmed)) {
      return null;
    }
    return trimmed;
  }
}
