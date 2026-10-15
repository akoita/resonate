"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
import { LICENSE_OPTIONS, type LicenseType } from "./LicenseTypeSelector";
import {
  TIER_ORDER,
  type TierDraftErrors,
  type TierDrafts,
} from "../../lib/multiTierListing";

type TierDraftState = {
  selected: Record<LicenseType, boolean>;
  amount: Record<LicenseType, string>;
  /** Prices the seller typed; untouched tiers follow the current defaults. */
  price: Partial<Record<LicenseType, string>>;
};

/**
 * Picker state that keeps following the prefilled defaults (catalog
 * pricing, listing asset) until the seller edits a price. Pass memoized
 * defaults; their selection and edition counts seed the initial state.
 */
export function useTierDrafts(defaults: TierDrafts): [TierDrafts, (next: TierDrafts) => void] {
  const [state, setState] = useState<TierDraftState>(() => ({
    selected: {
      personal: defaults.personal.selected,
      remix: defaults.remix.selected,
      commercial: defaults.commercial.selected,
    },
    amount: {
      personal: defaults.personal.amount,
      remix: defaults.remix.amount,
      commercial: defaults.commercial.amount,
    },
    price: {},
  }));

  const drafts = useMemo<TierDrafts>(() => {
    const draftFor = (tier: LicenseType) => ({
      selected: state.selected[tier],
      amount: state.amount[tier],
      price: state.price[tier] ?? defaults[tier].price,
    });
    return {
      personal: draftFor("personal"),
      remix: draftFor("remix"),
      commercial: draftFor("commercial"),
    };
  }, [defaults, state]);

  const setDrafts = useCallback(
    (next: TierDrafts) => {
      setState((prev) => {
        const price = { ...prev.price };
        for (const tier of TIER_ORDER) {
          const current = prev.price[tier] ?? defaults[tier].price;
          if (next[tier].price !== current) price[tier] = next[tier].price;
        }
        return {
          selected: {
            personal: next.personal.selected,
            remix: next.remix.selected,
            commercial: next.commercial.selected,
          },
          amount: {
            personal: next.personal.amount,
            remix: next.remix.amount,
            commercial: next.commercial.amount,
          },
          price,
        };
      });
    },
    [defaults],
  );

  return [drafts, setDrafts];
}

interface TierPickerProps {
  value: TierDrafts;
  onChange: (next: TierDrafts) => void;
  errors?: TierDraftErrors;
  formError?: string | null;
  /** Listing asset symbol shown next to the price inputs. */
  assetSymbol: string;
  /** Input step for the listing asset's decimals. */
  priceStep: string;
  /** Unique prefix for input ids when several pickers share a page. */
  idPrefix?: string;
  disabled?: boolean;
  /** Plan summary rendered under the tiers (e.g. editions to mint). */
  summary?: ReactNode;
}

/**
 * License tier picker (#2041): choose one or more of Personal, Remix and
 * Commercial, each with its own price per edition and edition count. Used by
 * the List for Sale modal, Mint & List, and Batch Mint & List.
 */
export function TierPicker({
  value,
  onChange,
  errors,
  formError,
  assetSymbol,
  priceStep,
  idPrefix = "tier",
  disabled = false,
  summary,
}: TierPickerProps) {
  const update = (tier: LicenseType, patch: Partial<TierDrafts[LicenseType]>) => {
    onChange({ ...value, [tier]: { ...value[tier], ...patch } });
  };

  return (
    <fieldset className="tier-picker space-y-2" disabled={disabled}>
      <legend className="block text-sm font-medium text-zinc-300 mb-1">License tiers</legend>
      <p className="text-xs text-zinc-500">
        Offer one or more tiers. Each tier is its own listing with its own price
        and number of editions; buyers get the rights of the tier they buy.
      </p>
      {TIER_ORDER.map((tier) => {
        const option = LICENSE_OPTIONS.find((o) => o.type === tier);
        const draft = value[tier];
        const tierErrors = errors?.[tier];
        const priceId = `${idPrefix}-${tier}-price`;
        const amountId = `${idPrefix}-${tier}-amount`;
        return (
          <div
            key={tier}
            className={`tier-picker__row rounded-lg border p-3 ${
              draft.selected
                ? "tier-picker__row--selected border-emerald-700 bg-emerald-950/20"
                : "border-zinc-800 bg-zinc-900/40"
            }`}
          >
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                className="mt-1"
                checked={draft.selected}
                onChange={(e) => update(tier, { selected: e.target.checked })}
              />
              <span className="flex-1">
                <span className="block text-sm font-medium text-white">{option?.label ?? tier}</span>
                <span className="block text-xs text-zinc-400">{option?.desc}</span>
                {option?.includes && (
                  <span className="block text-xs text-zinc-500">✓ {option.includes}</span>
                )}
              </span>
            </label>
            {draft.selected && (
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor={priceId} className="block text-xs text-zinc-400 mb-1">
                    {assetSymbol} per edition
                  </label>
                  <input
                    id={priceId}
                    type="number"
                    min="0"
                    step={priceStep}
                    inputMode="decimal"
                    value={draft.price}
                    aria-invalid={tierErrors?.price ? true : undefined}
                    onChange={(e) => update(tier, { price: e.target.value })}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-white"
                  />
                  {tierErrors?.price && (
                    <p className="tier-picker__error text-xs text-red-400 mt-1">{tierErrors.price}</p>
                  )}
                </div>
                <div>
                  <label htmlFor={amountId} className="block text-xs text-zinc-400 mb-1">
                    Editions
                  </label>
                  <input
                    id={amountId}
                    type="number"
                    min="1"
                    step="1"
                    inputMode="numeric"
                    value={draft.amount}
                    aria-invalid={tierErrors?.amount ? true : undefined}
                    onChange={(e) => update(tier, { amount: e.target.value })}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-white"
                  />
                  {tierErrors?.amount && (
                    <p className="tier-picker__error text-xs text-red-400 mt-1">{tierErrors.amount}</p>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
      {formError && <p className="tier-picker__error text-xs text-red-400">{formError}</p>}
      {summary && <div className="tier-picker__summary text-xs text-zinc-300">{summary}</div>}
      <p className="text-xs text-zinc-500">
        A remix license is what unlocks Remix Studio for this stem.
      </p>
    </fieldset>
  );
}
