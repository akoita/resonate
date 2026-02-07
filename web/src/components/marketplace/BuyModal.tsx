"use client";

import { useState } from "react";
import { useBuyQuote, useBuyStem, useListing } from "../../hooks/useContracts";
import { formatPrice } from "../../lib/contracts";

interface BuyModalProps {
  listingId: bigint;
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (txHash: string) => void;
}

export function BuyModal({ listingId, isOpen, onClose, onSuccess }: BuyModalProps) {
  const [amount, setAmount] = useState(1n);
  const { listing, loading: listingLoading } = useListing(listingId);
  const { quote, loading: quoteLoading } = useBuyQuote(listingId, amount);
  const { buy, pending, error, txHash } = useBuyStem();

  if (!isOpen) return null;

  const handleBuy = async () => {
    try {
      const hash = await buy(listingId, amount);
      onSuccess?.(hash);
    } catch (err) {
      // Error handled by hook
    }
  };

  const maxAmount = listing?.amount || 1n;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-zinc-900 rounded-lg border border-zinc-800 w-full max-w-md mx-4 p-6">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-zinc-500 hover:text-white"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        <h2 className="text-xl font-semibold text-white mb-4">Purchase Stem</h2>

        {listingLoading ? (
          <div className="animate-pulse space-y-4">
            <div className="h-4 bg-zinc-800 rounded w-3/4" />
            <div className="h-4 bg-zinc-800 rounded w-1/2" />
          </div>
        ) : listing ? (
          <div className="space-y-4">
            {/* Listing Info */}
            <div className="bg-zinc-800 rounded-lg p-4">
              <p className="text-sm text-zinc-400">Token ID</p>
              <p className="text-white font-mono">{listing.tokenId.toString()}</p>
              <p className="text-sm text-zinc-400 mt-2">Seller</p>
              <p className="text-white font-mono text-sm">
                {listing.seller.slice(0, 10)}...{listing.seller.slice(-8)}
              </p>
            </div>

            {/* Amount Selector */}
            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-1">
                Quantity (max: {maxAmount.toString()})
              </label>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setAmount((a) => (a > 1n ? a - 1n : a))}
                  disabled={amount <= 1n}
                  className="w-10 h-10 bg-zinc-800 rounded-md text-white disabled:opacity-50"
                >
                  -
                </button>
                <input
                  type="number"
                  min="1"
                  max={maxAmount.toString()}
                  value={amount.toString()}
                  onChange={(e) => {
                    const val = BigInt(e.target.value || "1");
                    setAmount(val > maxAmount ? maxAmount : val < 1n ? 1n : val);
                  }}
                  className="flex-1 bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-center text-white"
                />
                <button
                  onClick={() => setAmount((a) => (a < maxAmount ? a + 1n : a))}
                  disabled={amount >= maxAmount}
                  className="w-10 h-10 bg-zinc-800 rounded-md text-white disabled:opacity-50"
                >
                  +
                </button>
              </div>
            </div>

            {/* Price Breakdown */}
            {quote && !quoteLoading && (
              <div className="bg-zinc-800 rounded-lg p-4 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-zinc-400">
                    Price ({amount.toString()} x {formatPrice(listing.pricePerUnit)})
                  </span>
                  <span className="text-white">
                    {formatPrice(listing.pricePerUnit * amount)} ETH
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-zinc-400">Creator Royalty</span>
                  <span className="text-emerald-400">
                    {formatPrice(quote.royaltyAmount)} ETH
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-zinc-400">Protocol Fee</span>
                  <span className="text-zinc-400">
                    {formatPrice(quote.protocolFee)} ETH
                  </span>
                </div>
                <div className="border-t border-zinc-700 pt-2 flex justify-between">
                  <span className="text-zinc-300 font-medium">Total</span>
                  <span className="text-white font-semibold">
                    {formatPrice(quote.totalPrice)} ETH
                  </span>
                </div>
              </div>
            )}

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
                  Purchase successful!{" "}
                  <a
                    href={`https://sepolia.etherscan.io/tx/${txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline"
                  >
                    View transaction
                  </a>
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
                onClick={handleBuy}
                disabled={pending || !quote}
                className="flex-1 bg-emerald-600 hover:bg-emerald-700 disabled:bg-zinc-700 disabled:cursor-not-allowed text-white py-3 rounded-md transition-colors"
              >
                {pending ? "Confirming..." : "Confirm Purchase"}
              </button>
            </div>
          </div>
        ) : (
          <p className="text-zinc-400">Listing not found</p>
        )}
      </div>
    </div>
  );
}
