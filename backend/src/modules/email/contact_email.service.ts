import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from "@nestjs/common";
import { prisma } from "../../db/prisma";
import { NoticeService } from "../notifications/notice.service";
import {
  EMAIL_REQUIRED_NOTICE_CATEGORIES,
  NOTICE_CATEGORIES,
  NoticeCategory,
  isEmailRequiredCategory,
} from "../notifications/notice_validation";
import { writeStructuredLog } from "../shared/structured_logging";
import { EmailConfig } from "./email_config";
import { renderConfirmationEmail } from "./email_templates";
import { CONFIRM_TOKEN_TTL_MS, newConfirmToken, sha256Hex, verifyUnsubscribeToken } from "./email_tokens";
import { EMAIL_TRANSPORT, type EmailTransport } from "./email_transport";

export type ContactEmailStatus = "none" | "pending" | "confirmed" | "disabled";
export type ContactEmailDisabledReason = "hard_bounce" | "complaint";

export interface ContactEmailState {
  available: boolean;
  address: string | null;
  status: ContactEmailStatus;
  disabledReason: ContactEmailDisabledReason | null;
  confirmationSentAt: string | null;
  categories: Array<{ category: NoticeCategory; required: boolean; enabled: boolean }>;
}

/** Confirmation mail must not hold a request open longer than this. */
export const CONFIRMATION_SEND_TIMEOUT_MS = 10_000;

/** At least this long between two confirmation emails for one account. */
export const CONFIRMATION_COOLDOWN_MS = 60_000;
/** At most this many confirmation emails per account in a rolling window. */
export const CONFIRMATION_MAX_PER_WINDOW = 5;
export const CONFIRMATION_WINDOW_MS = 24 * 60 * 60 * 1000;

const EMAIL_ACTOR = { userId: "system:email-delivery" };

export function normalizeAddress(address: string): string {
  return address.trim().toLowerCase();
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("timeout")), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

type ContactRow = NonNullable<Awaited<ReturnType<typeof prisma.contactEmail.findUnique>>>;

export function categoriesFor(optOuts: readonly string[]): ContactEmailState["categories"] {
  return NOTICE_CATEGORIES.map((category) => {
    const required = isEmailRequiredCategory(category);
    return { category, required, enabled: required || !optOuts.includes(category) };
  });
}

/**
 * The person's optional notice-email address (#2169), double opt-in.
 *
 * It is separate from `User.email` (a placeholder for wallet accounts) and is
 * used only for platform notices. An address receives nothing until the person
 * confirms it from a link that is mailed to it; changing the address starts
 * over and kills the old link. Required categories (terms, account) cannot be
 * turned off; the rest can.
 *
 * Nothing here logs an address or a token.
 */
@Injectable()
export class ContactEmailService {
  /** The clock used by the confirmation limiter. Replaceable in tests. */
  clock: () => Date = () => new Date();

  constructor(
    private readonly config: EmailConfig,
    @Optional() @Inject(EMAIL_TRANSPORT) private readonly transport: EmailTransport | null,
    private readonly notices: NoticeService,
  ) {}

  // ============ Reading ============

  async getState(userId: string): Promise<ContactEmailState> {
    const row = await prisma.contactEmail.findUnique({ where: { userId } });
    return this.toState(row);
  }

  private toState(row: ContactRow | null): ContactEmailState {
    return {
      available: this.config.isAvailable(),
      address: row?.address ?? null,
      status: (row?.status as ContactEmailStatus | undefined) ?? "none",
      disabledReason: (row?.disabledReason as ContactEmailDisabledReason | null | undefined) ?? null,
      confirmationSentAt: row?.confirmationSentAt?.toISOString() ?? null,
      categories: categoriesFor(row?.emailOptOuts ?? []),
    };
  }

  // ============ Setting, confirming, removing ============

