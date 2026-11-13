/**
 * Card disputes (chargebacks) reported by Stripe (#2596). ADR-BM-6 revenue
 * line 2 (creator tools, generation credits), Phase 2: loss prevention before
 * live charging. No fee, split or price is changed (ADR-BM-4 unaffected).
 *
 * The refund policy says: "If you dispute a payment with your bank instead of
 * asking us for a refund, we may pause the plan or the credits it paid for
 * while the dispute is open. If the bank refunds you, we remove what that
 * payment bought."
 *
 * For a **credit pack**:
 * - **Open** (`needs_response`, `under_review`): the disputed share of the
 *   pack's credits still in the balance is taken out (`top_up_dispute_hold`,
 *   never below zero; credits already used stay used). A pack still on its
 *   14-day hold simply stays held.
 * - **Won** (`won`, `warning_closed`, `prevented`): the paused credits go back
 *   (`top_up_dispute_release`), and a held pack can be released again.
 * - **Lost**: the paused credits stay out, and a held pack releases without
 *   the disputed share.
 * - **Inquiry** (`warning_needs_response`, `warning_under_review`): the bank
 *   is only asking and no money has moved, so nothing is paused. The row is
 *   recorded and becomes open if the inquiry turns into a dispute.
 *
 * A dispute over any other payment (an Artist Pro invoice) is recorded for
 * the reconciliation report and changes nothing else yet.
 *
 * Idempotent and order-safe: one `StripeDispute` row per Stripe dispute id,
 * locked while an event is applied. `won` and `lost` are final: a late or
 * replayed `created` never reopens a closed dispute, and a `closed` that
 * arrives first is applied on its own.
 *
 * Logs carry ids, codes and amounts only: never an email, a card detail or a
 * payload.
 */

import { Injectable } from "@nestjs/common";
import { Prisma, type CreditTopUp, type StripeDispute } from "@prisma/client";
import { prisma } from "../../db/prisma";
import {
  TOP_UP_DISPUTE_HOLD_REASON,
  TOP_UP_DISPUTE_RELEASE_REASON,
  creditTopUpInTx,
  reverseTopUpInTx,
} from "../credits/top_up_ledger";
import { NoticeService } from "../notifications/notice.service";
import { writeStructuredLog } from "../shared/structured_logging";
import { formatMoney } from "./billing_currency";
import { creditPackLabel, findCreditPack, formatUsd } from "./credit_packs";
import { DEFAULT_BILLING_CURRENCY, isBillingCurrency } from "./billing_currency";
import type { StripeDisputeObject } from "./stripe_gateway";

export const HANDLED_DISPUTE_EVENTS = [
  "charge.dispute.created",
  "charge.dispute.updated",
  "charge.dispute.funds_withdrawn",
  "charge.dispute.funds_reinstated",
  "charge.dispute.closed",
] as const;

export type DisputeState = "inquiry" | "open" | "won" | "lost";

export const DISPUTE_NOTICE_CATEGORY = "refund" as const;
export const DISPUTE_NOTICE_ACTOR = { userId: "system:stripe-dispute" } as const;
export const DISPUTE_NOTICE_LINK = "/settings?section=usage";

const SAFE_CODE = /^[a-z0-9_]{1,64}$/;

