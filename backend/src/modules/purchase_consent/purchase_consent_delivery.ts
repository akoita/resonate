import { ForbiddenException } from "@nestjs/common";
import { prisma } from "../../db/prisma";
import {
  CONSENT_PRE_PURCHASE_WINDOW_MS,
  MINT_CONSENT_VALIDITY_MS,
  PURCHASE_CONSENT_EFFECTIVE_AT,
  PURCHASE_CONSENT_SURFACES,
  WITHDRAWAL_PERIOD_MS,
  type PurchaseConsentSurface,
} from "./purchase_consent.constants";

/**
 * The server-side delivery gate for consumer digital purchases (#1776).
 *
 * A purchase is delivered (download, licence entitlement, collectible grant)
 * only when
 *   1. a recorded consent matches it: the buyer asked for immediate delivery and
 *      acknowledged losing the withdrawal right, or
 *   2. the withdrawal period (14 days from the purchase) has elapsed.
 * A purchase with no recorded consent at all (bought outside the app or by an
 * agent session key) is treated as "wait": it is held until the period ends.
 * A purchase before `PURCHASE_CONSENT_EFFECTIVE_AT` predates the consent step
 * and is delivered as before (`predates_consent`), so buyers keep what they had.
 *
 * An on-chain purchase cannot be refused by the server, so the enforceable
 * point is the delivery of the off-chain content. A mint, which cannot be
 * undone, is refused outright without a consent (`requireMintConsent`).
 *
 * Pure decision (`decidePurchaseDelivery`) plus thin Prisma readers; none of
 * it ever grants anything, and a failure to read consents fails closed because
 * the exception propagates to the caller, which does not deliver.
 */

export type PurchaseDeliveryRequest = {
  surface: PurchaseConsentSurface;
  subjectId: string;
  /** When the payment was made: the withdrawal period runs from here. */
  purchasedAt: Date;
  /** Transaction hashes / purchase references this purchase is known by. */
  refs?: ReadonlyArray<string | null | undefined>;
};

export type ConsentForDecision = {
  id: string;
  surface: string;
  subjectId: string;
  consented: boolean;
  acknowledgedWaiver: boolean;
  transactionHash: string | null;
  purchaseRef: string | null;
  createdAt: Date;
};

export type DeliveryDecision =
  | {
      state: "released";
      basis: "consent" | "hold_elapsed" | "predates_consent";
      consentId: string | null;
    }
  | { state: "held"; availableAt: Date; consentId: string | null };

function normalizeRefs(refs: PurchaseDeliveryRequest["refs"]): Set<string> {
  const out = new Set<string>();
  for (const ref of refs ?? []) {
    if (typeof ref === "string" && ref.trim()) out.add(ref.trim().toLowerCase());
  }
  return out;
}

/** True when a consent row belongs to this purchase. */
function consentAppliesTo(
  consent: ConsentForDecision,
  request: PurchaseDeliveryRequest,
  refs: Set<string>,
): boolean {
  if (consent.surface !== request.surface || consent.subjectId !== request.subjectId) return false;
  const linkedHash = consent.transactionHash?.toLowerCase() ?? null;
  const linkedRef = consent.purchaseRef?.toLowerCase() ?? null;
  if (linkedHash || linkedRef) {
    // Linked to a payment: it covers exactly that payment, never another one.
    return (linkedHash !== null && refs.has(linkedHash)) || (linkedRef !== null && refs.has(linkedRef));
  }
  // Unlinked: recorded at checkout shortly before the payment, or any time after
  // it while the delivery is still held (delivery has not begun, so the consent
  // is still "prior").
  return consent.createdAt.getTime() >= request.purchasedAt.getTime() - CONSENT_PRE_PURCHASE_WINDOW_MS;
}

export function decidePurchaseDelivery(
  request: PurchaseDeliveryRequest,
  consents: readonly ConsentForDecision[],
  now: Date = new Date(),
): DeliveryDecision {
  if (request.purchasedAt.getTime() < PURCHASE_CONSENT_EFFECTIVE_AT.getTime()) {
    return { state: "released", basis: "predates_consent", consentId: null };
  }
  const refs = normalizeRefs(request.refs);
  const applicable = consents.filter((consent) => consentAppliesTo(consent, request, refs));
  const waiver = applicable.find((consent) => consent.consented && consent.acknowledgedWaiver);
  if (waiver) return { state: "released", basis: "consent", consentId: waiver.id };

  const availableAt = new Date(request.purchasedAt.getTime() + WITHDRAWAL_PERIOD_MS);
  const holdChoice = applicable[0]?.id ?? null;
  if (now.getTime() >= availableAt.getTime()) {
    return { state: "released", basis: "hold_elapsed", consentId: holdChoice };
  }
  return { state: "held", availableAt, consentId: holdChoice };
}

