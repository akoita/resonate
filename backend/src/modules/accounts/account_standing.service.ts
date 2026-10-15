import { Injectable, Logger } from "@nestjs/common";
import { AccountStatus, AccountStatusReason } from "@prisma/client";
import { prisma } from "../../db/prisma";

/** How long a status read is reused before the database is asked again. */
export const ACCOUNT_STATUS_CACHE_TTL_MS = 30_000;

export interface EffectiveAccountStatus {
  status: AccountStatus;
  reason: AccountStatusReason | null;
  /** Suspension end, ISO; null for an indefinite suspension or any other status. */
  until: string | null;
  changedAt: string | null;
}

const ACTIVE: EffectiveAccountStatus = { status: "active", reason: null, until: null, changedAt: null };

/**
 * The cached, read-only view of an account's operator state (#2147, #2167).
 *
 * It has no dependencies beyond the database, so any module can ask whether a
 * person is restricted without importing the whole account-status module (which
 * would close an import cycle through privacy and analytics). `AccountStatusService`
 * owns the changes and drops the cache entry the moment it makes one, so there
 * is a single cache and a single read path.
 *
 * - Reads are cached per user for ACCOUNT_STATUS_CACHE_TTL_MS.
 * - A suspension past `accountStatusUntil` counts as active on read (lazy
 *   expiry); the stored row is flipped back opportunistically.
 */
@Injectable()
export class AccountStandingService {
  private readonly logger = new Logger(AccountStandingService.name);
  private readonly cache = new Map<string, { value: EffectiveAccountStatus; expiresAt: number }>();

  async getEffective(userId: string, now: Date = new Date()): Promise<EffectiveAccountStatus> {
    const cached = this.cache.get(userId);
    if (cached && cached.expiresAt > now.getTime()) {
      return this.applyExpiry(cached.value, now);
    }
    const row = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        accountStatus: true,
        accountStatusReason: true,
        accountStatusUntil: true,
        accountStatusChangedAt: true,
      },
    });
    const value: EffectiveAccountStatus = row
      ? {
          status: row.accountStatus,
          reason: row.accountStatusReason,
          until: row.accountStatusUntil?.toISOString() ?? null,
          changedAt: row.accountStatusChangedAt?.toISOString() ?? null,
        }
      : ACTIVE;
    this.cache.set(userId, { value, expiresAt: now.getTime() + ACCOUNT_STATUS_CACHE_TTL_MS });
    return this.applyExpiry(value, now, true);
  }

  /**
   * True when the account is suspended or closed. Listening is allowed for such
   * an account but must not count: no play, playback fact, ranking or taste
   * signal comes from it (#2167). An anonymous or unknown id is not restricted.
   */
  async isRestricted(userId: string | null | undefined): Promise<boolean> {
    if (!userId) return false;
    return (await this.getEffective(userId)).status !== "active";
  }

  /** Drop a cached read; called on every change made by this process. */
  invalidate(userId: string) {
    this.cache.delete(userId);
  }

  /** Forget every cached read (tests, and a hard reset after a bulk change). */
  clearCache() {
    this.cache.clear();
  }

  private applyExpiry(value: EffectiveAccountStatus, now: Date, flip = false): EffectiveAccountStatus {
    if (value.status !== "suspended" || !value.until || new Date(value.until).getTime() > now.getTime()) {
      return value;
    }
    if (flip) void this.flipExpiredSuspensions(now);
    return ACTIVE;
  }

  /** Best effort: the read already treats an expired suspension as active. */
  private async flipExpiredSuspensions(now: Date) {
    try {
      await prisma.user.updateMany({
        where: { accountStatus: "suspended", accountStatusUntil: { lte: now } },
        data: {
          accountStatus: "active",
          accountStatusReason: null,
          accountStatusUntil: null,
          accountStatusChangedAt: now,
          accountStatusChangedBy: null,
        },
      });
    } catch (error) {
      this.logger.warn(`Could not persist suspension expiry: ${(error as Error).message}`);
    }
  }
}
