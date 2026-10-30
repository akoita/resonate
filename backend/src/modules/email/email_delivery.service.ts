import { Inject, Injectable, Optional } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { AuthService } from "../auth/auth.service";
import { isEmailRequiredCategory } from "../notifications/notice_validation";
import { writeStructuredLog } from "../shared/structured_logging";
import { ContactEmailService, normalizeAddress } from "./contact_email.service";
import { EmailConfig } from "./email_config";
import { renderNoticeEmail } from "./email_templates";
import { EMAIL_TRANSPORT, PermanentEmailError, emailErrorCode, type EmailTransport } from "./email_transport";

export const EMAIL_FAN_OUT_NOTICE_LIMIT = 100;
export const EMAIL_SEND_LIMIT = 200;
export const EMAIL_FAN_OUT_BATCH = 500;
/** Delay before attempt N+2 after attempt N+1 failed: 5m, 30m, 2h, 12h. */
export const EMAIL_RETRY_BACKOFF_MS = [5 * 60_000, 30 * 60_000, 2 * 3_600_000, 12 * 3_600_000] as const;
export const EMAIL_MAX_ATTEMPTS = 5;
/** A claimed delivery that never finishes (a crashed job) becomes due again after this. */
export const EMAIL_CLAIM_LEASE_MS = 10 * 60_000;
export const EMAIL_DELIVERY_RETENTION_DAYS = 180;
export const EMAIL_PRUNE_BATCH = 1000;
export const EMAIL_PRUNE_MAX_BATCHES = 5;
const SEND_CONCURRENCY = 2;

export interface EmailDeliveryRunResult {
  dryRun: boolean;
  /** False when email is not configured on this deployment: nothing was done. */
  enabled: boolean;
  fannedOutNotices: number;
  /**
   * Broadcast notices whose role audience could not be resolved because the
   * allowlist it depends on is empty on this deployment (see `email.deliveries.audience_unresolvable`).
   */
  audienceUnresolvable: number;
  queued: number;
  /** Rows that were due to send at the start of the send phase. */
  due: number;
  sent: number;
  failed: number;
  suppressed: number;
  bounced: number;
  pruned: number;
}

export interface EmailWebhookEvent {
  type: "bounce" | "complaint";
  email: string;
  bounceType?: "hard" | "soft";
}

type NoticeForFanOut = { id: string; category: string; recipientUserId: string | null; audience: string; expiresAt: Date | null };

/** A user whose id or wallet (smart account or owner) address is on the list. */
function allowlistWhere(addresses: string[]): Prisma.UserWhereInput | null {
  if (addresses.length === 0) return null;
  return {
    OR: [
      { id: { in: addresses } },
      { wallet: { is: { address: { in: addresses } } } },
      { wallet: { is: { AND: [{ ownerAddress: { not: null } }, { ownerAddress: { in: addresses } }] } } },
    ],
  };
}

/**
 * The email outbox (#2169): fan notices out into one `EmailDelivery` row per
 * confirmed recipient, send due rows, and prune old ones. It is drained by a
 * scheduled job (`run_email_deliveries.ts`), not by an in-process queue,
 * because the API scales to zero.
 *
 * - **Fan-out** expands each un-fanned notice once. Targeted notices go to
 *   their recipient; broadcasts to the audience a person would see in-app
 *   (the same audience names and the same allowlists). Only people with a
 *   confirmed contact address, not erased, whose category is required or not
 *   opted out. The unique `(noticeId, userId)` key makes a replay a no-op.
 * - **Send** re-checks eligibility at send time, so an opt-out or removal
 *   between fan-out and send suppresses the email.
 * - Content is rendered from the notice at send time. Logs carry counts and
 *   error classes only: never addresses, tokens or bodies.
 */
@Injectable()
export class EmailDeliveryService {
  constructor(
    private readonly config: EmailConfig,
    @Optional() @Inject(EMAIL_TRANSPORT) private readonly transport: EmailTransport | null,
    private readonly contacts: ContactEmailService,
  ) {}

