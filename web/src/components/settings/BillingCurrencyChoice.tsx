"use client";

import { useCallback, useId, useState } from "react";
import {
  readStoredBillingCurrency,
  writeStoredBillingCurrency,
  type BillingCurrency,
} from "../../lib/billingCurrency";

/**
 * The person's explicit currency choice (null = automatic, from the device's
 * time zone), remembered in this browser. Lifted into the Usage & Billing panel
 * so the Plan and Credits sections stay in step (#2496).
 */
export function useBillingCurrencyPreference(): [BillingCurrency | null, (currency: BillingCurrency) => void] {
  const [preference, setPreference] = useState<BillingCurrency | null>(() => readStoredBillingCurrency());
  const choose = useCallback((currency: BillingCurrency) => {
    setPreference(currency);
    writeStoredBillingCurrency(currency);
  }, []);
  return [preference, choose];
}

/**
 * "Where is your billing address?": shown only when the server offers more than
 * one currency. Plain radios, so it works with the keyboard and screen readers.
 */
export function BillingCurrencyChoice({
  currency,
  offered,
  disabled = false,
  onChange,
}: {
  currency: BillingCurrency;
  offered: readonly BillingCurrency[];
  disabled?: boolean;
  onChange?: (currency: BillingCurrency) => void;
}) {
  const name = useId();
  if (offered.length < 2) return null;
  const options: { value: BillingCurrency; label: string }[] = [
    { value: "eur", label: "In the EU — prices in euros, VAT included" },
    { value: "usd", label: "Outside the EU — prices in US dollars, plus any applicable tax" },
  ];
  return (
    <fieldset className="billing-currency-choice">
      <legend>Where is your billing address?</legend>
      {options
        .filter((option) => offered.includes(option.value))
        .map((option) => (
          <label key={option.value} className="billing-currency-option">
            <input
              type="radio"
              name={`${name}-currency`}
              value={option.value}
              checked={currency === option.value}
              disabled={disabled}
              onChange={() => onChange?.(option.value)}
            />
            <span>{option.label}</span>
          </label>
        ))}
    </fieldset>
  );
}
