"use client";

import { useEffect, useMemo, useState } from "react";
import { useListStemTiers, useProtocolFee, useStemBalance, useStemData } from "../../hooks/useContracts";
import { usePaymentAssets } from "../../hooks/usePaymentAssets";
import { useStemTierPricing } from "../../hooks/useStemTierPricing";
import { useAuth } from "../auth/AuthProvider";
import { useToast } from "../ui/Toast";
import { useZeroDev } from "../auth/ZeroDevProviderClient";
import { getExplorerTxUrl } from "../../lib/explorer";
import { getListingsByStem } from "../../lib/api";
import {
  formatListingPrice,
  listingPaymentToken,
  selectDefaultMarketplaceListingAsset,
} from "../../lib/listingPricing";
import {
  buildTierNotifyPayload,
  describeTierPlan,
  initialTierDrafts,
  planTierListings,
  TIER_LABELS,
  validateTierDrafts,
  committedEditionsForPlan,
} from "../../lib/multiTierListing";
import { TierPicker, useTierDrafts } from "./TierPicker";
import { sellerNetProceedsLine } from "../../lib/marketplaceProceeds";
import { NOTIFY_LISTING_DELAYED_MESSAGE, postNotifyListing } from "../../lib/listingTiers";

interface ListStemModalProps {
  tokenId: bigint;
  /** Catalog stem id; enables per-tier price prefill and intent linking. */
  stemId?: string | null;
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (txHash: string) => void;
}

type CommittedState =
  | { status: "loading" }
  | { status: "ok"; amount: bigint }
  | { status: "unknown" };

/**
 * Editions already offered in the seller's active listings of this token.
 * Listings do not reserve balance, so these count against what is free to
 * list again (#2041).
 */
function useCommittedEditions(input: {
  stemId?: string | null;
  tokenId: bigint;
  seller?: string | null;
  enabled: boolean;
}): CommittedState {
  const { stemId, tokenId, seller, enabled } = input;
  const key = enabled && stemId && seller ? `${stemId}:${tokenId}:${seller.toLowerCase()}` : null;
  const [result, setResult] = useState<{ key: string; state: CommittedState } | null>(null);

  useEffect(() => {
    if (!key || !stemId || !seller) return;
    let cancelled = false;
    const sellerLower = seller.toLowerCase();
    getListingsByStem(stemId)
      .then((listings) => {
        if (cancelled) return;
        const amount = (listings ?? [])
          .filter(
            (listing) =>
              listing.seller?.toLowerCase() === sellerLower &&
              listing.tokenId === tokenId.toString(),
          )
          .reduce((sum, listing) => {
            try {
              return sum + BigInt(listing.amount);
            } catch {
              return sum;
            }
          }, 0n);
        setResult({ key, state: { status: "ok", amount } });
      })
      .catch(() => {
        if (!cancelled) setResult({ key, state: { status: "unknown" } });
      });
    return () => {
      cancelled = true;
    };
  }, [key, seller, stemId, tokenId]);

  if (!key) return { status: "unknown" };
  return result?.key === key ? result.state : { status: "loading" };
}

