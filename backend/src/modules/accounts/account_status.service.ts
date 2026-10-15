import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { AccountStatus, AccountStatusReason } from "@prisma/client";
import { parseEnvList } from "../../config/env";
import { prisma } from "../../db/prisma";
import { AuditService } from "../audit/audit.service";
import { NoticeService } from "../notifications/notice.service";
import { AccountClosureService } from "../privacy/account_closure.service";

export const ACCOUNT_STATUS_REASONS = [
  "terms_violation",
  "fraud",
  "abuse",
  "rights_infringement",
  "other",
] as const satisfies readonly AccountStatusReason[];

/** How long a status read is reused before the database is asked again. */
export const ACCOUNT_STATUS_CACHE_TTL_MS = 30_000;
export const ACCOUNT_NOTE_MAX = 1000;
/** A suspension may not be set further out than this; longer is a closure. */
export const SUSPENSION_MAX_DAYS = 365 * 2;

/** The article a restricted person is pointed to; it explains how to reach support. */
export const ACCOUNT_STATUS_HELP_PATH = "/help/account-suspension";

export interface EffectiveAccountStatus {
  status: AccountStatus;
  reason: AccountStatusReason | null;
  /** Suspension end, ISO; null for an indefinite suspension or any other status. */
  until: string | null;
  changedAt: string | null;
}

export interface AccountActor {
  userId: string;
  role?: string;
}

const REASON_LABELS: Record<AccountStatusReason, string> = {
  terms_violation: "a violation of the terms of service",
  fraud: "suspected fraud",
  abuse: "abusive behaviour",
  rights_infringement: "a rights infringement",
  other: "another reason covered by the terms of service",
};

const ACTIVE: EffectiveAccountStatus = { status: "active", reason: null, until: null, changedAt: null };

const STILL_WORKS =
  "You can still sign in, claim any refund you are owed, read your notices, and export or request erasure of your data.";
const APPEAL =
  "To appeal, contact Resonate support using the contact details in the Help section (there is no in-app appeal yet).";

function isPrivilegedAccount(userId: string): boolean {
  const id = userId.toLowerCase();
  return (
    parseEnvList(process.env.ADMIN_ADDRESSES, { lowercase: true }).includes(id)
    || parseEnvList(process.env.OPERATOR_ADDRESSES, { lowercase: true }).includes(id)
  );
}

/**
 * Operator account state (#2147): the one place that reads it for enforcement
 * and the only place that changes it.
 *
 * - `getEffective` is what `AccountStatusInterceptor` calls on every mutating
 *   request. Reads are cached per user for ACCOUNT_STATUS_CACHE_TTL_MS and the
 *   cache entry is dropped the moment this process changes the status, so a
 *   suspension takes effect immediately on the instance that applied it and
 *   within the TTL on any other instance.
 * - A suspension past `accountStatusUntil` counts as active on read (lazy
 *   expiry); the stored row is flipped back opportunistically.
 * - Every change is audited with who, target, action and reason category; the
 *   operator's free-text note goes into the audit record only, never into the
 *   notice the person receives.
 */
@Injectable()
export class AccountStatusService {
  private readonly logger = new Logger(AccountStatusService.name);
  private readonly cache = new Map<string, { value: EffectiveAccountStatus; expiresAt: number }>();

  constructor(
    private readonly audit: AuditService,
    private readonly notices: NoticeService,
    private readonly closures: AccountClosureService,
  ) {}

  // ============ Enforcement read ============

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

  // ============ Operator reads and changes ============

  /** The account behind an id or wallet address; 404 when neither matches. */
  async resolveTarget(idOrAddress: string): Promise<string> {
    const key = (idOrAddress ?? "").trim();
    if (!key) throw new BadRequestException("userId is required");
    const byId = await prisma.user.findUnique({ where: { id: key }, select: { id: true } });
    if (byId) return byId.id;
    const wallet = await prisma.wallet.findFirst({
      where: { address: { equals: key, mode: "insensitive" } },
      select: { userId: true },
    });
    if (wallet) return wallet.userId;
    throw new NotFoundException("Account not found");
  }

