import { Injectable } from "@nestjs/common";
import { prisma } from "../../db/prisma";
import { writeStructuredLog } from "../shared/structured_logging";

/** Activity is recorded at most about once per person per this long (#2166). */
export const USER_ACTIVITY_WRITE_INTERVAL_MS = 60 * 60 * 1000;
/** Bound on the per-process memory of recent writes. */
export const USER_ACTIVITY_CACHE_MAX = 50_000;

/**
 * Bounded "last active" tracking for account administration (#2166).
 *
 * Operational data under legitimate interest, not analytics: it is read only by
 * operators, shown to the day, and cleared on erasure. `touch` is called by a
 * global interceptor on every authenticated request, so it must stay cheap:
 *
 * - a per-process map skips a person written within the last hour, and
 * - the write itself is guarded in the database (`lastActiveAt` null or older
 *   than an hour), so many instances still write at most about once an hour
 *   per person.
 *
 * It never throws into the request: a failure is logged at `warn` without the
 * user id and the request carries on.
 */
@Injectable()
export class UserActivityService {
  private readonly lastWrittenMs = new Map<string, number>();

  /** Fire-and-forget: record that this person was active just now. */
  touch(userId: string, now: Date = new Date()): Promise<void> {
    if (!userId) return Promise.resolve();
    const nowMs = now.getTime();
    const last = this.lastWrittenMs.get(userId);
    if (last !== undefined && nowMs - last < USER_ACTIVITY_WRITE_INTERVAL_MS) {
      return Promise.resolve();
    }
    this.remember(userId, nowMs);
    return this.write(userId, now);
  }

  /**
   * Sign-in: stamp `lastSignInAt` and `lastActiveAt` in one update and seed the
   * touch cache so the first request after sign-in does not write again.
   * Never throws; a failure must not block sign-in.
   */
  async recordSignIn(userId: string, now: Date = new Date()): Promise<void> {
    if (!userId) return;
    try {
      await prisma.user.updateMany({
        where: { id: userId },
        data: { lastSignInAt: now, lastActiveAt: now },
      });
      this.remember(userId, now.getTime());
    } catch (error) {
      this.warn("accounts.user_activity.sign_in_failed", "Could not record the sign-in time", error);
    }
  }

  /** Forget every remembered write (tests). */
  clearCache() {
    this.lastWrittenMs.clear();
  }

  private async write(userId: string, now: Date): Promise<void> {
    try {
      const staleBefore = new Date(now.getTime() - USER_ACTIVITY_WRITE_INTERVAL_MS);
      await prisma.user.updateMany({
        where: {
          id: userId,
          OR: [{ lastActiveAt: null }, { lastActiveAt: { lt: staleBefore } }],
        },
        data: { lastActiveAt: now },
      });
    } catch (error) {
      // Forget the attempt so the next request retries instead of waiting an hour.
      this.lastWrittenMs.delete(userId);
      this.warn("accounts.user_activity.touch_failed", "Could not record account activity", error);
    }
  }

  private remember(userId: string, nowMs: number) {
    if (this.lastWrittenMs.size >= USER_ACTIVITY_CACHE_MAX) {
      // Evict the oldest entries (a Map iterates in insertion order) by a tenth.
      const drop = Math.ceil(USER_ACTIVITY_CACHE_MAX * 0.1);
      let dropped = 0;
      for (const key of this.lastWrittenMs.keys()) {
        this.lastWrittenMs.delete(key);
        if (++dropped >= drop) break;
      }
    }
    this.lastWrittenMs.delete(userId);
    this.lastWrittenMs.set(userId, nowMs);
  }

  private warn(event: string, message: string, error: unknown) {
    // Deliberately no user id: the log must not become a second activity record.
    writeStructuredLog({ level: "warn", event, message, error });
  }
}
