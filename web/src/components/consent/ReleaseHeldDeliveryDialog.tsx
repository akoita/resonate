"use client";

import { useState } from "react";
import "../../styles/delivery-consent.css";
import { useConsentWording } from "./DeliveryConsentStep";
import { formatHoldDate, recordDeliveryChoice } from "./deliveryConsent";
import type { PurchaseConsentSurface } from "../../lib/api";

/**
 * Asks for immediate delivery of something already bought and held (#1776).
 * Delivery has not begun, so a consent given now still counts; it ends the
 * right to withdraw, which the acknowledgement says in the buyer's own terms.
 * Nothing is pre-ticked.
 */
export function ReleaseHeldDeliveryDialog({
  token,
  surface,
  subjectId,
  subjectLabel,
  heldUntil,
  onClose,
  onReleased,
}: {
  token: string;
  surface: PurchaseConsentSurface;
  subjectId: string;
  subjectLabel: string;
  heldUntil: string;
  onClose: () => void;
  onReleased: () => void;
}) {
  const { wording, error: wordingError } = useConsentWording(true);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    if (!wording || !acknowledged || busy) return;
    setBusy(true);
    setError(null);
    try {
      await recordDeliveryChoice(token, wording, { choice: "deliver_now", acknowledged }, { surface, subjectId });
      onReleased();
    } catch {
      setError("We could not record your request. Nothing changed; try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="delivery-dialog-overlay" role="presentation">
      <div
        className="delivery-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="delivery-dialog-title"
        data-testid="release-held-dialog"
      >
        <h2 id="delivery-dialog-title">Deliver “{subjectLabel}” now?</h2>
        <p>
          Delivery is on hold until {formatHoldDate(heldUntil)}, when your 14-day withdrawal period ends.
          You can ask for it now instead.
        </p>
        {wordingError && <p role="alert">{wordingError}</p>}
        {wording && (
          <label className="delivery-consent__ack delivery-dialog__ack">
            <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />
            <span>{wording.deliverNow.acknowledgement}</span>
          </label>
        )}
        {error && <p role="alert">{error}</p>}
        <div className="delivery-dialog__actions">
          <button type="button" onClick={onClose} disabled={busy}>
            Keep waiting
          </button>
          <button type="button" onClick={confirm} disabled={!wording || !acknowledged || busy}>
            {busy ? "Saving…" : "Deliver now"}
          </button>
        </div>
      </div>
    </div>
  );
}
