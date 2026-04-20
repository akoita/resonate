import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { EventBus } from "../shared/event_bus";
import { prisma } from "../../db/prisma";

const ACTIVE_TRACK_STATES = ["separating", "encrypting", "storing"] as const;
const DEFAULT_WATCHDOG_TIMEOUT_MS = 15 * 60 * 1000;
const DEFAULT_WATCHDOG_INTERVAL_MS = 60 * 1000;

type StaleTrack = {
  id: string;
  title: string;
  releaseId: string;
  artist: string | null;
  createdAt: Date;
  processingStatus: string;
  processingStartedAt: Date | null;
  lastProgressAt: Date | null;
  release: {
    artistId: string;
  };
};

@Injectable()
export class StemWatchdogService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StemWatchdogService.name);
  private watchdogInterval: NodeJS.Timeout | null = null;
  private sweepInFlight = false;

  constructor(private readonly eventBus: EventBus) {}

  onModuleInit() {
    if (process.env.NODE_ENV === "test") {
      return;
    }

    if ((process.env.STEM_PROCESSING_MODE || "pubsub") === "sync") {
      this.logger.log("Stem processing watchdog disabled in sync mode");
      return;
    }

    const intervalMs = this.getIntervalMs();
    const timeoutMs = this.getTimeoutMs();

    this.logger.log(
      `Starting stem processing watchdog (interval=${intervalMs}ms, timeout=${timeoutMs}ms)`,
    );

    this.watchdogInterval = setInterval(() => {
      void this.runWatchdogSweep();
    }, intervalMs);
    this.watchdogInterval.unref?.();

    void this.runWatchdogSweep();
  }

  onModuleDestroy() {
    if (this.watchdogInterval) {
      clearInterval(this.watchdogInterval);
      this.watchdogInterval = null;
    }
  }

  async runWatchdogSweep() {
    if (this.sweepInFlight) {
      return;
    }

    this.sweepInFlight = true;
    try {
      const timeoutMs = this.getTimeoutMs();
      const cutoff = new Date(Date.now() - timeoutMs);

      const staleTracks = await prisma.track.findMany({
        where: {
          processingStatus: { in: [...ACTIVE_TRACK_STATES] },
          release: { status: "processing" },
          OR: [
            { lastProgressAt: { lte: cutoff } },
            {
              lastProgressAt: null,
              processingStartedAt: { lte: cutoff },
            },
            {
              lastProgressAt: null,
              processingStartedAt: null,
              createdAt: { lte: cutoff },
            },
          ],
        },
        select: {
          id: true,
          title: true,
          releaseId: true,
          artist: true,
          createdAt: true,
          processingStatus: true,
          processingStartedAt: true,
          lastProgressAt: true,
          release: {
            select: {
              artistId: true,
            },
          },
        },
      });

      if (staleTracks.length === 0) {
        return;
      }

      const handledReleases = new Set<string>();
      for (const track of staleTracks as StaleTrack[]) {
        if (handledReleases.has(track.releaseId)) {
          continue;
        }
        handledReleases.add(track.releaseId);

        const error = this.buildTimeoutMessage(track, timeoutMs);
        this.logger.warn(
          `Marking release ${track.releaseId} failed because track ${track.id} is stale (${track.processingStatus})`,
        );
        this.eventBus.publish({
          eventName: "stems.failed",
          eventVersion: 1,
          occurredAt: new Date().toISOString(),
          releaseId: track.releaseId,
          artistId: track.release.artistId,
          error,
        });
      }
    } catch (err: any) {
      this.logger.error(`Stem watchdog sweep failed: ${err?.message || err}`);
    } finally {
      this.sweepInFlight = false;
    }
  }

  private buildTimeoutMessage(track: StaleTrack, timeoutMs: number) {
    const timeoutMinutes = Math.round(timeoutMs / 60000);
    const trackLabel = track.title || track.id;
    return `Stem separation timed out after ${timeoutMinutes} minute${timeoutMinutes === 1 ? "" : "s"} without worker progress for track "${trackLabel}" while status was "${track.processingStatus}".`;
  }

  private getTimeoutMs() {
    return this.parsePositiveInt(process.env.STEM_WATCHDOG_TIMEOUT_MS, DEFAULT_WATCHDOG_TIMEOUT_MS);
  }

  private getIntervalMs() {
    return this.parsePositiveInt(process.env.STEM_WATCHDOG_INTERVAL_MS, DEFAULT_WATCHDOG_INTERVAL_MS);
  }

  private parsePositiveInt(value: string | undefined, fallback: number) {
    const parsed = Number.parseInt(value || "", 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }
}
