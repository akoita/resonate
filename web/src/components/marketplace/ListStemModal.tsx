"use client";

import { useEffect, useState } from "react";
import { useListStem, useProtocolFee, useStemBalance, useStemData } from "../../hooks/useContracts";
import { usePaymentAssets } from "../../hooks/usePaymentAssets";
import { useAuth } from "../auth/AuthProvider";
import { useToast } from "../ui/Toast";
import { useZeroDev } from "../auth/ZeroDevProviderClient";
import { getExplorerTxUrl } from "../../lib/explorer";
import { API_BASE } from "../../lib/api";
import {
  formatListingPrice,
  listingPaymentToken,
  parseListingPriceUnits,
  selectDefaultMarketplaceListingAsset,
} from "../../lib/listingPricing";
import {
  buildNotifyListingPayload,
  multiTierEditionHint,
  tierDefaultPriceUsd,
  type StemTierPricing,
} from "../../lib/listingTiers";
import {
  LicenseTypeSelector,
  type LicenseType,
} from "./LicenseTypeSelector";
import { sellerNetProceedsLine } from "../../lib/marketplaceProceeds";

interface ListStemModalProps {
  tokenId: bigint;
  /** Catalog stem id; enables per-tier price prefill and intent linking. */
  stemId?: string | null;
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (txHash: string) => void;
}