  async run(options: { dryRun?: boolean; limit?: number; now?: Date } = {}): Promise<EmailDeliveryRunResult> {
    const dryRun = options.dryRun === true;
    const result: EmailDeliveryRunResult = {
      dryRun,
      enabled: this.config.isAvailable() && this.transport !== null,
      fannedOutNotices: 0,
      audienceUnresolvable: 0,
      queued: 0,
      due: 0,
      sent: 0,
      failed: 0,
      suppressed: 0,
      bounced: 0,
      pruned: 0,
    };
    if (!result.enabled) return result;

    const fan = await this.fanOut({ dryRun, now: options.now });
    result.fannedOutNotices = fan.notices;
    result.queued = fan.queued;
    result.audienceUnresolvable = fan.audienceUnresolvable;

    // A fresh clock: rows queued by the fan-out above are due immediately.
    const sendResult = await this.sendDue({ dryRun, limit: options.limit ?? EMAIL_SEND_LIMIT, now: options.now });
    result.due = sendResult.due;
    result.sent = sendResult.sent;
    result.failed = sendResult.failed;
    result.suppressed = sendResult.suppressed;
    result.bounced = sendResult.bounced;

    result.pruned = await this.prune({ dryRun, now: options.now });
    return result;
  }

  // ============ Fan-out ============

  async fanOut(options: { dryRun?: boolean; now?: Date; noticeLimit?: number } = {}) {
    const now = options.now ?? new Date();
    const notices = await prisma.notice.findMany({
      where: { emailFannedOutAt: null },
      orderBy: { createdAt: "asc" },
      take: options.noticeLimit ?? EMAIL_FAN_OUT_NOTICE_LIMIT,
      select: { id: true, category: true, recipientUserId: true, audience: true, expiresAt: true },
    });

    let queued = 0;
    let audienceUnresolvable = 0;
    const unresolvableAudiences = new Set<string>();
    for (const notice of notices) {
      const expired = notice.recipientUserId === null && notice.expiresAt !== null && notice.expiresAt <= now;
      if (!expired) {
        if (this.audienceIsUnresolvable(notice)) {
          audienceUnresolvable += 1;
          unresolvableAudiences.add(notice.audience);
        }
        queued += await this.fanOutNotice(notice, options.dryRun === true);
      }
      if (!options.dryRun) {
        await prisma.notice.update({ where: { id: notice.id }, data: { emailFannedOutAt: new Date() } });
      }
    }
    if (audienceUnresolvable > 0) {
      // One line per run, counts and audience names only (never an address): a
      // job missing its role allowlists would otherwise look like "no recipients".
      writeStructuredLog({
        level: "warn",
        event: "email.deliveries.audience_unresolvable",
        message:
          "Broadcast notices target a role audience whose allowlist is empty on this deployment, so the audience cannot be resolved",
        notices: audienceUnresolvable,
        audiences: [...unresolvableAudiences].sort(),
      });
    }
    return { notices: notices.length, queued, audienceUnresolvable };
  }

  /**
   * True when a broadcast's role audience depends on allowlists that are all
   * empty here: `role:admin` / `role:operator` would match nobody, and
   * `role:listener` (everyone who is not an allowlisted admin, operator or
   * agent) would not exclude anyone.
   */
  private audienceIsUnresolvable(notice: NoticeForFanOut): boolean {
    if (notice.recipientUserId) return false;
    const empty = (role: "admin" | "operator" | "agent") => AuthService.allowlistedAddresses(role).length === 0;
    switch (notice.audience) {
      case "role:admin":
        return empty("admin");
      case "role:operator":
        return empty("operator");
      case "role:listener":
        return empty("admin") && empty("operator") && empty("agent");
      default:
        return false;
    }
  }

