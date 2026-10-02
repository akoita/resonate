import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from "@nestjs/common";
import type { Subscription } from "rxjs";
import { prisma } from "../../db/prisma";
import type { CatalogReleaseReadyEvent } from "../../events/event_types";
import {
  classifyTrackAvailability,
  isPlayableAvailability,
} from "../catalog/track-availability";
import { NotificationService } from "../notifications/notification.service";
import { notifiableWalletForUserId } from "../notifications/notification_format";
import { DiscoveryPolicyContextService } from "../recommendations/discovery-policy-context.service";
import { EventBus } from "../shared/event_bus";
import type { CrateCandidateFacts } from "./crate.types";
import {
  candidateFactsFromRow,
  creditedArtistName,
  type CrateTrackRow,
} from "./crate_candidates";
import { sanitizeCrateFilters } from "./crate_filters";
import { crateTrackSelect } from "./crate_track_select";
import {
  CRATE_WATCH_MAX_CRATES_PER_EVENT,
  CRATE_WATCH_NOTIFICATION_TYPE,
  evaluateWatchMatch,
  notificationsRemaining,
  notificationWindowStart,
  watchNotificationCopy,
} from "./crate_watch";

/**
 * Crate watching, the matcher (#1967): when a release becomes publicly
 * playable, every track of it is evaluated against the crates that are
 * watching, and a match is recorded (and, within the daily cap, notified).
 *
 * WHEN a track is evaluated. `catalog.release_ready` is published by the
 * catalog's `stems.processed` handler only AFTER its transaction committed the
 * release as `ready`, the track as `complete` and the stems with their measured
 * `audioFeatures` (catalog.service.ts), so a track is publicly playable and its
 * measured features are already stored when this runs; `stems.processed` needs
 * no subscription of its own. Evaluating a track twice (a release that becomes
 * ready again, a duplicate event) is harmless: `CrateWatchMatch` is unique per
 * (crate, track), so nothing is recorded or notified twice. A track whose
 * processing is not `complete` yet is skipped and is evaluated by the event of
 * the release it finishes in.
 *
 * Watching only NOTIFIES. Nothing here buys, quotes or reserves anything; a
 * match is a prompt to open the crate and ask for a quote the DJ approves.
 *
 * Failure never breaks publishing: the handler runs after the release is
 * already ready and catches everything. Logs carry release ids and error codes
 * only, never filters, titles or user ids.
 *
 * Business model: ADR-BM-6 Line 3, phase 2. No fee is charged or changed.
 */

/** What one evaluation did; used by tests and the log line. */
export type CrateWatchRun = {
  tracksEvaluated: number;
  matched: number;
  notified: number;
};

/** The error class and Prisma code, never the message (it can echo input). */
function errorSummary(error: unknown): string {
  if (typeof error !== "object" || error === null) return "unknown";
  const code = (error as { code?: unknown }).code;
  const name = (error as { name?: unknown }).name;
  return [typeof name === "string" ? name : "Error", typeof code === "string" ? code : null]
    .filter(Boolean)
    .join(" ");
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object"
    && error !== null
    && (error as { code?: unknown }).code === "P2002"
  );
}

