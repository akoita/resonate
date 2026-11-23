/**
 * The in-app withdrawal function (#2594, Directive 2023/2673 amending the
 * Consumer Rights Directive, in force since 2026-06-19). ADR-BM-6 revenue
 * line 2 (Artist Pro, generation credits), Phase 2: compliance and trust
 * before live charging. No fee, split or price change (ADR-BM-4 unaffected).
 *
 * What can be withdrawn from here, and only while the right lasts:
 * - **Artist Pro** within 14 days of the first paid invoice of a subscription
 *   that is still running. Artist Pro ends at once (cancelled at Stripe, no
 *   renewal) and the price is refunded less the service received: the larger
 *   of the share of the period passed and the share of its generation
 *   allowance used (`proratedRefundCents`).
 * - **A credit pack still on its 14-day hold** ("Wait 14 days" at checkout).
 *   It is refunded in full; the held credits are never released (the release
 *   checks for a withdrawal) and the `charge.refunded` webhook cancels them.
 * Not here: purchases delivered at once (the right has ended), on-chain and
 * agent purchases, and held stem, licence and Punchline purchases, which are
 * paid on-chain and keep the written route in the refund policy for now.
 *
 * The flow: `GET /billing/withdrawals` lists what can be withdrawn with the
 * labels (`withdrawal_labels.ts`); `POST /billing/withdrawals` takes the
 * statement (name, contract) after a separate, bare confirmation in the app.
 * The withdrawal is recorded once per contract, acknowledged at once with a
 * `purchase` notice (emailed to a confirmed contact address) that repeats the
 * statement and the UTC time, and the refund starts straight away.
 *
 * Logs carry ids and codes only: never the name typed in the statement.
 */

import { ConflictException, Inject, Injectable, Optional } from "@nestjs/common";
import { Prisma, type ContractWithdrawal } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { NoticeService } from "../notifications/notice.service";
import { WITHDRAWAL_PERIOD_MS } from "../purchase_consent/purchase_consent.constants";
import { writeStructuredLog } from "../shared/structured_logging";
import { PLAN_LABELS } from "./billing.service";
import { DEFAULT_BILLING_CURRENCY, formatMoney, isBillingCurrency } from "./billing_currency";
import { creditPackLabel, findCreditPack } from "./credit_packs";
import type { SubmitWithdrawalDto } from "./contract_withdrawal.dto";
import { STRIPE_GATEWAY, type StripeGateway } from "./stripe_gateway";
import { SubscriptionCancellationPendingError, SubscriptionLifecycleService } from "./subscription_lifecycle.service";
import { WITHDRAWAL_LABELS, type WithdrawalLabels } from "./withdrawal_labels";
import { processWithdrawalRefund, proratedRefundCents } from "./withdrawal_refunds";

export const WITHDRAWAL_CONTRACTS = ["artist_pro", "credit_topup"] as const;
export type WithdrawalContract = (typeof WITHDRAWAL_CONTRACTS)[number];

export const WITHDRAWAL_NOTICE_ACTOR = { userId: "system:contract-withdrawal" } as const;
export const WITHDRAWAL_NOTICE_LINK = "/settings?section=usage";

export const WITHDRAWAL_ERROR_CODES = {
  notAvailable: "withdrawal_not_available",
  nameRequired: "withdrawal_name_required",
} as const;

/** Statuses of a subscription that still runs (and can still be withdrawn from). */
const RUNNING = ["active", "trialing", "past_due"] as const;

export type WithdrawableContractView = {
  contract: WithdrawalContract;
  subjectId: string;
  label: string;
  /** When the contract was bought, and when the right to withdraw ends (ISO, UTC). */
  boughtAt: string;
  rightEndsAt: string;
  currency: string;
  paidCents: number;
  /** What would be refunded if the person withdrew now. */
  refundCents: number;
};

export type WithdrawalView = {
  id: string;
  contract: string;
  label: string;
  withdrawnAt: string;
  currency: string;
  refundCents: number;
  /** pending | refunded | failed | not_needed */
  refundStatus: string;
};

export type WithdrawalState = {
  labels: WithdrawalLabels;
  /** Where the acknowledgement goes besides the notices: a masked confirmed address, or null. */
  confirmationEmail: string | null;
  contracts: WithdrawableContractView[];
  /** The person's past withdrawals, newest first. */
  withdrawals: WithdrawalView[];
};