  private recipientWhere(notice: NoticeForFanOut): Prisma.ContactEmailWhereInput {
    const and: Prisma.UserWhereInput[] = [{ erasedAt: null }];
    if (notice.recipientUserId) {
      and.push({ id: notice.recipientUserId });
    } else {
      const audience = notice.audience;
      const admin = AuthService.allowlistedAddresses("admin");
      const operator = AuthService.allowlistedAddresses("operator");
      const agent = AuthService.allowlistedAddresses("agent");
      if (audience === "role:artist") {
        and.push({ artist: { isNot: null } });
      } else if (audience === "role:admin") {
        and.push(allowlistWhere(admin) ?? { id: { in: [] } });
      } else if (audience === "role:operator") {
        // Admin wins at sign-in, so an address on both lists is an admin session.
        and.push(allowlistWhere(operator) ?? { id: { in: [] } });
        const adminWhere = allowlistWhere(admin);
        if (adminWhere) and.push({ NOT: adminWhere });
      } else if (audience === "role:listener") {
        // Mirrors the in-app audience: any session that is not a privileged role (artists sign in as listeners).
        for (const list of [admin, operator, agent]) {
          const where = allowlistWhere(list);
          if (where) and.push({ NOT: where });
        }
      } else if (audience !== "all") {
        and.push({ id: { in: [] } });
      }
    }

    const where: Prisma.ContactEmailWhereInput = { status: "confirmed", user: { AND: and } };
    if (!isEmailRequiredCategory(notice.category)) {
      where.NOT = { emailOptOuts: { has: notice.category } };
    }
    return where;
  }

