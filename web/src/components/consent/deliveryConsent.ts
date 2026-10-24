import {
  getPurchaseConsentWording,
  recordPurchaseConsent,
  type PurchaseConsentRecord,
  type PurchaseConsentSurface,
  type PurchaseConsentWording,
} from "../../lib/api";

/**
 * The buyer's delivery choice at checkout (#1776). Starts empty and unticked:
 * nothing is pre-selected, so a purchase cannot proceed on a default.
 */
export type DeliveryChoice = "deliver_now" | "wait";

export type DeliveryConsentState = {
  choice: DeliveryChoice | null;
  /** The explicit checkbox: "I ask for delivery now and lose my right to withdraw". */
  acknowledged: boolean;
};

export const INITIAL_DELIVERY_CONSENT: DeliveryConsentState = { choice: null, acknowledged: false };

/**
 * Whether the choice is complete enough to pay. "Wait" needs nothing more;
 * "deliver now" needs the ticked acknowledgement. A mint offers only
 * "deliver now" (it cannot be undone), so "wait" never counts there.
 */
export function isDeliveryConsentComplete(
  state: DeliveryConsentState,
  options: { mintOnly?: boolean } = {},
): boolean {
  if (state.choice === "deliver_now") return state.acknowledged;
  return state.choice === "wait" && !options.mintOnly;
}

/** Switching to "wait" clears the acknowledgement so it can never linger. */
export function selectDeliveryChoice(
  state: DeliveryConsentState,
  choice: DeliveryChoice,
): DeliveryConsentState {
  return choice === "deliver_now" ? { ...state, choice } : { choice, acknowledged: false };
}

/** The date a held delivery is released, in the buyer's words, from an ISO string. */
export function formatHoldDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "the end of the 14-day withdrawal period";
  return date.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

export type DeliveryConsentSubject = {
  surface: PurchaseConsentSurface;
  subjectId: string;
  licenseType?: string;
  subjectLabel?: string;
};

/**
 * Record the choice BEFORE the purchase or mint starts. Throws if it could not
 * be recorded, in which case the caller must not start the payment.
 */
export async function recordDeliveryChoice(
  token: string,
  wording: PurchaseConsentWording,
  state: DeliveryConsentState,
  subject: DeliveryConsentSubject,
): Promise<PurchaseConsentRecord> {
  if (!isDeliveryConsentComplete(state, { mintOnly: subject.surface === "collectible_mint" })) {
    throw new Error("Choose how you want this delivered before you pay.");
  }
  const consented = state.choice === "deliver_now";
  return recordPurchaseConsent(token, {
    ...subject,
    consented,
    acknowledgedWaiver: consented && state.acknowledged,
    textVersion: wording.version,
  });
}

export { getPurchaseConsentWording };