/** "a•••@example.com": enough to recognise the address, not to read it out. */
export function maskEmail(address: string): string {
  const at = address.lastIndexOf("@");
  if (at <= 0) return "•••";
  return `${address[0]}•••${address.slice(at)}`;
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function utcStamp(date: Date): string {
  return `${date.toISOString().slice(0, 10)} at ${date.toISOString().slice(11, 19)} UTC`;
}

function toView(row: ContractWithdrawal): WithdrawalView {
  return {
    id: row.id,
    contract: row.contract,
    label: row.contractLabel,
    withdrawnAt: row.withdrawnAt.toISOString(),
    currency: row.currency,
    refundCents: row.refundCents,
    refundStatus: row.refundStatus,
  };
}

@Injectable()
export class ContractWithdrawalService {
  constructor(
    private readonly notices: NoticeService,
    private readonly lifecycle: SubscriptionLifecycleService,
    @Optional() @Inject(STRIPE_GATEWAY) private readonly gateway: StripeGateway | null = null,
  ) {}

  /** What the person can withdraw from right now (a right that has ended is not listed). */
  async listWithdrawable(userId: string, now: Date = new Date()): Promise<WithdrawableContractView[]> {
    const out: WithdrawableContractView[] = [];

    const subscription = await prisma.subscription.findUnique({ where: { userId } });
    if (
      subscription?.stripeSubscriptionId &&
      (RUNNING as readonly string[]).includes(subscription.status) &&
      !subscription.endRequestedAt
    ) {
      // The right runs from the start of the contract: the first paid invoice of this subscription.
      const first = await prisma.subscriptionInvoice.findFirst({
        where: { subscriptionId: subscription.id, stripeSubscriptionId: subscription.stripeSubscriptionId },
        orderBy: { paidAt: "asc" },
      });
      if (first && first.amountPaidCents > 0) {
        const rightEndsAt = new Date(first.paidAt.getTime() + WITHDRAWAL_PERIOD_MS);
        const done = await prisma.contractWithdrawal.count({ where: { contract: "artist_pro", subjectId: first.id } });
        if (now.getTime() < rightEndsAt.getTime() && done === 0) {
          // The allowance that invoice granted (one slice a month, twelve for a year), and how much was used.
          const grants = await prisma.generationAllowanceGrant.aggregate({
            where: { stripeInvoiceId: first.stripeInvoiceId },
            _sum: { amountCents: true, consumedCents: true },
          });
          out.push({
            contract: "artist_pro",
            subjectId: first.id,
            label: PLAN_LABELS[subscription.interval],
            boughtAt: first.paidAt.toISOString(),
            rightEndsAt: rightEndsAt.toISOString(),
            currency: first.currency,
            paidCents: first.amountPaidCents,
            refundCents: proratedRefundCents({
              paidCents: first.amountPaidCents,
              periodStart: first.periodStart,
              periodEnd: first.periodEnd,
              at: now,
              allowance: {
                grantedCents: grants._sum.amountCents ?? 0,
                consumedCents: grants._sum.consumedCents ?? 0,
              },
            }),
          });
        }
      }
    }

    const packs = await prisma.creditTopUp.findMany({
      where: {
        userId,
        status: "held",
        heldUntil: { gt: now },
        disputes: { none: { status: { in: ["open", "lost"] } } },
      },
      orderBy: { paidAt: "asc" },
    });
    if (packs.length > 0) {
      const withdrawn = new Set(
        (
          await prisma.contractWithdrawal.findMany({
            where: { contract: "credit_topup", subjectId: { in: packs.map((p) => p.id) } },
            select: { subjectId: true },
          })
        ).map((w) => w.subjectId),
      );
      for (const pack of packs) {
        if (withdrawn.has(pack.id) || !pack.heldUntil) continue;
        const known = findCreditPack(pack.packId);
        const currency = isBillingCurrency(pack.currency) ? pack.currency : DEFAULT_BILLING_CURRENCY;
        const paidCents = Math.max(0, (pack.amountTotalCents ?? pack.priceCents) - pack.refundedAmountCents);
        out.push({
          contract: "credit_topup",
          subjectId: pack.id,
          label: known ? creditPackLabel(known, currency) : "Credit pack",
          boughtAt: pack.paidAt.toISOString(),
          rightEndsAt: pack.heldUntil.toISOString(),
          currency: pack.currency,
          paidCents,
          refundCents: paidCents,
        });
      }
    }
    return out;
  }

  async getState(userId: string, now: Date = new Date()): Promise<WithdrawalState> {
    const [contracts, contact, rows] = await Promise.all([
      this.listWithdrawable(userId, now),
      prisma.contactEmail.findUnique({ where: { userId }, select: { status: true, address: true } }),
      prisma.contractWithdrawal.findMany({ where: { userId }, orderBy: { withdrawnAt: "desc" }, take: 20 }),
    ]);
    return {
      labels: WITHDRAWAL_LABELS,
      confirmationEmail: contact?.status === "confirmed" ? maskEmail(contact.address) : null,
      contracts,
      withdrawals: rows.map(toView),
    };
  }

  /**
   * Record one withdrawal and start its refund. Pressing twice records it
   * once: a contract already withdrawn answers with that withdrawal.
   */
  async withdraw(userId: string, dto: SubmitWithdrawalDto, now: Date = new Date()): Promise<WithdrawalView> {
    const name = dto.name.trim().replace(/\s+/g, " ");
    if (!name) {
      throw new ConflictException({ code: WITHDRAWAL_ERROR_CODES.nameRequired, message: "Enter your name." });
    }
    const existing = await prisma.contractWithdrawal.findUnique({
      where: { contract_subjectId: { contract: dto.contract, subjectId: dto.subjectId } },
    });
    if (existing) {
      if (existing.userId !== userId) throw this.notAvailable();
      return toView(existing);
    }

    const offer = (await this.listWithdrawable(userId, now)).find(
      (c) => c.contract === dto.contract && c.subjectId === dto.subjectId,
    );
    if (!offer) throw this.notAvailable();

    let row: ContractWithdrawal;
    try {
      row = await prisma.contractWithdrawal.create({
        data: {
          userId,
          contract: offer.contract,
          subjectId: offer.subjectId,
          contractLabel: offer.label,
          statementName: name,
          labelsVersion: WITHDRAWAL_LABELS.version,
          withdrawnAt: now,
          currency: offer.currency,
          paidCents: offer.paidCents,
          refundCents: offer.refundCents,
          refundStatus: offer.refundCents > 0 ? "pending" : "not_needed",
        },
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const raced = await prisma.contractWithdrawal.findUniqueOrThrow({
        where: { contract_subjectId: { contract: dto.contract, subjectId: dto.subjectId } },
      });
      return toView(raced);
    }
    writeStructuredLog({
      level: "info",
      event: "billing.contract_withdrawn",
      message: "billing.contract_withdrawn",
      withdrawalId: row.id,
      contract: row.contract,
    });

    await this.acknowledge(row);

    if (row.contract === "artist_pro") {
      try {
        await this.lifecycle.endForAccount(userId, "contract_withdrawal", now);
      } catch (error) {
        // Recorded on the subscription row; the retention job retries the cancellation.
        if (!(error instanceof SubscriptionCancellationPendingError)) throw error;
      }
    }
    await processWithdrawalRefund(this.gateway, row, now);
    const current = await prisma.contractWithdrawal.findUniqueOrThrow({ where: { id: row.id } });
    return toView(current);
  }

  private notAvailable(): ConflictException {
    return new ConflictException({
      code: WITHDRAWAL_ERROR_CODES.notAvailable,
      message: "This contract can no longer be withdrawn from here. Write to us at the contact address in our refund policy.",
    });
  }

  /** The acknowledgement on a durable medium: a `purchase` notice, emailed to a confirmed contact address. */
  private async acknowledge(row: ContractWithdrawal): Promise<void> {
    const refund = formatMoney(row.refundCents, row.currency);
    const refundLine =
      row.contract === "artist_pro"
        ? WITHDRAWAL_LABELS.refundArtistPro.replace("{refund}", refund)
        : WITHDRAWAL_LABELS.refundCreditPack.replace("{refund}", refund);
    const body =
      "We received your withdrawal statement:\n" +
      `"I, ${row.statementName}, withdraw from my contract for ${row.contractLabel}."\n` +
      `Received on ${utcStamp(row.withdrawnAt)}.\n\n` +
      refundLine +
      " If the refund does not reach your card within 14 days, write to us at the contact address in our refund policy.";
    try {
      await this.notices.sendTargeted(
        { userIds: [row.userId], category: "purchase", title: WITHDRAWAL_LABELS.doneTitle, body, link: WITHDRAWAL_NOTICE_LINK },
        WITHDRAWAL_NOTICE_ACTOR,
        { dedupeKey: `contract-withdrawal:${row.id}` },
      );
    } catch (error) {
      // The withdrawal is recorded and listed in Usage & Billing either way.
      writeStructuredLog({
        level: "error",
        event: "billing.withdrawal_notice_failed",
        message: "billing.withdrawal_notice_failed",
        withdrawalId: row.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