  /**
   * Set or change the address and mail a confirmation. The same address that
   * is already confirmed is a no-op. If the confirmation cannot be sent the
   * row stays `pending` so "resend" can retry.
   */
  async setAddress(userId: string, address: string): Promise<ContactEmailState> {
    this.requireAvailable();
    const trimmed = address.trim();
    const normalized = normalizeAddress(trimmed);

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, erasedAt: true } });
    if (!user || user.erasedAt) throw new NotFoundException("Account not found");

    const existing = await prisma.contactEmail.findUnique({ where: { userId } });
    if (existing && existing.addressNormalized === normalized && existing.status === "confirmed") {
      return this.toState(existing);
    }

    // This will mail an address the person typed, so it counts against their limit.
    await this.reserveConfirmationSend(userId);

    const token = newConfirmToken();
    const now = new Date();
    const reset = {
      address: trimmed,
      addressNormalized: normalized,
      status: "pending",
      confirmTokenHash: token.hash,
      confirmTokenExpiresAt: new Date(now.getTime() + CONFIRM_TOKEN_TTL_MS),
      confirmationSentAt: null,
      confirmedAt: null,
      disabledAt: null,
      disabledReason: null,
    };
    // Opt-outs deliberately survive an address change (they are not in `reset`).
    const row = await prisma.contactEmail.upsert({
      where: { userId },
      create: { userId, ...reset },
      update: reset,
    });
    return this.sendConfirmation(row, token.raw);
  }

  /** Mail a fresh confirmation (and token) for a pending address. 409 otherwise. */
  async resend(userId: string): Promise<ContactEmailState> {
    this.requireAvailable();
    const row = await prisma.contactEmail.findUnique({ where: { userId } });
    if (!row || row.status !== "pending") {
      throw new ConflictException({ code: "not_pending", message: "There is no pending address to confirm" });
    }
    await this.reserveConfirmationSend(userId);
    const token = newConfirmToken();
    const updated = await prisma.contactEmail.update({
      where: { id: row.id },
      data: {
        confirmTokenHash: token.hash,
        confirmTokenExpiresAt: new Date(Date.now() + CONFIRM_TOKEN_TTL_MS),
      },
    });
    return this.sendConfirmation(updated, token.raw);
  }

  /**
   * Per-account limit on confirmation emails: a cooldown of 60 seconds and at
   * most 5 per rolling 24 hours. The counters live on `User`, so removing and
   * re-adding the address does not reset them. A confirmation goes to an address
   * the person merely typed, so without this one account could make us mail
   * strangers.
   *
   * This is in the service, not just `@Throttle`, because the global
   * `ThrottlerGuard` runs before the route's `AuthGuard("jwt")` (Nest runs
   * global guards first), so `req.user` is unset when it picks a tracker and the
   * per-user `getTracker` falls back to the IP. The `@Throttle` limits on the
   * controller are therefore a per-IP second layer, not a per-account limit.
   *
   * Throws 429 `{ code: "email_rate_limited", retryAfterSeconds }`.
   */
  private async reserveConfirmationSend(userId: string): Promise<void> {
    const now = this.clock();
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { confirmationSendCount: true, confirmationWindowStartedAt: true, lastConfirmationSentAt: true },
    });
    if (!user) throw new NotFoundException("Account not found");

    const windowOpen =
      user.confirmationWindowStartedAt !== null &&
      now.getTime() - user.confirmationWindowStartedAt.getTime() < CONFIRMATION_WINDOW_MS;
    const count = windowOpen ? user.confirmationSendCount : 0;
    const windowStart = windowOpen ? user.confirmationWindowStartedAt! : now;

    if (user.lastConfirmationSentAt) {
      const sinceLast = now.getTime() - user.lastConfirmationSentAt.getTime();
      if (sinceLast >= 0 && sinceLast < CONFIRMATION_COOLDOWN_MS) {
        throw rateLimited(CONFIRMATION_COOLDOWN_MS - sinceLast);
      }
    }
    if (count >= CONFIRMATION_MAX_PER_WINDOW) {
      throw rateLimited(windowStart.getTime() + CONFIRMATION_WINDOW_MS - now.getTime());
    }

    // Optimistic update on the values just read, so two parallel requests cannot both pass.
    const reserved = await prisma.user.updateMany({
      where: {
        id: userId,
        confirmationSendCount: user.confirmationSendCount,
        lastConfirmationSentAt: user.lastConfirmationSentAt,
      },
      data: { confirmationSendCount: count + 1, confirmationWindowStartedAt: windowStart, lastConfirmationSentAt: now },
    });
    if (reserved.count !== 1) throw rateLimited(1_000);
  }

  private async sendConfirmation(row: ContactRow, rawToken: string): Promise<ContactEmailState> {
    try {
      await withTimeout(
        this.transport!.send(renderConfirmationEmail(row.address, rawToken, this.config)),
        CONFIRMATION_SEND_TIMEOUT_MS,
      );
    } catch (error) {
      writeStructuredLog({
        level: "warn",
        event: "email.confirmation_send_failed",
        message: "Could not send an email confirmation",
        errorClass: error instanceof Error ? error.name : "unknown",
      });
      throw new BadGatewayException({
        code: "email_send_failed",
        message: "We could not send the confirmation email. Try again in a moment.",
      });
    }
    const updated = await prisma.contactEmail.update({
      where: { id: row.id },
      data: { confirmationSentAt: new Date() },
    });
    return this.toState(updated);
  }

  /** Delete the person's address and all of its preferences. Idempotent. */
  async remove(userId: string): Promise<void> {
    await prisma.contactEmail.deleteMany({ where: { userId } });
  }

  /**
   * Confirm from the emailed link. The token is single use and expires after
   * 24 hours; an address change replaces its hash so older links stop working.
   */
  async confirm(token: unknown): Promise<{ status: "confirmed" }> {
    if (typeof token !== "string" || token.length < 16 || token.length > 256) throw invalidOrExpired();
    const now = new Date();
    const result = await prisma.contactEmail.updateMany({
      where: {
        confirmTokenHash: sha256Hex(token),
        status: "pending",
        confirmTokenExpiresAt: { gt: now },
      },
      data: {
        status: "confirmed",
        confirmedAt: now,
        confirmTokenHash: null,
        confirmTokenExpiresAt: null,
      },
    });
    if (result.count !== 1) throw invalidOrExpired();
    return { status: "confirmed" };
  }

  // ============ Preferences ============

  async setPreferences(userId: string, optOuts: unknown): Promise<ContactEmailState> {
    if (!Array.isArray(optOuts) || optOuts.some((c) => typeof c !== "string")) {
      throw new BadRequestException("optOuts must be an array of category names");
    }
    const unique = Array.from(new Set(optOuts as string[]));
    for (const category of unique) {
      if (!NOTICE_CATEGORIES.includes(category as NoticeCategory)) {
        throw new BadRequestException(`Unknown notice category: ${category.slice(0, 40)}`);
      }
      if (isEmailRequiredCategory(category)) {
        throw new BadRequestException({
          code: "required_category",
          message: `${EMAIL_REQUIRED_NOTICE_CATEGORIES.join(" and ")} notices are required and cannot be turned off`,
        });
      }
    }
    const row = await prisma.contactEmail.findUnique({ where: { userId }, select: { id: true } });
    if (!row) throw new ConflictException({ code: "no_contact_email", message: "Add an email address first" });
    const updated = await prisma.contactEmail.update({ where: { id: row.id }, data: { emailOptOuts: unique } });
    return this.toState(updated);
  }

  /**
   * Turn one optional category off from a signed unsubscribe link. Idempotent;
   * a removed address is a harmless success. Required categories are never
   * issued a link, so a token naming one is rejected.
   */
  async unsubscribe(token: unknown): Promise<{ category: NoticeCategory; status: "unsubscribed" }> {
    const claims = verifyUnsubscribeToken(token, this.config.linkSigningSecret);
    if (
      !claims ||
      !NOTICE_CATEGORIES.includes(claims.category as NoticeCategory) ||
      isEmailRequiredCategory(claims.category)
    ) {
      throw new BadRequestException({ code: "invalid", message: "This link is not valid" });
    }
    const row = await prisma.contactEmail.findUnique({ where: { userId: claims.userId } });
    if (row && !row.emailOptOuts.includes(claims.category)) {
      await prisma.contactEmail.update({
        where: { id: row.id },
        data: { emailOptOuts: [...row.emailOptOuts, claims.category] },
      });
    }
    return { category: claims.category as NoticeCategory, status: "unsubscribed" };
  }

  // ============ Bounces and complaints ============

  /**
   * Disable the pending/confirmed address(es) that match, and tell each person
   * once in-app (`account`, keyed on the address row and the disable time).
   * Returns how many addresses were disabled.
   */
  async disableAddresses(
    where: { id: string } | { addressNormalized: string },
    reason: ContactEmailDisabledReason,
  ): Promise<number> {
    const rows = await prisma.contactEmail.findMany({
      where: { ...where, status: { in: ["pending", "confirmed"] } },
      select: { id: true, userId: true },
    });
    let disabled = 0;
    for (const row of rows) {
      const disabledAt = new Date();
      const result = await prisma.contactEmail.updateMany({
        where: { id: row.id, status: { in: ["pending", "confirmed"] } },
        data: {
          status: "disabled",
          disabledAt,
          disabledReason: reason,
          confirmTokenHash: null,
          confirmTokenExpiresAt: null,
        },
      });
      if (result.count !== 1) continue;
      disabled += 1;
      try {
        await this.notices.sendTargeted(
          {
            userIds: [row.userId],
            category: "account",
            title: "Your notice email address stopped working",
            body:
              reason === "complaint"
                ? "A message to the email address you added for platform notices was reported as unwanted, so we stopped sending to it. Add or change the address in Settings to get notices by email again. Your notices in the app are not affected."
                : "Emails to the address you added for platform notices were refused, so we stopped sending to it. Add or change the address in Settings to get notices by email again. Your notices in the app are not affected.",
            link: "/settings",
          },
          EMAIL_ACTOR,
          { dedupeKey: `email_disabled:${row.id}:${disabledAt.toISOString()}` },
        );
      } catch (error) {
        writeStructuredLog({
          level: "error",
          event: "email.disabled_notice_failed",
          message: "Could not send the in-app notice about a disabled email address",
          errorClass: error instanceof Error ? error.name : "unknown",
        });
      }
    }
    return disabled;
  }

  private requireAvailable(): void {
    if (!this.config.isAvailable() || !this.transport) {
      throw new ServiceUnavailableException({
        code: "email_unavailable",
        message: "Email notices are not available on this deployment",
      });
    }
  }
}

function rateLimited(retryAfterMs: number): HttpException {
  const retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
  return new HttpException(
    {
      code: "email_rate_limited",
      message: "Too many confirmation emails. Try again later.",
      retryAfterSeconds,
    },
    429,
  );
}

function invalidOrExpired(): BadRequestException {
  return new BadRequestException({ code: "invalid_or_expired", message: "This link is invalid or has expired" });
}
