import type { PayoutEligibility } from "../../lib/api";

/**
 * Honest, no-dead-end payout eligibility notice (#1498, ADR-BM-5).
 *
 * Shows the same explainable "why + how to fix" the backend gate enforces:
 *  - eligible → a subtle confirmation;
 *  - ineligible → each reason's plain-language message and the exact
 *    resolution step, with the human-verification reason wired to an action
 *    (e.g. scroll to the Human Verification card) when a handler is provided.
 *
 * The server gate stays authoritative — this only tells the artist what will
 * happen before they hit a paid action, so a submit never fails silently.
 */
export function PayoutEligibilityNotice({
  eligibility,
  onVerifyHuman,
  className,
}: {
  eligibility: PayoutEligibility | null;
  /** Optional handler for the human-verification unblock step. */
  onVerifyHuman?: () => void;
  className?: string;
}) {
  if (!eligibility) return null;

  if (eligibility.eligible) {
    return (
      <div
        className={className}
        role="status"
        data-testid="payout-eligibility-eligible"
        style={{
          border: "1px solid rgba(16, 185, 129, 0.4)",
          background: "rgba(16, 185, 129, 0.08)",
          borderRadius: 12,
          padding: "0.75rem 1rem",
          fontSize: "0.85rem",
          color: "#065f46",
        }}
      >
        <strong>Payouts enabled.</strong> This account is human-verified and its
        catalog rights allow payouts.
      </div>
    );
  }

  return (
    <div
      className={className}
      role="alert"
      data-testid="payout-eligibility-blocked"
      style={{
        border: "1px solid rgba(245, 158, 11, 0.45)",
        background: "rgba(245, 158, 11, 0.08)",
        borderRadius: 12,
        padding: "0.85rem 1rem",
        fontSize: "0.85rem",
        color: "#92400e",
      }}
    >
      <strong>Before you can receive payouts</strong>
      <ul style={{ margin: "0.5rem 0 0", paddingLeft: "1.1rem" }}>
        {eligibility.reasons.map((reason) => (
          <li key={reason.code} style={{ marginBottom: "0.4rem" }}>
            <span>{reason.message}</span>{" "}
            {reason.code === "human_verification_required" && onVerifyHuman ? (
              <button
                type="button"
                onClick={onVerifyHuman}
                data-testid="payout-eligibility-verify-human"
                style={{
                  background: "none",
                  border: "none",
                  padding: 0,
                  color: "#b45309",
                  textDecoration: "underline",
                  cursor: "pointer",
                  font: "inherit",
                }}
              >
                {reason.resolution}
              </button>
            ) : (
              <span style={{ opacity: 0.9 }}>{reason.resolution}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
