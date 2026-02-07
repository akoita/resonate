"use client";

import { formatPrice, formatRoyaltyBps } from "../../lib/contracts";
import { useBuyQuote, useStemData } from "../../hooks/useContracts";

interface ListingCardProps {
  listingId: bigint;
  tokenId: bigint;
  seller: string;
  price: bigint;
  amount: bigint;
  expiresAt: Date;
  stemTitle?: string;
  stemType?: string;
  imageUrl?: string;
  onBuy?: () => void;
}

export function ListingCard({
  listingId,
  tokenId,
  seller,
  price,
  amount,
  expiresAt,
  stemTitle,
  stemType,
  imageUrl,
  onBuy,
}: ListingCardProps) {
  const { data: stemData } = useStemData(tokenId);
  const { quote } = useBuyQuote(listingId, 1n);

  const isExpired = expiresAt < new Date();
  const priceEth = formatPrice(price);

  return (
    <div className="bg-zinc-900 rounded-lg border border-zinc-800 overflow-hidden hover:border-zinc-700 transition-colors">
      {/* Image */}
      <div className="aspect-square bg-zinc-800 relative">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={stemTitle || `Stem #${tokenId}`}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <svg
              className="w-16 h-16 text-zinc-700"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1}
                d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"
              />
            </svg>
          </div>
        )}
        {stemType && (
          <span className="absolute top-2 left-2 bg-black/70 text-xs text-white px-2 py-1 rounded">
            {stemType}
          </span>
        )}
        {isExpired && (
          <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
            <span className="text-zinc-400 font-medium">Expired</span>
          </div>
        )}
      </div>

      {/* Info */}
      <div className="p-4 space-y-3">
        <div>
          <h3 className="text-white font-medium truncate">
            {stemTitle || `Stem #${tokenId}`}
          </h3>
          <p className="text-sm text-zinc-500 truncate">
            by {seller.slice(0, 6)}...{seller.slice(-4)}
          </p>
        </div>

        {/* Price & Royalty */}
        <div className="flex items-end justify-between">
          <div>
            <p className="text-xs text-zinc-500">Price</p>
            <p className="text-lg font-semibold text-white">{priceEth} ETH</p>
          </div>
          {stemData && (
            <div className="text-right">
              <p className="text-xs text-zinc-500">Royalty</p>
              <p className="text-sm text-zinc-400">
                {formatRoyaltyBps(stemData.royaltyBps)}
              </p>
            </div>
          )}
        </div>

        {/* Quote Breakdown */}
        {quote && (
          <div className="text-xs text-zinc-500 space-y-1 border-t border-zinc-800 pt-2">
            <div className="flex justify-between">
              <span>Creator royalty:</span>
              <span>{formatPrice(quote.royaltyAmount)} ETH</span>
            </div>
            <div className="flex justify-between">
              <span>Protocol fee:</span>
              <span>{formatPrice(quote.protocolFee)} ETH</span>
            </div>
            <div className="flex justify-between text-zinc-400">
              <span>Seller receives:</span>
              <span>{formatPrice(quote.sellerAmount)} ETH</span>
            </div>
          </div>
        )}

        {/* Amount Available */}
        <p className="text-xs text-zinc-500">
          {amount.toString()} edition{amount > 1n ? "s" : ""} available
        </p>

        {/* Buy Button */}
        {!isExpired && onBuy && (
          <button
            onClick={onBuy}
            className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-medium py-2 rounded-md transition-colors"
          >
            Buy Now
          </button>
        )}
      </div>
    </div>
  );
}