  private async fanOutNotice(notice: NoticeForFanOut, dryRun: boolean): Promise<number> {
    const where = this.recipientWhere(notice);
    if (dryRun) return prisma.contactEmail.count({ where });

    let queued = 0;
    let cursor: string | undefined;
    for (;;) {
      const batch = await prisma.contactEmail.findMany({
        where,
        select: { id: true, userId: true },
        orderBy: { id: "asc" },
        take: EMAIL_FAN_OUT_BATCH,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      if (batch.length === 0) break;
      const created = await prisma.emailDelivery.createMany({
        data: batch.map((row) => ({
          noticeId: notice.id,
          userId: row.userId,
          category: notice.category,
          status: "queued",
          // The app's clock, not the database's, so the send phase sees the rows as due.
          nextAttemptAt: new Date(),
        })),
        skipDuplicates: true,
      });
      queued += created.count;
      if (batch.length < EMAIL_FAN_OUT_BATCH) break;
      cursor = batch[batch.length - 1].id;
    }
    return queued;
  }

  // ============ Sending ============

  async sendDue(options: { dryRun?: boolean; limit?: number; now?: Date } = {}) {
    const now = options.now ?? new Date();
    const counts = { due: 0, sent: 0, failed: 0, suppressed: 0, bounced: 0 };
    const rows = await prisma.emailDelivery.findMany({
      where: { status: "queued", nextAttemptAt: { lte: now } },
      orderBy: { nextAttemptAt: "asc" },
      take: options.limit ?? EMAIL_SEND_LIMIT,
    });
    counts.due = rows.length;
    if (options.dryRun) return counts;

    let next = 0;
    const worker = async () => {
      while (next < rows.length) {
        const row = rows[next++];
        await this.sendOne(row, counts);
      }
    };
    await Promise.all(Array.from({ length: Math.min(SEND_CONCURRENCY, rows.length) }, worker));
    return counts;
  }

  private async sendOne(
    row: { id: string; noticeId: string; userId: string; category: string; attempts: number; nextAttemptAt: Date },
    counts: { sent: number; failed: number; suppressed: number; bounced: number },
  ) {
    // Lease the row so an overlapping run cannot send it twice.
    const claimed = await prisma.emailDelivery.updateMany({
      where: { id: row.id, status: "queued", nextAttemptAt: row.nextAttemptAt },
      data: { nextAttemptAt: new Date(Date.now() + EMAIL_CLAIM_LEASE_MS) },
    });
    if (claimed.count !== 1) return;

    const [notice, contact] = await Promise.all([
      prisma.notice.findUnique({ where: { id: row.noticeId } }),
      prisma.contactEmail.findUnique({ where: { userId: row.userId } }),
    ]);
    const optedOut = contact?.emailOptOuts.includes(row.category) && !isEmailRequiredCategory(row.category);
    const expired = notice && notice.recipientUserId === null && notice.expiresAt !== null && notice.expiresAt <= new Date();
    if (!notice || !contact || contact.status !== "confirmed" || optedOut || expired) {
      await prisma.emailDelivery.update({ where: { id: row.id }, data: { status: "suppressed" } });
      counts.suppressed += 1;
      return;
    }

    const message = renderNoticeEmail(
      {
        userId: row.userId,
        to: contact.address,
        category: notice.category,
        title: notice.title,
        body: notice.body,
        link: notice.link,
      },
      this.config,
    );

    try {
      const sent = await this.transport!.send(message);
      await prisma.emailDelivery.update({
        where: { id: row.id },
        data: {
          status: "sent",
          sentAt: new Date(),
          attempts: row.attempts + 1,
          providerMessageId: sent.messageId || null,
          lastErrorClass: null,
        },
      });
      counts.sent += 1;
    } catch (error) {
      const attempts = row.attempts + 1;
      const lastErrorClass = emailErrorCode(error);
      if (error instanceof PermanentEmailError) {
        await prisma.emailDelivery.update({
          where: { id: row.id },
          data: { status: "failed", attempts, lastErrorClass },
        });
        await this.contacts.disableAddresses({ id: contact.id }, "hard_bounce");
        counts.failed += 1;
        counts.bounced += 1;
        return;
      }
      if (attempts >= EMAIL_MAX_ATTEMPTS) {
        await prisma.emailDelivery.update({
          where: { id: row.id },
          data: { status: "failed", attempts, lastErrorClass },
        });
        counts.failed += 1;
        return;
      }
      await prisma.emailDelivery.update({
        where: { id: row.id },
        data: {
          status: "queued",
          attempts,
          lastErrorClass,
          nextAttemptAt: new Date(Date.now() + EMAIL_RETRY_BACKOFF_MS[attempts - 1]),
        },
      });
    }
  }

  // ============ Retention ============

  /** Delete delivery-log rows older than 180 days, a bounded amount per run. */
  async prune(options: { dryRun?: boolean; now?: Date } = {}): Promise<number> {
    const now = options.now ?? new Date();
    const cutoff = new Date(now.getTime() - EMAIL_DELIVERY_RETENTION_DAYS * 86_400_000);
    if (options.dryRun) return prisma.emailDelivery.count({ where: { createdAt: { lt: cutoff } } });

    let pruned = 0;
    for (let i = 0; i < EMAIL_PRUNE_MAX_BATCHES; i++) {
      const ids = await prisma.emailDelivery.findMany({
        where: { createdAt: { lt: cutoff } },
        select: { id: true },
        take: EMAIL_PRUNE_BATCH,
      });
      if (ids.length === 0) break;
      const deleted = await prisma.emailDelivery.deleteMany({ where: { id: { in: ids.map((r) => r.id) } } });
      pruned += deleted.count;
      if (ids.length < EMAIL_PRUNE_BATCH) break;
    }
    return pruned;
  }

  // ============ Provider events ============

  /**
   * Apply normalized bounce/complaint events. A hard bounce or complaint
   * disables the matching address; soft bounces (and a bounce with no type,
   * which is treated as soft) change nothing.
   */
  async handleProviderEvents(events: EmailWebhookEvent[]) {
    let disabled = 0;
    let ignored = 0;
    for (const event of events) {
      const hard = event.type === "complaint" || (event.type === "bounce" && event.bounceType === "hard");
      if (!hard) {
        ignored += 1;
        continue;
      }
      disabled += await this.contacts.disableAddresses(
        { addressNormalized: normalizeAddress(event.email) },
        event.type === "complaint" ? "complaint" : "hard_bounce",
      );
    }
    writeStructuredLog({
      level: "info",
      event: "email.webhook_processed",
      message: "Processed email provider events",
      received: events.length,
      disabled,
      ignored,
    });
    return { received: events.length, disabled, ignored };
  }
}
