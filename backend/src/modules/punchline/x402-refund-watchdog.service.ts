import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { prisma } from "../../db/prisma";
import { EventBus } from "../shared/event_bus";

/**
 * Stale `refund_due` watchdog (#1506).
 *
 * A verified paid Punchline collect that could not be fulfilled lands
 * `X402Settlement.status = "refund_due"` — the fan is owed an out-of-band
 * refund. That row is invisible until someone looks. This periodic sweep alerts
 * operators when a refund_due settlement sits unresolved past a threshold, so a
 * paid fan is never left waiting silently.
 *
 * Mirrors StemWatchdogService: env-configured interval, immediate first run,
 * re-entrancy guard, unref'd timer, and skips scheduling under NODE_ENV=test
 * (the sweep is still callable directly via runSweepOnce()). Publishes ONE
 * aggregate `x402.refund_due_stale` event per sweep — never one per row.
 */

const DEFAULT_ALERT_INTERVAL_MS = 15 * 60 * 1000;
const DEFAULT_ALERT_AFTER_HOURS = 2;
const MAX_SETTLEMENT_IDS = 20;

type StaleRefundRow = {
  id: string;
  createdAt: Date;
  canonicalAmountUsd: string | null;
};

@Injectable()
export class X402RefundWatchdogService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(X402RefundWatchdogService.name);
  private sweepInterval: NodeJS.Timeout | null = null;
  private sweepInFlight = false;

  constructor(private readonly eventBus: EventBus) {}

  onModuleInit() {
    if (process.env.NODE_ENV === "test") {
      return;
    }

    const intervalMs = this.getIntervalMs();
    const thresholdHours = this.getThresholdHours();
    this.logger.log(
      `Starting x402 refund_due watchdog (interval=${intervalMs}ms, threshold=${thresholdHours}h)`,
    );

    this.sweepInterval = setInterval(() => {
      void this.runSweepOnce();
    }, intervalMs);
    this.sweepInterval.unref?.();

    void this.runSweepOnce();
  }

  onModuleDestroy() {
    if (this.sweepInterval) {
      clearInterval(this.sweepInterval);
      this.sweepInterval = null;
    }
  }

  /**
   * One sweep: find `refund_due` settlements older than the threshold and, if
   * any exist, warn + publish one aggregate alert. Public so tests can drive it
   * without scheduling. Re-entrancy-guarded like the stem watchdog.
   */
  async runSweepOnce(): Promise<void> {
    if (this.sweepInFlight) {
      return;
    }
    this.sweepInFlight = true;
    try {
      const thresholdHours = this.getThresholdHours();
      const cutoff = new Date(Date.now() - thresholdHours * 60 * 60 * 1000);

      const stale = (await prisma.x402Settlement.findMany({
        where: { status: "refund_due", createdAt: { lt: cutoff } },
        orderBy: { createdAt: "asc" },
        select: { id: true, createdAt: true, canonicalAmountUsd: true },
      })) as StaleRefundRow[];

      if (stale.length === 0) {
        return;
      }

      const now = Date.now();
      const oldestAgeHours =
        Math.round(((now - stale[0].createdAt.getTime()) / (60 * 60 * 1000)) * 100) /
        100;
      const settlementIds = stale.slice(0, MAX_SETTLEMENT_IDS).map((r) => r.id);
      const totalAmountUsd = this.sumUsd(stale);

      this.logger.warn(
        `${stale.length} x402 refund_due settlement(s) unresolved past ${thresholdHours}h ` +
          `(oldest ${oldestAgeHours}h). Reconcile via the x402 refund runbook.`,
      );

      this.eventBus.publish({
        eventName: "x402.refund_due_stale",
        eventVersion: 1,
        occurredAt: new Date().toISOString(),
        outstandingCount: stale.length,
        oldestAgeHours,
        thresholdHours,
        settlementIds,
        ...(totalAmountUsd !== undefined ? { totalAmountUsd } : {}),
      });
    } catch (err: any) {
      this.logger.error(
        `x402 refund_due watchdog sweep failed: ${err?.message || err}`,
      );
    } finally {
      this.sweepInFlight = false;
    }
  }

  /** Sum canonical USD across rows; undefined when any row lacks a value. */
  private sumUsd(rows: StaleRefundRow[]): number | undefined {
    let total = 0;
    for (const row of rows) {
      if (row.canonicalAmountUsd === null) return undefined;
      const parsed = Number.parseFloat(row.canonicalAmountUsd);
      if (!Number.isFinite(parsed)) return undefined;
      total += parsed;
    }
    return Math.round(total * 100) / 100;
  }

  private getIntervalMs() {
    return this.parsePositiveInt(
      process.env.X402_REFUND_DUE_ALERT_INTERVAL_MS,
      DEFAULT_ALERT_INTERVAL_MS,
    );
  }

  private getThresholdHours() {
    return this.parsePositiveNumber(
      process.env.X402_REFUND_DUE_ALERT_AFTER_HOURS,
      DEFAULT_ALERT_AFTER_HOURS,
    );
  }

  private parsePositiveInt(value: string | undefined, fallback: number) {
    const parsed = Number.parseInt(value || "", 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }

  private parsePositiveNumber(value: string | undefined, fallback: number) {
    const parsed = Number.parseFloat(value || "");
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }
}
