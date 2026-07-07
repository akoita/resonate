import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  Optional,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { prisma } from "../../db/prisma";
import { EventBus } from "../shared/event_bus";
import type { ResonateEvent } from "../../events/event_types";

/**
 * Default sell price for AI generation, in USD cents per 30 seconds (#1334,
 * ADR-BM-3). Baseline internal cost is ~$0.06/30s (COST_PER_30_SECONDS in the
 * generation service, deliberately left untouched); 10¢ sells at ~40% margin.
 * Tunable via the GENERATION_PRICE_CENTS_PER_30S env var.
 */
export const DEFAULT_GENERATION_PRICE_CENTS_PER_30S = 10;

/**
 * One-time free starter allowance, in USD cents, provisioned the first time an
 * account is touched (#1334 onboarding). Default 0 = disabled, so production and
 * every existing test see the hard operator-grant-only wall unchanged; staging
 * sets GENERATION_CREDITS_SIGNUP_STARTER_CENTS (100¢ ≈ 5 min of generation at
 * the ADR-BM-3 price) so new users can try the generation→ownership funnel
 * before the meter charges. This is a customer-acquisition free tier, not a
 * subsidy of any fan→artist payout — ADR-BM-4 red lines are untouched.
 */
export const DEFAULT_SIGNUP_STARTER_CENTS = 0;

/** Ledger reason marker for the one-time signup starter grant. */
export const SIGNUP_STARTER_REASON = "signup_starter";

/** kind discriminator carried on debit/insufficient analytics events. */
export type GenerationCreditKind = "lyria" | "remix_draft";

/**
 * Raised when a user has too few credits to cover a generation. Maps to HTTP
 * 402 Payment Required — the app registers no global exception filter that
 * normalizes status codes, so the 402 reaches the client verbatim (mirrors the
 * x402 controller, which already returns 402 for unpaid resource access).
 */
export class InsufficientCreditsException extends HttpException {
  constructor(
    readonly userId: string,
    readonly requiredCents: number,
    readonly balanceCents: number,
  ) {
    super(
      {
        statusCode: HttpStatus.PAYMENT_REQUIRED,
        error: "InsufficientCredits",
        message:
          "Not enough generation credits. Ask an operator for a promo grant " +
          "or wait until credit top-ups are available.",
        requiredCents,
        balanceCents,
      },
      HttpStatus.PAYMENT_REQUIRED,
    );
  }
}

export interface GenerationCreditBalance {
  balanceCents: number;
  recentTransactions: Array<{
    id: string;
    type: string;
    amountCents: number;
    reason: string;
    jobId: string | null;
    balanceAfterCents: number;
    createdAt: Date;
  }>;
}

/**
 * The generation-credit meter (#1334). Credits are USD cents (integer money —
 * never float), owned per userId (the generating artist). Every movement lands
 * in the append-only GenerationCreditTransaction ledger; GenerationCreditAccount
 * caches the balance.
 *
 * Staging scope is the meter only: credits enter exclusively via the operator/
 * promo `grant` path. Live fiat top-up is the deferred production flip. This is
 * a cost+margin tool meter, entirely separate from the fan→artist transaction
 * split — the 85%+ artist share (ADR-BM-4) is untouched.
 */
@Injectable()
export class GenerationCreditsService {
  private readonly logger = new Logger(GenerationCreditsService.name);
  private readonly priceCentsPer30s: number;
  private readonly signupStarterCents: number;

