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
  private async publish(
    eventName:
      | "generation.credits_debited"
      | "generation.credits_insufficient"
      | "generation.credits_granted",
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