export function ListStemModal({ tokenId, stemId, isOpen, onClose, onSuccess }: ListStemModalProps) {
  const { balance } = useStemBalance(tokenId);
  const { data: stemData } = useStemData(tokenId);
  const { feeBps: protocolFeeBps, loading: protocolFeeLoading } = useProtocolFee();
  const { listTiers, pending, error, txHash } = useListStemTiers();
  const { address, smartAccountAddress, token } = useAuth();
  const { addToast } = useToast();
  const { chainId } = useZeroDev();
  const {
    assets: paymentAssets,
    defaultAsset,
    loading: paymentAssetsLoading,
  } = usePaymentAssets(chainId);
  const tierPricing = useStemTierPricing(stemId);

  const [duration, setDuration] = useState("7"); // Days
  const listingAsset = selectDefaultMarketplaceListingAsset({
    assets: paymentAssets,
    chainId,
    defaultAssetId: defaultAsset,
  });
  const listingToken = listingPaymentToken(listingAsset);
  const listingSymbol = listingAsset?.symbol ?? "ETH";
  const listingStep = listingAsset?.decimals === 6 ? "0.000001" : "0.000000000000000001";

  // Per-tier price defaults from the stem's catalog pricing; they keep
  // following the listing asset and pricing until the seller edits a price.
  const tierDefaults = useMemo(
    () => initialTierDrafts({ personalPrice: "0.01", asset: listingAsset, pricing: tierPricing }),
    [listingAsset, tierPricing],
  );
  const [drafts, setDrafts] = useTierDrafts(tierDefaults);

  const seller = smartAccountAddress || address;
  const committed = useCommittedEditions({ stemId, tokenId, seller, enabled: isOpen });
  // Only the stem's creator can mint more editions to cover extra tiers.
  const canMintMore = Boolean(
    seller && stemData?.creator && stemData.creator.toLowerCase() === seller.toLowerCase(),
  );

  if (!isOpen) return null;

  const validated = validateTierDrafts(drafts, { asset: listingAsset });
  const committedAmount = committedEditionsForPlan({
    status: committed.status,
    amount: committed.status === "ok" ? committed.amount : undefined,
    balance,
    tierCount: validated.valid ? validated.tiers.length : 0,
  });
  const plan = validated.valid
    ? planTierListings({
      tiers: validated.tiers,
      balance,
      committedAmount,
      canMintMore,
    })
    : null;
  const planReady = plan?.ok === true ? plan : null;
  const planError = plan && !plan.ok ? plan.message : null;

  const handleList = async () => {
    if (!planReady) return;
    try {
      const durationSeconds = BigInt(parseInt(duration) * 24 * 60 * 60);
      const { hash, listingIds } = await listTiers(planReady, {
        tokenId,
        paymentToken: listingToken,
        durationSeconds,
      });
      // Record the listing intent so the indexer stamps each listing's
      // license tier (the on-chain listing carries no license type).
      // Best-effort and non-blocking: the listings already exist and the
      // indexer still records them, so a failure (including a refused
      // sign-in) only shows a notice.
      const warnTierDelayed = () => {
        addToast({
          type: "warning",
          title: "Listing created",
          message: NOTIFY_LISTING_DELAYED_MESSAGE,
        });
      };
      if (seller) {
        void postNotifyListing(
          buildTierNotifyPayload({
            tokenId,
            chainId,
            seller,
            paymentToken: listingToken,
            durationSeconds,
            transactionHash: hash,
            stemId,
            tiers: planReady.tiers,
            listingIds,
          }),
          token,
        ).then((result) => {
          if (!result.ok) warnTierDelayed();
        });
      } else {
        warnTierDelayed();
      }
      onSuccess?.(hash);
    } catch {
      // Error handled by hook
    }
  };

  const txExplorerUrl = getExplorerTxUrl(txHash);
  const totalValueUnits = validated.tiers.reduce(
    (sum, tier) => sum + tier.pricePerUnit * tier.amount,
    0n,
  );
  const proceedsLine = protocolFeeLoading || totalValueUnits <= 0n
    ? null
    : sellerNetProceedsLine({
      priceUnits: totalValueUnits,
      quantity: 1n,
      asset: listingAsset,
      protocolFeeBps,
      royaltyBps: stemData?.royaltyBps,
    });
  const planSummary = planReady ? (
    <p className="listing-tier-plan">
      {describeTierPlan({
        tierCount: planReady.tiers.length,
        totalAmount: planReady.totalAmount,
        mintAmount: planReady.mintAmount,
        mode: "list",
      })}
    </p>
  ) : planError ? (
    <p className="listing-tier-plan listing-tier-plan--error text-red-400">{planError}</p>
  ) : null;
  const committedNote =
    committed.status === "ok" && committed.amount > 0n
      ? `${committed.amount} of your editions are already in active listings, so they are not counted as free to list.`
      : committed.status === "unknown" && stemId
        ? "We couldn't check your active listings for this stem; make sure you hold enough editions for every tier."
        : null;
  const selectedTierNames = validated.tiers.map((tier) => TIER_LABELS[tier.licenseType]).join(", ");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-zinc-900 rounded-lg border border-zinc-800 w-full max-w-md mx-4 p-6 max-h-[90vh] overflow-y-auto">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-zinc-500 hover:text-white"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        <h2 className="text-xl font-semibold text-white mb-4">List Stem for Sale</h2>

        <div className="space-y-4">
          {/* Token Info */}
          <div className="bg-zinc-800 rounded-lg p-4">
            <p className="text-sm text-zinc-400">Token ID</p>
            <p className="text-white font-mono">{tokenId.toString()}</p>
            <p className="text-sm text-zinc-400 mt-2">Your Balance</p>
            <p className="text-white">{balance.toString()} editions</p>
          </div>

          {/* License tiers: one or more, each with its own price and editions */}
          <TierPicker
            value={drafts}
            onChange={setDrafts}
            errors={validated.errors}
            formError={validated.formError}
            assetSymbol={listingSymbol}
            priceStep={listingStep}
            idPrefix={`list-${tokenId.toString()}`}
            disabled={pending}
            summary={planSummary}
          />
          {committedNote && (
            <p className="text-xs text-zinc-500 listing-edition-hint">{committedNote}</p>
          )}

          {/* Duration Select */}
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-1">
              Listing Duration
            </label>
            <select
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-white"
            >
              <option value="1">1 day</option>
              <option value="3">3 days</option>
              <option value="7">7 days</option>
              <option value="14">14 days</option>
              <option value="30">30 days</option>
              <option value="90">90 days</option>
            </select>
          </div>

          {/* Summary */}
          <div className="bg-zinc-800 rounded-lg p-4 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-zinc-400">License tiers</span>
              <span className="text-white">{selectedTierNames || "None"}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-zinc-400">Total Value</span>
              <span className="text-white">
                {formatListingPrice({
                  priceUnits: totalValueUnits,
                  asset: listingAsset,
                })}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-zinc-400">Settlement Asset</span>
              <span className="text-white">
                {listingAsset ? `${listingAsset.name} (${listingSymbol})` : "Native ETH"}
              </span>
            </div>
            {proceedsLine && (
              <p className="text-xs text-zinc-400 pt-1">{proceedsLine}</p>
            )}
            <div className="flex justify-between text-sm">
              <span className="text-zinc-400">Expires</span>
              <span className="text-white">
                {new Date(
                  Date.now() + parseInt(duration) * 24 * 60 * 60 * 1000
                ).toLocaleDateString()}
              </span>
            </div>
          </div>

          {/* Info */}
          <p className="text-xs text-zinc-500">
            Listings default to the configured marketplace stablecoin when available. Native ETH
            remains a fallback for local or legacy deployments. Royalties and protocol fees are
            automatically deducted from sales in the listing asset.
          </p>

          {/* Error */}
          {error && (
            <div className="bg-red-900/20 border border-red-800 rounded-md p-3">
              <p className="text-sm text-red-400">{error.message}</p>
            </div>
          )}

          {/* Success */}
          {txHash && (
            <div className="bg-emerald-900/20 border border-emerald-800 rounded-md p-3">
              <p className="text-sm text-emerald-400">
                Listed successfully!{" "}
                {txExplorerUrl && (
                  <a
                    href={txExplorerUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline"
                  >
                    View transaction
                  </a>
                )}
              </p>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-white py-3 rounded-md transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleList}
              disabled={pending || paymentAssetsLoading || committed.status === "loading" || !planReady}
              className="flex-1 bg-emerald-600 hover:bg-emerald-700 disabled:bg-zinc-700 disabled:cursor-not-allowed text-white py-3 rounded-md transition-colors"
            >
              {paymentAssetsLoading
                ? "Loading asset..."
                : committed.status === "loading"
                  ? "Checking editions..."
                  : pending
                    ? "Listing..."
                    : planReady && planReady.tiers.length > 1
                      ? `List ${planReady.tiers.length} tiers`
                      : "List for Sale"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
