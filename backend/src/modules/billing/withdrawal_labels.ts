/**
 * Every string of the in-app withdrawal function (#2594, Directive
 * 2023/2673), in one place. Some member states fix the exact wording of the
 * button and the confirmation, so an operator localises them here only: the
 * app reads them from `GET /billing/withdrawals` and never hard-codes them.
 *
 * Not legal advice: for the operator's lawyer before live charging.
 */

export const WITHDRAWAL_LABELS_VERSION = "2026-11-23.withdrawal-draft-1";

export const WITHDRAWAL_LABELS = {
  version: WITHDRAWAL_LABELS_VERSION,
  /** The entry point: shown only while a right to withdraw exists. */
  entryButton: "Withdraw from contract",
  sectionTitle: "Withdraw from a contract",
  sectionIntro:
    "You can withdraw from these contracts within 14 days, without giving a reason. The button stays here for as long as your right lasts.",
  formTitle: "Your withdrawal statement",
  nameLabel: "Your name",
  contractLabel: "The contract you withdraw from",
  confirmationLabel: "Where we send the confirmation",
  /** Shown when the person has a confirmed contact email ({email} is masked). */
  confirmationToEmail: "To your notices in Resonate and by email to {email}.",
  confirmationToNotices: "To your notices in Resonate. Confirm a contact email in Settings to also get it by email.",
  continueButton: "Continue",
  cancelButton: "Go back",
  /** The bare confirmation step: this button and nothing else. */
  confirmButton: "Confirm withdrawal",
  doneTitle: "Withdrawal received",
  doneBody:
    "We have recorded your withdrawal and sent you a confirmation with your statement and the time we received it. Your refund has started.",
  /** Refund wording per contract, repeated in the acknowledgement. */
  refundArtistPro:
    "Artist Pro ends now. You pay only for the service you received before withdrawing, in proportion to the price, and we refund the rest ({refund}) to your card.",
  refundCreditPack: "The credits on hold are cancelled and we refund the full price ({refund}) to your card.",
  /** The written route stays as a fallback. */
  fallback: "You can also withdraw by writing to us at the contact address in our refund policy.",
} as const;

export type WithdrawalLabels = typeof WITHDRAWAL_LABELS;