/** One query for all the requests of one buyer; decisions in request order. */
export async function evaluatePurchaseDeliveries(
  userId: string,
  requests: readonly PurchaseDeliveryRequest[],
  now: Date = new Date(),
): Promise<DeliveryDecision[]> {
  if (requests.length === 0) return [];
  const subjectIds = Array.from(new Set(requests.map((request) => request.subjectId)));
  const surfaces = Array.from(new Set(requests.map((request) => request.surface)));
  const consents = await prisma.purchaseConsent.findMany({
    where: { userId, surface: { in: surfaces }, subjectId: { in: subjectIds } },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      surface: true,
      subjectId: true,
      consented: true,
      acknowledgedWaiver: true,
      transactionHash: true,
      purchaseRef: true,
      createdAt: true,
    },
  });
  return requests.map((request) => decidePurchaseDelivery(request, consents, now));
}

export async function evaluatePurchaseDelivery(
  userId: string,
  request: PurchaseDeliveryRequest,
  now: Date = new Date(),
): Promise<DeliveryDecision> {
  const [decision] = await evaluatePurchaseDeliveries(userId, [request], now);
  return decision;
}

/** The earliest release among held decisions, or null when any is released. */
export function earliestHold(decisions: readonly DeliveryDecision[]): Date | null {
  let earliest: Date | null = null;
  for (const decision of decisions) {
    if (decision.state === "released") return null;
    if (!earliest || decision.availableAt.getTime() < earliest.getTime()) earliest = decision.availableAt;
  }
  return earliest;
}

/** The body of a refused delivery (HTTP 403 `delivery_held`). */
export function deliveryHeldBody(availableAt: Date) {
  return {
    error: "delivery_held",
    code: "delivery_held",
    message: `Delivery is on hold until ${availableAt.toISOString().slice(0, 10)}, when your 14-day withdrawal period ends. You can ask for immediate delivery from your library and give up your right to withdraw.`,
    deliveryAvailableAt: availableAt.toISOString(),
  };
}

/**
 * An on-chain mint cannot be undone, so it needs a recorded consent made just
 * before and not yet used by a mint. Throws 403 `consent_required`.
 */
export async function requireMintConsent(
  userId: string,
  surface: PurchaseConsentSurface,
  subjectId: string,
  now: Date = new Date(),
): Promise<{ consentId: string }> {
  if (PURCHASE_CONSENT_SURFACES[surface].deliveryKind !== "on_chain_mint") {
    throw new Error(`${surface} is not a mint surface`);
  }
  const consent = await prisma.purchaseConsent.findFirst({
    where: {
      userId,
      surface,
      subjectId,
      consented: true,
      acknowledgedWaiver: true,
      transactionHash: null,
      purchaseRef: null,
      createdAt: { gte: new Date(now.getTime() - MINT_CONSENT_VALIDITY_MS) },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (!consent) {
    throw new ForbiddenException({
      code: "consent_required",
      message:
        "Minting cannot be undone, so it needs your consent to immediate delivery first. Confirm it at checkout and try again.",
    });
  }
  return { consentId: consent.id };
}

/**
 * The stems of a buyer's purchases whose delivery is released (#1776). Used where
 * a purchase confers a licence rather than a download (remix and export
 * entitlement, crate export): a stem counts only when at least one of its
 * purchases is released.
 */
export async function releasedStemIds(
  userId: string,
  purchases: ReadonlyArray<{ stemId: string; purchasedAt: Date; refs?: ReadonlyArray<string | null | undefined> }>,
  now: Date = new Date(),
): Promise<Set<string>> {
  const decisions = await evaluatePurchaseDeliveries(
    userId,
    purchases.map((purchase) => ({
      surface: "stem_purchase" as const,
      subjectId: purchase.stemId,
      purchasedAt: purchase.purchasedAt,
      refs: purchase.refs,
    })),
    now,
  );
  const released = new Set<string>();
  decisions.forEach((decision, index) => {
    if (decision.state === "released") released.add(purchases[index].stemId);
  });
  return released;
}

/**
 * Bind an unlinked consent to the purchase it just released (#1776), so the
 * record names the payment it covers and cannot be reused for another one.
 * Best effort: delivery has already been decided, and a failure here only
 * leaves the consent unlinked.
 */
export async function linkConsentToPurchase(
  consentId: string | null,
  link: { transactionHash?: string | null; purchaseRef?: string | null },
): Promise<void> {
  if (!consentId || (!link.transactionHash && !link.purchaseRef)) return;
  try {
    const now = new Date();
    await prisma.purchaseConsent.updateMany({
      where: { id: consentId, transactionHash: null, purchaseRef: null },
      data: {
        transactionHash: link.transactionHash?.toLowerCase() ?? null,
        purchaseRef: link.purchaseRef ?? null,
        linkedAt: now,
      },
    });
  } catch {
    // The consent stays unlinked; the purchase is already delivered.
  }
}
