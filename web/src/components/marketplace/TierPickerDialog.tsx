"use client";

import { useMemo, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { LicenseType } from "./LicenseTypeSelector";
import { TierPicker, useTierDrafts } from "./TierPicker";
import {
  formatPriceInput,
  initialTierDrafts,
  validateTierDrafts,
  type TierListingInput,
} from "../../lib/multiTierListing";
import { formatListingPrice, type MarketplaceListingAsset } from "../../lib/listingPricing";
import type { StemTierPricing } from "../../lib/listingTiers";

export type TierDialogPlanCheck = { ok: true; summary: string } | { ok: false; message: string };

interface TierPickerDialogProps {
  title: string;
  confirmLabel: string;
  asset: MarketplaceListingAsset;
  /** Personal price prefill, in listing-asset units. */
  personalPriceUnits: bigint;
  pricing?: StemTierPricing | null;
  initialTier?: LicenseType;
  /** Per-edition price limit in listing-asset units, when one applies. */
  maxPriceUnits?: bigint | null;
  /** Explains what one confirmation will do for the chosen tiers. */
  checkPlan: (tiers: TierListingInput[]) => TierDialogPlanCheck;
  onConfirm: (tiers: TierListingInput[]) => void;
  onClose: () => void;
  pending?: boolean;
  notice?: ReactNode;
}

/**
 * Small modal around TierPicker for surfaces with no room for inline tier
 * inputs (the per-stem Mint & List button, #2041).
 */
export function TierPickerDialog({
  title,
  confirmLabel,
  asset,
  personalPriceUnits,
  pricing,
  initialTier,
  maxPriceUnits,
  checkPlan,
  onConfirm,
  onClose,
  pending = false,
  notice,
}: TierPickerDialogProps) {
  const defaults = useMemo(
    () =>
      initialTierDrafts({
        personalPrice: formatPriceInput(personalPriceUnits, asset),
        asset,
        pricing,
        initialTier,
        maxPriceUnits,
      }),
    [asset, initialTier, maxPriceUnits, personalPriceUnits, pricing],
  );
  const [drafts, setDrafts] = useTierDrafts(defaults);
  const maxPriceLabel =
    maxPriceUnits != null ? formatListingPrice({ priceUnits: maxPriceUnits, asset }) : undefined;
  const validated = validateTierDrafts(drafts, { asset, maxPriceUnits, maxPriceLabel });
  const check = validated.valid ? checkPlan(validated.tiers) : null;
  const symbol = asset?.symbol ?? "ETH";
  const step = asset?.decimals === 6 ? "0.000001" : "0.000000000000000001";

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[1000] flex items-center justify-center" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={pending ? undefined : onClose} />
      <div className="relative bg-zinc-900 rounded-lg border border-zinc-800 w-full max-w-md mx-4 p-6 max-h-[90vh] overflow-y-auto space-y-4">
        <h2 className="text-xl font-semibold text-white">{title}</h2>
        {notice}
        <TierPicker
          value={drafts}
          onChange={setDrafts}
          errors={validated.errors}
          formError={validated.formError}
          assetSymbol={symbol}
          priceStep={step}
          idPrefix="mint-tier"
          disabled={pending}
          summary={
            check ? (
              check.ok ? (
                <p>{check.summary}</p>
              ) : (
                <p className="text-red-400">{check.message}</p>
              )
            ) : null
          }
        />
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="flex-1 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-60 text-white py-3 rounded-md transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(validated.tiers)}
            disabled={pending || !check?.ok}
            className="flex-1 bg-violet-600 hover:bg-violet-700 disabled:bg-zinc-700 disabled:cursor-not-allowed text-white py-3 rounded-md transition-colors"
          >
            {pending ? "Processing..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