function idOf(value: unknown): string | null {
  if (typeof value === "string" && value) return value;
  if (value && typeof value === "object" && typeof (value as { id?: unknown }).id === "string") {
    return (value as { id: string }).id || null;
  }
  return null;
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function log(level: "info" | "warn" | "error", event: string, fields: Record<string, unknown>) {
  writeStructuredLog({ level, event, message: event, ...fields });
}

/** Our state for a Stripe dispute status. Anything unknown counts as open: the bank has the money. */
export function disputeStateFrom(status: unknown): DisputeState {
  switch (status) {
    case "won":
    case "warning_closed":
    case "prevented":
      return "won";
    case "lost":
      return "lost";
    case "warning_needs_response":
    case "warning_under_review":
      return "inquiry";
    default:
      return "open";
  }
}

/** Money moved for a dispute, from its balance transactions (minor units, all non-negative except the fee net). */
export function disputeMoney(dispute: Pick<StripeDisputeObject, "balance_transactions">): {
  withdrawnCents: number;
  reinstatedCents: number;
  feeCents: number;
} {
  let withdrawnCents = 0;
  let reinstatedCents = 0;
  let feeCents = 0;
  for (const entry of dispute.balance_transactions ?? []) {
    const amount = typeof entry?.amount === "number" ? Math.trunc(entry.amount) : 0;
    if (amount < 0) withdrawnCents += -amount;
    else reinstatedCents += amount;
    if (typeof entry?.fee === "number") feeCents += Math.trunc(entry.fee);
  }
  return { withdrawnCents, reinstatedCents, feeCents };
}

/** The share of a pack's credits a disputed amount covers: all of it when the whole charge is disputed. */
export function disputedCreditsShare(input: { creditsCents: number; disputedCents: number; chargedCents: number }): number {
  if (input.disputedCents <= 0) return 0;
  if (input.chargedCents <= 0 || input.disputedCents >= input.chargedCents) return input.creditsCents;
  return Math.min(input.creditsCents, Math.floor((input.creditsCents * input.disputedCents) / input.chargedCents));
}

type Transition = "opened" | "won" | "lost" | null;

@Injectable()
export class StripeDisputeService {
  constructor(private readonly notices: NoticeService) {}

  /** Apply one `charge.dispute.*` event. Returns a short outcome code for the webhook log. */
  async apply(dispute: StripeDisputeObject, eventCreatedAt: Date = new Date()): Promise<string> {
    const stripeDisputeId = idOf(dispute);
    if (!stripeDisputeId || typeof dispute.amount !== "number" || typeof dispute.currency !== "string") {
      return "ignored_unparseable";
    }
    const paymentIntentId = idOf(dispute.payment_intent);
    const topUp = paymentIntentId
      ? await prisma.creditTopUp.findUnique({ where: { stripePaymentIntentId: paymentIntentId } })
      : null;
    const target = disputeStateFrom(dispute.status);
    const openedAt =
      typeof dispute.created === "number" && dispute.created > 0 ? new Date(dispute.created * 1000) : eventCreatedAt;

    try {
      await prisma.stripeDispute.create({
        data: {
          stripeDisputeId,
          stripeChargeId: idOf(dispute.charge),
          stripePaymentIntentId: paymentIntentId,
          kind: topUp ? "credit_topup" : "other",
          creditTopUpId: topUp?.id ?? null,
          currency: dispute.currency.toLowerCase(),
          amountCents: Math.max(0, Math.trunc(dispute.amount)),
          reason: typeof dispute.reason === "string" && SAFE_CODE.test(dispute.reason) ? dispute.reason : null,
          // The first event decides nothing yet: the locked step below does.
          status: "inquiry",
          openedAt,
        },
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }

    const money = disputeMoney(dispute);
    const result = await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "StripeDispute" WHERE "stripeDisputeId" = ${stripeDisputeId} FOR UPDATE`;
      if (!locked[0]) return null;
      const row = await tx.stripeDispute.findUniqueOrThrow({ where: { id: locked[0].id } });
      const data: Prisma.StripeDisputeUpdateInput = {
        // Balance transactions only accumulate, so the larger figure is the later one.
        withdrawnCents: Math.max(row.withdrawnCents, money.withdrawnCents),
        reinstatedCents: Math.max(row.reinstatedCents, money.reinstatedCents),
        ...(money.withdrawnCents >= row.withdrawnCents && money.reinstatedCents >= row.reinstatedCents
          ? { feeCents: money.feeCents }
          : {}),
      };
      if (money.reinstatedCents > 0 && !row.fundsReinstatedAt) data.fundsReinstatedAt = eventCreatedAt;

      let transition: Transition = null;
      let pack: CreditTopUp | null = null;
      // `won` and `lost` are final; an inquiry or an open dispute can still move.
      const final = row.status === "won" || row.status === "lost";
      if (!final && target !== row.status && !(row.status === "open" && target === "inquiry")) {
        data.status = target;
        if (target === "won" || target === "lost") data.closedAt = eventCreatedAt;

        if (row.creditTopUpId) {
          // Lock the purchase so a release or a refund cannot interleave.
          await tx.$queryRaw`SELECT "id" FROM "CreditTopUp" WHERE "id" = ${row.creditTopUpId} FOR UPDATE`;
          pack = await tx.creditTopUp.findUnique({ where: { id: row.creditTopUpId } });
        }
        if (pack) {
          let heldCents = row.heldCents;
          // Open, or lost without ever having been seen open: pause the disputed share once.
          if ((target === "open" || target === "lost") && !row.holdAppliedAt) {
            const disputedCreditsCents = disputedCreditsShare({
              creditsCents: pack.creditsCents,
              disputedCents: row.amountCents,
              chargedCents: pack.amountTotalCents ?? pack.priceCents,
            });
            data.statusBefore = pack.status;
            data.disputedCreditsCents = disputedCreditsCents;
            data.holdAppliedAt = eventCreatedAt;
            if (pack.status === "credited") {
              const stillFromPack = Math.max(0, pack.creditedCents - pack.reversedCents);
              const reversal = await reverseTopUpInTx(tx, {
                userId: pack.userId,
                wantedCents: Math.min(disputedCreditsCents, stillFromPack),
                paymentRef: pack.stripePaymentIntentId,
                reason: TOP_UP_DISPUTE_HOLD_REASON,
              });
              heldCents = reversal.reversedCents;
              data.heldCents = heldCents;
            }
            if (target === "open") transition = "opened";
          }
          if (target === "won") {
            const giveBack = Math.max(0, heldCents - row.releasedCents);
            if (giveBack > 0) {
              await creditTopUpInTx(tx, {
                userId: pack.userId,
                amountCents: giveBack,
                paymentRef: pack.stripePaymentIntentId,
                reason: TOP_UP_DISPUTE_RELEASE_REASON,
              });
              data.releasedCents = row.releasedCents + giveBack;
            }
            // Nothing was paused for an inquiry that closed, so there is nothing to tell.
            if (row.holdAppliedAt) transition = "won";
          }
          if (target === "lost") transition = "lost";
          // A purchase that was never credited or held (under review, already refunded) has nothing to pause.
          const before = (data.statusBefore as string | undefined) ?? row.statusBefore;
          if (before !== "held" && before !== "credited") transition = null;
        }
      }
      const updated = await tx.stripeDispute.update({ where: { id: row.id }, data });
      return { row: updated, transition, pack };
    });
    if (!result) return "ignored_unparseable";

    const { row, transition, pack } = result;
    log("info", "billing.dispute_applied", {
      disputeRowId: row.id,
      kind: row.kind,
      status: row.status,
      transition,
      heldCents: row.heldCents,
      releasedCents: row.releasedCents,
    });
    if (transition && pack) await this.notify(row, pack, transition);
    if (row.kind !== "credit_topup") return `recorded_${row.status}`;
    return transition ? `credits_${transition}` : `skipped_${row.status}`;
  }

  /** The `refund` notice for one change of a dispute over a credit pack. */
  private async notify(row: StripeDispute, pack: CreditTopUp, transition: Exclude<Transition, null>): Promise<void> {
    const known = findCreditPack(pack.packId);
    const label = known
      ? creditPackLabel(known, isBillingCurrency(pack.currency) ? pack.currency : DEFAULT_BILLING_CURRENCY)
      : "credit pack";
    const amount = formatMoney(row.amountCents, row.currency);
    const receipt = pack.stripePaymentIntentId ? ` Receipt reference: ${pack.stripePaymentIntentId}.` : "";
    const wasHeld = row.statusBefore === "held";
    const usedCents = wasHeld ? 0 : Math.max(0, row.disputedCreditsCents - row.heldCents);
    const used = usedCents > 0 ? ` ${formatUsd(usedCents)} had already been used and stays used.` : "";
    const writeToUs =
      " If you did not mean to dispute this payment, or you would rather have a refund from us, write to us at the " +
      "contact address in our refund policy: a refund through us is faster for you.";

    let title: string;
    let body: string;
    if (transition === "opened") {
      title = "Payment disputed: credits paused";
      body =
        `Your bank told us that the payment for the ${label} (${amount}) is disputed. While the dispute is open, ` +
        (wasHeld
          ? `the ${formatUsd(row.disputedCreditsCents)} of credits on hold from that purchase stay on hold and are not added to your balance.`
          : `${formatUsd(row.heldCents)} of credits from that purchase are paused and cannot be used.${used}`) +
        " If the bank refunds you, we remove what that payment bought; if it does not, the credits come back." +
        writeToUs +
        receipt;
    } else if (transition === "won") {
      title = "Payment dispute closed: credits restored";
      body =
        `The dispute over the payment for the ${label} (${amount}) is closed and the payment stands. ` +
        (wasHeld
          ? "The credits on hold from that purchase follow their normal hold again."
          : `${formatUsd(row.releasedCents)} of credits are back in your balance.`) +
        receipt;
    } else {
      title = "Payment dispute closed: credits removed";
      body =
        `Your bank refunded the payment for the ${label} (${amount}), so we removed what that payment bought: ` +
        (wasHeld
          ? `${formatUsd(row.disputedCreditsCents)} of held credits will not be added to your balance.`
          : `${formatUsd(row.heldCents)} of credits were removed from your balance.${used}`) +
        " If you think this is a mistake, write to us at the contact address in our refund policy." +
        receipt;
    }
    try {
      await this.notices.sendTargeted(
        { userIds: [pack.userId], category: DISPUTE_NOTICE_CATEGORY, title, body, link: DISPUTE_NOTICE_LINK },
        DISPUTE_NOTICE_ACTOR,
        { dedupeKey: `stripe-dispute:${row.id}:${transition}` },
      );
    } catch (error) {
      // The dispute is recorded either way and shows in Usage & Billing.
      log("error", "billing.dispute_notice_failed", {
        disputeRowId: row.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
