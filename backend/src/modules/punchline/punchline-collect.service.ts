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
 * Payment: this slice ships the **free_claim rail only** (priceCents = 0).
 * Paid collects intentionally return `payment_rail_pending`: the existing x402
 * machinery is stem-keyed end-to-end (X402Settlement.stemId, the middleware's
 * /api/stems route match, stem receipts) and generalizing it to moments is its
 * own tracked slice — and canonical moment pricing is still a pending operator
 * decision (docs/rfc/business-model.md rule: no new fee/price without
 * reconciliation). The `paymentRail`/`pricePaidCents`/`paymentRef` columns are
 * already in place for that rail to fill.
 */

export type PunchlineCollectErrorCode =
  | "moment_not_found"
  | "drop_not_published"
  | "sold_out"
  | "already_collected"
  | "payment_rail_pending"
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

    // Paid rail is a tracked follow-up — see the service doc comment.
    if (moment.priceCents > 0) {
      throw new PunchlineCollectException(
        "payment_rail_pending",
        "Paid collecting is not available yet — this moment can be collected once payments open.",
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
      pricePaidCents: 0,
      paymentRail: FREE_CLAIM_RAIL,
    };
    this.eventBus.publish(collectedEvent);

    // Unlock hook (#488): detect set completion now; reward granting is the
    // follow-up slice. The event is the durable signal it will consume.
    const setCompleted = await this.evaluateSetCompletion(
      userId,
      moment.drop.id,
    );
    let unlock: Awaited<
      ReturnType<PunchlineUnlockService["grantForCompletedSet"]>
    > = null;
    if (setCompleted) {
      const setEvent: PunchlineSetCompletedEvent = {
        eventName: "punchline.set_completed",
        eventVersion: 1,
        occurredAt: new Date().toISOString(),
        dropId: moment.drop.id,
        trackId: moment.drop.trackId,
        artistId: moment.drop.artistId,
        collectorUserId: userId,
      };
      this.eventBus.publish(setEvent);

      // #488: grant the drop's complete-set reward exactly once (DB-unique).
      // A grant failure must never fail the collect itself.
      try {
        unlock =
          (await this.unlockService?.grantForCompletedSet(
            userId,
            moment.drop.id,
          )) ?? null;
      } catch (error) {
        this.logger.error(
          `Unlock grant failed for drop ${moment.drop.id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

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
      setCompleted,
      unlock,
      rightsSummary: PUNCHLINE_RIGHTS_SUMMARY,
    };
  }

  /**
   * The caller's owned collectibles, newest first — the queryable ownership
   * surface (#485 acceptance) the inventory view (#487) renders.
   */
  async listMyCollectibles(userId: string) {
    const rows = await prisma.punchlineCollectible.findMany({
      where: { collectorUserId: userId, status: "owned" },
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
                track: { select: { title: true, releaseId: true } },
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

    return {
      items: rows.map((row) => ({
        id: row.id,
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
        },
        drop: {
          id: row.moment.drop.id,
          title: row.moment.drop.title,
          trackId: row.moment.drop.trackId,
          trackTitle: row.moment.drop.track?.title ?? null,
          releaseId: row.moment.drop.track?.releaseId ?? null,
          artistId: row.moment.drop.artistId,
          artistName: row.moment.drop.artist?.displayName ?? null,
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