export function ListStemModal({ tokenId, stemId, isOpen, onClose, onSuccess }: ListStemModalProps) {
  const { balance } = useStemBalance(tokenId);
  const { data: stemData } = useStemData(tokenId);
  const { feeBps: protocolFeeBps, loading: protocolFeeLoading } = useProtocolFee();
  const { list, pending, error, txHash } = useListStem();
  const { address, smartAccountAddress } = useAuth();
  const { addToast } = useToast();
  const { chainId } = useZeroDev();
  const {
    assets: paymentAssets,
    defaultAsset,
    loading: paymentAssetsLoading,
  } = usePaymentAssets(chainId);

  const [price, setPrice] = useState("0.01");
  const [amount, setAmount] = useState("1");
  const [duration, setDuration] = useState("7"); // Days
  const [licenseType, setLicenseType] = useState<LicenseType>("personal");
  const [tierPricing, setTierPricing] = useState<StemTierPricing | null>(null);
  const listingAsset = selectDefaultMarketplaceListingAsset({
    assets: paymentAssets,
    chainId,
    defaultAssetId: defaultAsset,
  });
  const listingToken = listingPaymentToken(listingAsset);
  const listingSymbol = listingAsset?.symbol ?? "ETH";
  const listingStep = listingAsset?.decimals === 6 ? "0.000001" : "0.000000000000000001";
  const usdDenominated = listingSymbol.toUpperCase().includes("USD");
  let priceUnits = 0n;
  try {
    priceUnits = parseListingPriceUnits({ price: price || "0", asset: listingAsset });
  } catch {
    priceUnits = 0n;
  }

  // Per-tier price defaults from the stem's catalog pricing.
  useEffect(() => {
    if (!stemId) {
      setTierPricing(null);
      return;
    }
    let cancelled = false;
    fetch(`${API_BASE}/api/stem-pricing/${stemId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data) {
          setTierPricing({
            remixLicenseUsd: data.remixLicenseUsd ?? null,
            commercialLicenseUsd: data.commercialLicenseUsd ?? null,
          });
        }
      })
      .catch(() => {
        /* no prefill — manual pricing still works */
      });
    return () => {
      cancelled = true;
    };
  }, [stemId]);

  if (!isOpen) return null;

  const handleSelectTier = (tier: LicenseType) => {
    setLicenseType(tier);
    // Prefill only for USD-denominated listing assets, where catalog USD
    // pricing maps 1:1; the seller can always overwrite the price.
    const defaultUsd = tierDefaultPriceUsd(tierPricing, tier);
    if (usdDenominated && defaultUsd != null) {
      setPrice(String(defaultUsd));
    }
  };

  const handleList = async () => {
    try {
      const durationSeconds = BigInt(parseInt(duration) * 24 * 60 * 60);
      const listAmount = BigInt(amount);
      const hash = await list({
        tokenId,
        amount: listAmount,
        pricePerUnit: priceUnits,
        paymentToken: listingToken,
        durationSeconds,
      });
      // Record the listing intent so the indexer stamps the chosen license
      // tier (the on-chain listing carries no license type). Best-effort:
      // the listing itself already succeeded — but for non-personal tiers,
      // a failed intent means the listing will index as Personal, so the
      // seller must be told.
      const seller = smartAccountAddress || address;
      const warnTierMayBeLost = () => {
        if (licenseType === "personal") return;
        addToast({
          type: "warning",
          title: "License tier may not have been recorded",
          message:
            "Your listing was created, but it may appear as a Personal license. If it does, cancel and relist it.",
        });
      };
      if (seller) {
        fetch("/api/contracts/notify-listing", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            buildNotifyListingPayload({
              tokenId,
              chainId,
              seller,
              priceUnits,
              amount: listAmount,
              paymentToken: listingToken,
              durationSeconds,
              transactionHash: hash,
              licenseType,
              stemId,
            }),
          ),
        })
          .then((res) => {
            if (!res.ok) warnTierMayBeLost();
          })
          .catch(() => {
            warnTierMayBeLost();
          });
      } else {
        warnTierMayBeLost();
      }
      onSuccess?.(hash);
    } catch {
      // Error handled by hook
    }
  };

  const maxAmount = balance;
  const txExplorerUrl = getExplorerTxUrl(txHash);
  const editionHint = multiTierEditionHint({ balance, tier: licenseType });
  const manualPriceUsd = usdDenominated ? parseFloat(price) || 0 : 0;
  const parsedAmount = Math.max(1, Number.parseInt(amount || "1", 10) || 1);
  const proceedsLine = protocolFeeLoading
    ? null
    : sellerNetProceedsLine({
      priceUnits,
      quantity: BigInt(parsedAmount),
      asset: listingAsset,
      protocolFeeBps,
      royaltyBps: stemData?.royaltyBps,
    });

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

          {/* License Tier */}
          <div>
            <LicenseTypeSelector
              selected={licenseType}
              onSelect={handleSelectTier}
              personalPriceUsd={licenseType === "personal" ? manualPriceUsd : 0}
              remixPriceUsd={tierDefaultPriceUsd(tierPricing, "remix") ?? 5}
              commercialPriceUsd={tierDefaultPriceUsd(tierPricing, "commercial") ?? 25}
            />
            <p className="text-xs text-zinc-500 mt-1">
              Buyers receive the rights of the license tier you list. A remix
              license is what unlocks Remix Studio for this stem.
            </p>
            {editionHint && (
              <p className="text-xs text-amber-400/90 mt-1 listing-edition-hint">
                {editionHint}
              </p>
            )}
          </div>

          {/* Price Input */}
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-1">
              {listingSymbol} price per edition
            </label>
            <input
              type="number"
              min="0"
              step={listingStep}
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-white"
            />
          </div>

          {/* Amount Input */}
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-1">
              Quantity to List (max: {maxAmount.toString()})
            </label>
            <input
              type="number"
              min="1"
              max={maxAmount.toString()}
              value={amount}
              onChange={(e) => {
                const val = parseInt(e.target.value || "1");
                const max = Number(maxAmount);
                setAmount(Math.min(Math.max(val, 1), max).toString());
              }}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-white"
            />
          </div>

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
              <span className="text-zinc-400">License</span>
              <span className="text-white capitalize">{licenseType}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-zinc-400">Total Value</span>
              <span className="text-white">
                {formatListingPrice({
                  priceUnits: priceUnits * BigInt(parseInt(amount || "1")),
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
              disabled={pending || paymentAssetsLoading || maxAmount === 0n || !price || priceUnits <= 0n}
              className="flex-1 bg-emerald-600 hover:bg-emerald-700 disabled:bg-zinc-700 disabled:cursor-not-allowed text-white py-3 rounded-md transition-colors"
            >
              {paymentAssetsLoading ? "Loading asset..." : pending ? "Listing..." : "List for Sale"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