@Injectable()
export class CrateWatchService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CrateWatchService.name);
  private subscription: Subscription | null = null;
  /**
   * Releases are evaluated one after another inside this process, so the daily
   * notification cap cannot be overrun by two events reading the same count.
   */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly policyContext: DiscoveryPolicyContextService,
    @Optional() private readonly eventBus?: EventBus,
    // Without it matches are recorded and nobody is notified.
    @Optional() private readonly notifications?: NotificationService,
  ) {}

  onModuleInit() {
    if (!this.eventBus) return;
    this.subscription = this.eventBus.subscribe<CatalogReleaseReadyEvent>(
      "catalog.release_ready",
      (event) => {
        if (!event?.releaseId) return;
        void this.enqueueRelease(event.releaseId);
      },
    );
  }

  onModuleDestroy() {
    this.subscription?.unsubscribe();
    this.subscription = null;
  }

  /** Queues one release; never rejects. Resolves when it has been evaluated. */
  enqueueRelease(releaseId: string): Promise<void> {
    const run = this.queue.then(async () => {
      try {
        await this.evaluateRelease(releaseId);
      } catch (error) {
        this.logger.warn(
          `Crate watch evaluation failed for release ${releaseId}: ${errorSummary(error)}`,
        );
      }
    });
    this.queue = run;
    return run;
  }

  /**
   * Evaluates every publicly playable, fully processed track of the release
   * against the watching crates. Throws on a database failure; the queue
   * wrapper logs it.
   */
  async evaluateRelease(releaseId: string, now: Date = new Date()): Promise<CrateWatchRun> {
    const run: CrateWatchRun = { tracksEvaluated: 0, matched: 0, notified: 0 };
    const rows = (await prisma.track.findMany({
      where: { releaseId },
      orderBy: [{ position: "asc" }, { id: "asc" }],
      select: { ...crateTrackSelect(now), processingStatus: true },
    })) as Array<CrateTrackRow & { processingStatus: string }>;

    const playable = rows.filter(
      (row) =>
        row.processingStatus === "complete"
        && isPlayableAvailability(classifyTrackAvailability(row)),
    );
    if (playable.length === 0) return run;

    const artistIds = [...new Set(playable.map((row) => row.release.artistId))];
    const context = await this.policyContext.loadContext(undefined, artistIds);
    const artists = await prisma.artist.findMany({
      where: { id: { in: artistIds } },
      select: { id: true, userId: true },
    });
    const artistUserById = new Map(artists.map((artist) => [artist.id, artist.userId ?? null]));

    // Notifications sent in the window, per person, counted once per run.
    const remainingByUser = new Map<string, number>();

    for (const row of playable) {
      const facts = candidateFactsFromRow(row, context.verifiedHumanArtistIds, now);
      const result = await this.evaluateTrack(
        row,
        facts,
        artistUserById.get(row.release.artistId) ?? null,
        now,
        remainingByUser,
      );
      run.tracksEvaluated += 1;
      run.matched += result.matched;
      run.notified += result.notified;
    }
    if (run.matched > 0) {
      this.logger.log(
        `Crate watch: release ${releaseId} matched ${run.matched} crate(s), notified ${run.notified}`,
      );
    }
    return run;
  }

  private async evaluateTrack(
    row: CrateTrackRow,
    facts: CrateCandidateFacts,
    artistUserId: string | null,
    now: Date,
    remainingByUser: Map<string, number>,
  ): Promise<{ matched: number; notified: number }> {
    // Bounded: one more than the bound tells us the bound was hit.
    const crates = await prisma.crate.findMany({
      where: {
        watchMode: "notify",
        status: "saved",
        watchExpiresAt: { gt: now },
        ...(artistUserId ? { userId: { not: artistUserId } } : {}),
      },
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      take: CRATE_WATCH_MAX_CRATES_PER_EVENT + 1,
      select: {
        id: true,
        userId: true,
        title: true,
        filters: true,
        items: { select: { trackId: true } },
      },
    });
    if (crates.length > CRATE_WATCH_MAX_CRATES_PER_EVENT) {
      this.logger.warn(
        `Crate watch: more than ${CRATE_WATCH_MAX_CRATES_PER_EVENT} watching crates; evaluating the ${CRATE_WATCH_MAX_CRATES_PER_EVENT} least recently updated`,
      );
      crates.length = CRATE_WATCH_MAX_CRATES_PER_EVENT;
    }
    if (crates.length === 0) return { matched: 0, notified: 0 };

    const already = new Set(
      (
        await prisma.crateWatchMatch.findMany({
          where: { trackId: facts.trackId, crateId: { in: crates.map((crate) => crate.id) } },
          select: { crateId: true },
        })
      ).map((match) => match.crateId),
    );

    let matched = 0;
    let notified = 0;
    for (const crate of crates) {
      if (already.has(crate.id)) continue;
      const verdict = evaluateWatchMatch({
        facts,
        filters: sanitizeCrateFilters(crate.filters).filters,
        crateTrackIds: new Set(crate.items.map((item) => item.trackId)),
        crateUserId: crate.userId,
        artistUserId,
      });
      if (verdict !== "match") continue;

      try {
        let matchId: string;
        try {
          const created = await prisma.crateWatchMatch.create({
            data: { crateId: crate.id, userId: crate.userId, trackId: facts.trackId },
            select: { id: true },
          });
          matchId = created.id;
        } catch (error) {
          // A concurrent evaluation recorded it first: nothing new to notify.
          if (isUniqueViolation(error)) continue;
          throw error;
        }
        matched += 1;

        if (await this.notify(crate, row, matchId, now, remainingByUser)) notified += 1;
      } catch (error) {
        this.logger.warn(`Crate watch: could not record a match: ${errorSummary(error)}`);
      }
    }
    return { matched, notified };
  }

  /**
   * Sends the match notification when the person has an inbox and is under the
   * daily cap, and stamps `notifiedAt`. The match is already recorded either
   * way. Returns whether a notification was sent.
   */
  private async notify(
    crate: { id: string; userId: string; title: string | null },
    row: CrateTrackRow,
    matchId: string,
    now: Date,
    remainingByUser: Map<string, number>,
  ): Promise<boolean> {
    if (!this.notifications) return false;
    const walletAddress = notifiableWalletForUserId(crate.userId);
    if (!walletAddress) return false;

    let remaining = remainingByUser.get(crate.userId);
    if (remaining === undefined) {
      const sent = await prisma.crateWatchMatch.count({
        where: { userId: crate.userId, notifiedAt: { gte: notificationWindowStart(now) } },
      });
      remaining = notificationsRemaining(sent);
    }
    if (remaining <= 0) {
      remainingByUser.set(crate.userId, 0);
      return false;
    }

    const copy = watchNotificationCopy({
      crateTitle: crate.title,
      trackTitle: row.title,
      artistName: creditedArtistName(row),
    });
    const notification = await this.notifications.createNotification({
      walletAddress,
      type: CRATE_WATCH_NOTIFICATION_TYPE,
      title: copy.title,
      message: copy.message,
      crateId: crate.id,
    });
    if (!notification) {
      // Switched off in the person's preferences, or the write failed.
      remainingByUser.set(crate.userId, remaining);
      return false;
    }
    await prisma.crateWatchMatch.update({ where: { id: matchId }, data: { notifiedAt: now } });
    remainingByUser.set(crate.userId, remaining - 1);
    return true;
  }
}
