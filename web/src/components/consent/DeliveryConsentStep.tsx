"use client";

import { useEffect, useId, useState } from "react";
import "../../styles/delivery-consent.css";
import type { PurchaseConsentWording } from "../../lib/api";
import {
  getPurchaseConsentWording,
  isDeliveryConsentComplete,
  selectDeliveryChoice,
  type DeliveryConsentState,
} from "./deliveryConsent";

/** Loads the checkout wording from the backend once the checkout is open. */
export function useConsentWording(enabled: boolean) {
  const [wording, setWording] = useState<PurchaseConsentWording | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled || wording) return;
    let cancelled = false;
    getPurchaseConsentWording()
      .then((value) => {
        if (!cancelled) setWording(value);
      })
      .catch(() => {
        if (!cancelled) setError("We could not load the delivery terms. Reload and try again.");
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, wording]);
  return { wording, error };
}

/**
 * The deliberate delivery step of a checkout (#1776): two clear choices,
 * nothing pre-selected, and an unticked acknowledgement for "deliver now". A
 * mint (`mintOnly`) offers only the first choice, with the reason.
 */
export function DeliveryConsentStep({
  wording,
  error,
  state,
  onChange,
  mintOnly = false,
  disabled = false,
  waitDate,
}: {
  wording: PurchaseConsentWording | null;
  error?: string | null;
  state: DeliveryConsentState;
  onChange: (next: DeliveryConsentState) => void;
  mintOnly?: boolean;
  disabled?: boolean;
  /** Shown under "Wait" when the date is already known. */
  waitDate?: string | null;
}) {
  const groupId = useId();
  if (error) {
    return (
      <div className="delivery-consent delivery-consent--error" role="alert">
        {error}
      </div>
    );
  }
  if (!wording) {
    return (
      <div className="delivery-consent" role="status" aria-busy="true">
        Loading delivery terms…
      </div>
    );
  }
  const complete = isDeliveryConsentComplete(state, { mintOnly });
  return (
    <fieldset className="delivery-consent" data-testid="delivery-consent" disabled={disabled}>
      <legend className="delivery-consent__heading">{wording.heading}</legend>
      <p className="delivery-consent__intro">{wording.intro}</p>
      <div className="delivery-consent__choices" role="radiogroup" aria-label={wording.heading}>
        <label className="delivery-consent__choice">
          <input
            type="radio"
            name={`${groupId}-delivery`}
            checked={state.choice === "deliver_now"}
            onChange={() => onChange(selectDeliveryChoice(state, "deliver_now"))}
          />
          <span>
            <strong>{wording.deliverNow.label}</strong>
            <span className="delivery-consent__hint"> {wording.deliverNow.description}</span>
          </span>
        </label>
        {state.choice === "deliver_now" && (
          <label className="delivery-consent__ack">
            <input
              type="checkbox"
              checked={state.acknowledged}
              onChange={(event) => onChange({ ...state, acknowledged: event.target.checked })}
            />
            <span>{wording.deliverNow.acknowledgement}</span>
          </label>
        )}
        {mintOnly ? (
          <p className="delivery-consent__mint">{wording.mint.explanation}</p>
        ) : (
          <label className="delivery-consent__choice">
            <input
              type="radio"
              name={`${groupId}-delivery`}
              checked={state.choice === "wait"}
              onChange={() => onChange(selectDeliveryChoice(state, "wait"))}
            />
            <span>
              <strong>{wording.wait.label}</strong>
              <span className="delivery-consent__hint">
                {" "}
                {wording.wait.description}
                {waitDate ? ` Expected delivery: ${waitDate}.` : ""}
              </span>
            </span>
          </label>
        )}
      </div>
      {!complete && (
        <p className="delivery-consent__required" role="status">
          {mintOnly
            ? "Tick the box to continue."
            : "Choose one to continue. Nothing is selected for you."}
        </p>
      )}
      <p className="delivery-consent__footer">{wording.confirmation}</p>
      <p className="delivery-consent__review">Wording version {wording.version} — draft, for legal review before production.</p>
    </fieldset>
  );
}