  constructor(
    @Optional() private readonly configService?: ConfigService,
    @Optional() private readonly eventBus?: EventBus,
  ) {
    const raw = this.configService?.get<string | number>(
      "GENERATION_PRICE_CENTS_PER_30S",
      DEFAULT_GENERATION_PRICE_CENTS_PER_30S,
    );
    const parsed = typeof raw === "string" ? parseInt(raw, 10) : raw;
    this.priceCentsPer30s =
      Number.isFinite(parsed) && (parsed as number) > 0
        ? (parsed as number)
        : DEFAULT_GENERATION_PRICE_CENTS_PER_30S;

    const starterRaw = this.configService?.get<string | number>(
      "GENERATION_CREDITS_SIGNUP_STARTER_CENTS",
      DEFAULT_SIGNUP_STARTER_CENTS,
    );
    const starterParsed =
      typeof starterRaw === "string" ? parseInt(starterRaw, 10) : starterRaw;
    this.signupStarterCents =
      Number.isFinite(starterParsed) && (starterParsed as number) > 0
        ? Math.floor(starterParsed as number)
        : DEFAULT_SIGNUP_STARTER_CENTS;
  }

  /**
   * Provision the one-time free starter allowance the first time an account is
   * touched (balance read or first debit). Idempotent and race-safe: the
   * account row's primary key (userId) guarantees at-most-once — the account is
   * *created* already carrying the starter balance, so any account that already
   * exists (starter already given, operator-funded, or funded-then-spent) is
   * left untouched. Disabled when the starter is 0. Never throws into callers —
   * a provisioning hiccup must not break a balance read or block a generation.
   */
  async ensureSignupStarter(
    userId: string,
  ): Promise<{ granted: boolean; balanceCents: number }> {
    const starterCents = this.signupStarterCents;
    if (starterCents <= 0) {
      return { granted: false, balanceCents: 0 };
    }
    try {
      const result = await prisma.$transaction(async (tx) => {
        const existing = await tx.generationCreditAccount.findUnique({
          where: { userId },
          select: { balanceCents: true },
        });
        if (existing) {
          return { granted: false, balanceCents: existing.balanceCents };
        }
        const account = await tx.generationCreditAccount.create({
          data: { userId, balanceCents: starterCents },
        });
        await tx.generationCreditTransaction.create({
          data: {
            userId,
            type: "grant",
            amountCents: starterCents,
            reason: SIGNUP_STARTER_REASON,
            balanceAfterCents: account.balanceCents,
          },
        });
        return { granted: true, balanceCents: account.balanceCents };
      });
      if (result.granted) {
        this.logger.log(
          `Granted ${starterCents}¢ signup starter to user ${userId}; balance=${result.balanceCents}¢`,
        );
        await this.publish("generation.credits_granted", {
          userId,
          amountCents: starterCents,
          reason: SIGNUP_STARTER_REASON,
        });
      }
      return result;
    } catch (error) {
      // A concurrent first-touch created the account first (unique-key clash on
      // userId) — the starter was already granted by that path. Any other error
      // must still not break the caller.
      if ((error as { code?: string })?.code === "P2002") {
        const account = await prisma.generationCreditAccount.findUnique({
          where: { userId },
        });
        return { granted: false, balanceCents: account?.balanceCents ?? 0 };
      }
      this.logger.warn(
        `Signup starter provisioning failed for ${userId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { granted: false, balanceCents: 0 };
    }
  }

  /**
   * Cost of a generation in USD cents: ceil((durationSeconds / 30) * price).
   * A generation always costs at least one 30s block.
   */
  costForDurationCents(durationSeconds: number): number {
    const seconds =
      Number.isFinite(durationSeconds) && durationSeconds > 0
        ? durationSeconds
        : 30;
    return Math.ceil((seconds / 30) * this.priceCentsPer30s);
  }

  async getBalance(userId: string): Promise<GenerationCreditBalance> {
    // Provision the free starter on first balance read (e.g. the Create page
    // loading) so a brand-new account shows its allowance instead of a bare 0.
    await this.ensureSignupStarter(userId);
    const [account, recentTransactions] = await Promise.all([
      prisma.generationCreditAccount.findUnique({ where: { userId } }),
      prisma.generationCreditTransaction.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: 20,
      }),
    ]);
    return {
      balanceCents: account?.balanceCents ?? 0,
      recentTransactions: recentTransactions.map((txn) => ({
        id: txn.id,
        type: txn.type,
        amountCents: txn.amountCents,
        reason: txn.reason,
        jobId: txn.jobId,
        balanceAfterCents: txn.balanceAfterCents,
        createdAt: txn.createdAt,
      })),
    };
  }

  /**
   * Add credits (operator/promo path — the only way credits enter on staging).
   * Upserts the account, increments the balance, and appends a `grant` txn.
   */
  async grant(
    userId: string,
    amountCents: number,
    reason: string,
  ): Promise<number> {
    if (!Number.isInteger(amountCents) || amountCents <= 0) {
      throw new HttpException(
        { statusCode: HttpStatus.BAD_REQUEST, message: "amountCents must be a positive integer" },
        HttpStatus.BAD_REQUEST,
      );
    }

    const balanceAfterCents = await prisma.$transaction(async (tx) => {
      const account = await tx.generationCreditAccount.upsert({
        where: { userId },
        create: { userId, balanceCents: amountCents },
        update: { balanceCents: { increment: amountCents } },
      });
      await tx.generationCreditTransaction.create({
        data: {
          userId,
          type: "grant",
          amountCents,
          reason,
          balanceAfterCents: account.balanceCents,
        },
      });
      return account.balanceCents;
    });

    this.logger.log(
      `Granted ${amountCents}¢ to user ${userId} (${reason}); balance=${balanceAfterCents}¢`,
    );
    await this.publish("generation.credits_granted", {
      userId,
      amountCents,
      reason,
    });
    return balanceAfterCents;
  }

  /**
   * Charge credits for a generation. Race-safe: a single atomic conditional
   * `updateMany` guarded by `balanceCents >= amount` decrements the balance and
   * asserts exactly one row changed. Concurrent debits that together exceed the
   * balance therefore cannot oversell — the losing update matches zero rows and
   * throws InsufficientCreditsException. On success, appends a `debit` txn with
   * the post-debit balance. The whole read+write runs in a $transaction.
   */
  async debit(
    userId: string,
    amountCents: number,
    reason: string,
    jobId?: string,
    kind: GenerationCreditKind = "lyria",
  ): Promise<number> {
    if (!Number.isInteger(amountCents) || amountCents <= 0) {
      throw new HttpException(
        { statusCode: HttpStatus.BAD_REQUEST, message: "amountCents must be a positive integer" },
        HttpStatus.BAD_REQUEST,
      );
    }

    // Self-provision the free starter before the first-ever debit so a new
    // user's first generation succeeds instead of hitting the 0-credit wall.
    // Idempotent: no-op once the account exists.
    await this.ensureSignupStarter(userId);

    let balanceAfterCents: number;
    try {
      balanceAfterCents = await prisma.$transaction(async (tx) => {
        const updated = await tx.generationCreditAccount.updateMany({
          where: { userId, balanceCents: { gte: amountCents } },
          data: { balanceCents: { decrement: amountCents } },
        });

        if (updated.count !== 1) {
          const account = await tx.generationCreditAccount.findUnique({
            where: { userId },
          });
          throw new InsufficientCreditsException(
            userId,
            amountCents,
            account?.balanceCents ?? 0,
          );
        }

        const account = await tx.generationCreditAccount.findUniqueOrThrow({
          where: { userId },
        });
        await tx.generationCreditTransaction.create({
          data: {
            userId,
            type: "debit",
            amountCents,
            reason,
            jobId: jobId ?? null,
            balanceAfterCents: account.balanceCents,
          },
        });
        return account.balanceCents;
      });
    } catch (error) {
      if (error instanceof InsufficientCreditsException) {
        this.logger.warn(
          `Insufficient credits: user ${userId} needs ${amountCents}¢, has ${error.balanceCents}¢ (${reason})`,
        );
        await this.publish("generation.credits_insufficient", {
          userId,
          requiredCents: amountCents,
          balanceCents: error.balanceCents,
          kind,
        });
      }
      throw error;
    }

    this.logger.log(
      `Debited ${amountCents}¢ from user ${userId} (${reason}, job=${jobId ?? "n/a"}); balance=${balanceAfterCents}¢`,
    );
    await this.publish("generation.credits_debited", {
      userId,
      amountCents,
      jobId: jobId ?? null,
      kind,
    });
    return balanceAfterCents;
  }

  /**
   * Restore credits for a debited generation that terminally failed or never
   * enqueued. Idempotent per jobId: if a `refund` txn already exists for the
   * jobId, this is a no-op so a double-refund can never inflate the balance.
   * Returns the resulting balance (or the current balance when skipped).
   */
  async refund(
    userId: string,
    amountCents: number,
    reason: string,
    jobId?: string,
  ): Promise<number> {
    if (!Number.isInteger(amountCents) || amountCents <= 0) {
      throw new HttpException(
        { statusCode: HttpStatus.BAD_REQUEST, message: "amountCents must be a positive integer" },
        HttpStatus.BAD_REQUEST,
      );
    }

    const balanceAfterCents = await prisma.$transaction(async (tx) => {
      if (jobId) {
        const existing = await tx.generationCreditTransaction.findFirst({
          where: { userId, jobId, type: "refund" },
        });
        if (existing) {
          const account = await tx.generationCreditAccount.findUnique({
            where: { userId },
          });
          return account?.balanceCents ?? existing.balanceAfterCents;
        }
      }

      const account = await tx.generationCreditAccount.upsert({
        where: { userId },
        create: { userId, balanceCents: amountCents },
        update: { balanceCents: { increment: amountCents } },
      });
      await tx.generationCreditTransaction.create({
        data: {
          userId,
          type: "refund",
          amountCents,
          reason,
          jobId: jobId ?? null,
          balanceAfterCents: account.balanceCents,
        },
      });
      return account.balanceCents;
    });

    this.logger.log(
      `Refunded ${amountCents}¢ to user ${userId} (${reason}, job=${jobId ?? "n/a"}); balance=${balanceAfterCents}¢`,
    );
    return balanceAfterCents;
  }

  /**
   * Emit a metering analytics event through the ingest pipeline. These are
   * `personal`-tier (they carry userId), so they declare a consentBasis, and
   * the amounts stay off the fan→artist ledger. Failures are swallowed:
   * analytics must never block or fail a generation.
   */
  /**
   * A user out of credits asks an operator to top them up (#1334). Publishes a
   * `generation.credits_requested` domain event — the NotificationService fans
   * it out to operator in-app notifications, and the analytics bridge records
   * it. Publish failures are swallowed: a request must never 500 on the user.
   */
  async requestOperatorCredits(userId: string, note?: string): Promise<void> {
    const trimmed = note?.trim();
    await this.publish("generation.credits_requested", {
      userId,
      ...(trimmed ? { note: trimmed } : {}),
    });
    this.logger.log(
      `Credit request from user ${userId}${trimmed ? ` (note: ${trimmed})` : ""}`,
    );
  }

  private async publish(
    eventName:
      | "generation.credits_debited"
      | "generation.credits_insufficient"
      | "generation.credits_granted"
      | "generation.credits_requested",
    payload: Record<string, unknown>,
  ): Promise<void> {
    if (!this.eventBus) {
      return;
    }
    try {
      // Emit as a domain event; the analytics domain-event bridge forwards it
      // to the ingest pipeline (see analytics_domain_event_bridge.service.ts).
      // This keeps CreditsModule off the heavyweight AnalyticsModule (which
      // pulls in Agents/GenerationModule and would form an import cycle) and
      // depending only on SharedModule's EventBus, per shared_event_bus.spec.ts.
      this.eventBus.publish({
        eventName,
        eventVersion: 1,
        occurredAt: new Date().toISOString(),
        ...payload,
      } as unknown as ResonateEvent);
    } catch (error) {
      this.logger.warn(
        `Failed to publish ${eventName}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