  async getStatus(idOrAddress: string) {
    const userId = await this.resolveTarget(idOrAddress);
    const row = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true,
        accountStatus: true,
        accountStatusReason: true,
        accountStatusUntil: true,
        accountStatusChangedAt: true,
        accountStatusChangedBy: true,
        wallet: { select: { address: true } },
      },
    });
    const effective = await this.getEffective(userId);
    const pendingClosure = await this.closures.findPending(userId);
    return {
      userId: row.id,
      walletAddress: row.wallet?.address ?? null,
      status: row.accountStatus,
      effectiveStatus: effective.status,
      reason: row.accountStatusReason,
      until: row.accountStatusUntil?.toISOString() ?? null,
      changedAt: row.accountStatusChangedAt?.toISOString() ?? null,
      changedBy: row.accountStatusChangedBy,
      erasureScheduledFor: pendingClosure?.dueAt.toISOString() ?? null,
    };
  }

  async suspend(
    actor: AccountActor,
    idOrAddress: string,
    input: { reason: unknown; until?: unknown; note?: unknown },
  ) {
    const reason = parseReason(input.reason);
    const until = parseUntil(input.until);
    const note = parseNote(input.note);
    const userId = await this.resolveTarget(idOrAddress);
    this.assertCanRestrict(actor, userId);

    const current = await this.currentStatus(userId);
    if (current === "closed") throw new ConflictException("Account is closed");

    const changedAt = new Date();
    await prisma.user.update({
      where: { id: userId },
      data: {
        accountStatus: "suspended",
        accountStatusReason: reason,
        accountStatusUntil: until,
        accountStatusChangedAt: changedAt,
        accountStatusChangedBy: actor.userId,
      },
    });
    this.invalidate(userId);

    this.record(actor, userId, "account.suspended", reason, changedAt, {
      until: until?.toISOString() ?? null,
      note,
    });
    await this.tell(userId, changedAt, {
      title: "Your account has been suspended",
      body: [
        `Your account has been suspended because of ${REASON_LABELS[reason]}.`,
        until
          ? `The suspension ends on ${until.toISOString().slice(0, 10)}.`
          : "The suspension has no end date yet.",
        STILL_WORKS,
        APPEAL,
      ].join(" "),
    });
    return this.getStatus(userId);
  }

  async unsuspend(actor: AccountActor, idOrAddress: string, input: { note?: unknown } = {}) {
    const note = parseNote(input.note);
    const userId = await this.resolveTarget(idOrAddress);
    this.assertCanRestrict(actor, userId);

    const current = await this.currentStatus(userId);
    if (current !== "suspended") throw new ConflictException("Account is not suspended");

    const changedAt = new Date();
    await prisma.user.update({
      where: { id: userId },
      data: {
        accountStatus: "active",
        accountStatusReason: null,
        accountStatusUntil: null,
        accountStatusChangedAt: changedAt,
        accountStatusChangedBy: actor.userId,
      },
    });
    this.invalidate(userId);

    this.record(actor, userId, "account.unsuspended", null, changedAt, { note });
    await this.tell(userId, changedAt, {
      title: "Your account is active again",
      body: "The suspension on your account has been lifted. You can use Resonate normally again.",
    });
    return this.getStatus(userId);
  }

  async close(
    actor: AccountActor,
    idOrAddress: string,
    input: { reason: unknown; note?: unknown; scheduleErasure?: unknown },
  ) {
    const reason = parseReason(input.reason);
    const note = parseNote(input.note);
    if (input.scheduleErasure !== undefined && typeof input.scheduleErasure !== "boolean") {
      throw new BadRequestException("scheduleErasure must be a boolean");
    }
    const scheduleErasure = input.scheduleErasure === true;
    const userId = await this.resolveTarget(idOrAddress);
    this.assertCanRestrict(actor, userId);

    const current = await this.currentStatus(userId);
    if (current === "closed") throw new ConflictException("Account is already closed");

    const changedAt = new Date();
    await prisma.user.update({
      where: { id: userId },
      data: {
        accountStatus: "closed",
        accountStatusReason: reason,
        accountStatusUntil: null,
        accountStatusChangedAt: changedAt,
        accountStatusChangedBy: actor.userId,
      },
    });
    this.invalidate(userId);

    // The same request path a self-service closure uses, with its normal grace
    // period; the existing due-erasure job then runs it.
    const closure = scheduleErasure
      ? await this.closures.request(userId, `operator closure: ${reason}`)
      : null;

    this.record(actor, userId, "account.closed", reason, changedAt, {
      note,
      scheduleErasure,
      erasureDueAt: closure?.dueAt.toISOString() ?? null,
    });
    await this.tell(userId, changedAt, {
      title: "Your account has been closed",
      body: [
        `Your account has been closed because of ${REASON_LABELS[reason]}.`,
        closure
          ? `Your personal data is scheduled to be erased on ${closure.dueAt.toISOString().slice(0, 10)}. Export what you need before then.`
          : "",
        STILL_WORKS,
        APPEAL,
      ]
        .filter(Boolean)
        .join(" "),
    });
    return this.getStatus(userId);
  }

  // ============ Internals ============

  /** Stored status straight from the database: transitions must not use a cached read. */
  private async currentStatus(userId: string): Promise<AccountStatus> {
    const row = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { accountStatus: true },
    });
    return row.accountStatus;
  }

  private assertCanRestrict(actor: AccountActor, targetUserId: string) {
    if (actor.userId === targetUserId) {
      throw new ForbiddenException("Operators cannot change the status of their own account");
    }
    if (isPrivilegedAccount(targetUserId)) {
      throw new ForbiddenException("Admin and operator accounts cannot be suspended or closed");
    }
  }

  private record(
    actor: AccountActor,
    userId: string,
    action: string,
    reason: AccountStatusReason | null,
    changedAt: Date,
    extra: Record<string, unknown>,
  ) {
    this.audit.log({
      action,
      actorId: actor.userId,
      resource: `account:${userId}`,
      metadata: { targetUserId: userId, reason, changedAt: changedAt.toISOString(), ...extra },
    });
  }

  /** One notice per change; the key makes a replay a no-op. Never carries the operator note. */
  private async tell(userId: string, changedAt: Date, message: { title: string; body: string }) {
    await this.notices.sendTargeted(
      {
        userIds: [userId],
        category: "account",
        title: message.title,
        body: message.body,
        link: ACCOUNT_STATUS_HELP_PATH,
      },
      { userId: "system:account-status" },
      { dedupeKey: `account_status:${userId}:${changedAt.toISOString()}` },
    );
  }
}

function parseReason(value: unknown): AccountStatusReason {
  if (typeof value !== "string" || !(ACCOUNT_STATUS_REASONS as readonly string[]).includes(value)) {
    throw new BadRequestException(`reason must be one of: ${ACCOUNT_STATUS_REASONS.join(", ")}`);
  }
  return value as AccountStatusReason;
}

function parseUntil(value: unknown): Date | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw new BadRequestException("until must be an ISO date");
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new BadRequestException("until must be an ISO date");
  const now = Date.now();
  if (date.getTime() <= now) throw new BadRequestException("until must be in the future");
  if (date.getTime() > now + SUSPENSION_MAX_DAYS * 86_400_000) {
    throw new BadRequestException(`until must be within ${SUSPENSION_MAX_DAYS} days; use a closure instead`);
  }
  return date;
}

function parseNote(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.length > ACCOUNT_NOTE_MAX) {
    throw new BadRequestException(`note must be a string of at most ${ACCOUNT_NOTE_MAX} characters`);
  }
  return value.trim() || null;
}
