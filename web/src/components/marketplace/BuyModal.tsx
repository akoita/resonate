"use client";

import { useState, useEffect } from "react";
import { useBuyQuote, useBuyStem, useListing } from "../../hooks/useContracts";
import { formatPrice } from "../../lib/contracts";
import { LicenseTypeSelector, type LicenseType } from "./LicenseTypeSelector";
import { LicenseTermsPreview } from "./LicenseTermsPreview";
import "../../styles/buy-modal.css";
import "../../styles/license-badges.css";
import "../../styles/license-terms.css";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

interface BuyModalProps {
  listingId: bigint;
  stemId?: string;
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (txHash: string) => void;
}

export function BuyModal({ listingId, stemId, isOpen, onClose, onSuccess }: BuyModalProps) {
  const [amount, setAmount] = useState(1n);
  const [selectedLicense, setSelectedLicense] = useState<LicenseType>("personal");
  const [stemPricing, setStemPricing] = useState<{
    personal: number; remix: number; commercial: number;
  } | null>(null);
  const { listing, loading: listingLoading } = useListing(listingId);
  const { quote, loading: quoteLoading } = useBuyQuote(listingId, amount);
  const { buy, pending, error, txHash } = useBuyStem();

  // Fetch stem pricing for license type selector
  useEffect(() => {
    if (!stemId || !isOpen) return;
    fetch(`${API_BASE}/api/stem-pricing/${stemId}`)
      .then(res => res.json())
      .then(data => {
        if (data.computed) setStemPricing(data.computed);
      })
      .catch(err => console.error("Pricing fetch error:", err));
  }, [stemId, isOpen]);

  if (!isOpen) return null;

  const handleBuy = async () => {
    try {
      // TODO Phase 2: Pass selectedLicense to LicenseRegistry.mintLicense()
      const hash = await buy(listingId, amount);
      onSuccess?.(hash);
    } catch {
      // Error handled by hook
    }
  };

  const maxAmount = listing?.amount || 1n;

  return (
    <div className="buy-modal-overlay">
      {/* Backdrop */}
      <div className="buy-modal-backdrop" onClick={onClose} />

      {/* Modal */}
      <div className="buy-modal">
        {/* Close */}
        <button className="buy-modal__close" onClick={onClose}>×</button>

        {/* Header */}
        <div className="buy-modal__header">
          <h2 className="buy-modal__title">
            <span className="buy-modal__title-icon">🎵</span>
            Purchase Stem
          </h2>
        </div>

        {listingLoading ? (
          <div className="buy-modal__skeleton">
            <div className="buy-modal__skeleton-line" />
            <div className="buy-modal__skeleton-line" />
          </div>
        ) : listing ? (
          <div className="buy-modal__body">
            {/* Listing Info */}
            <div className="buy-modal__info-card">
              <div className="buy-modal__info-icon">🔷</div>
              <div className="buy-modal__info-details">
                <div className="buy-modal__info-label">Token #{listing.tokenId.toString()}</div>
                <div className="buy-modal__info-value">
                  {listing.seller.slice(0, 10)}…{listing.seller.slice(-8)}
                </div>
              </div>
            </div>

            {/* Quantity */}
            <div className="buy-modal__quantity">
              <label className="buy-modal__quantity-label">
                Quantity (max: {maxAmount.toString()})
              </label>
              <div className="buy-modal__quantity-controls">
                <button
                  className="buy-modal__qty-btn"
                  onClick={() => setAmount(a => (a > 1n ? a - 1n : a))}
                  disabled={amount <= 1n}
                >
                  −
                </button>
                <input
                  className="buy-modal__qty-input"
                  type="number"
                  min="1"
                  max={maxAmount.toString()}
                  value={amount.toString()}
                  onChange={e => {
                    const val = BigInt(e.target.value || "1");
                    setAmount(val > maxAmount ? maxAmount : val < 1n ? 1n : val);
                  }}
                />
                <button
                  className="buy-modal__qty-btn"
                  onClick={() => setAmount(a => (a < maxAmount ? a + 1n : a))}
                  disabled={amount >= maxAmount}
                >
                  +
                </button>
              </div>
            </div>

            {/* License Type Selector */}
            {stemPricing && (
              <LicenseTypeSelector
                selected={selectedLicense}
                onSelect={setSelectedLicense}
                personalPriceUsd={stemPricing.personal}
                remixPriceUsd={stemPricing.remix}
                commercialPriceUsd={stemPricing.commercial}
              />
            )}

            {/* License Terms Preview */}
            <LicenseTermsPreview licenseType={selectedLicense} compact />

            {/* Price Breakdown */}
            {quote && !quoteLoading && (
              <div className="buy-modal__breakdown">
                <div className="buy-modal__breakdown-row">
                  <span className="buy-modal__breakdown-label">
                    Price ({amount.toString()} × {formatPrice(listing.pricePerUnit)})
                  </span>
                  <span className="buy-modal__breakdown-value">
                    {formatPrice(listing.pricePerUnit * amount)} ETH
                  </span>
                </div>
                <div className="buy-modal__breakdown-row">
                  <span className="buy-modal__breakdown-label">Creator Royalty</span>
                  <span className="buy-modal__breakdown-value buy-modal__breakdown-value--royalty">
                    {formatPrice(quote.royaltyAmount)} ETH
                  </span>
                </div>
                <div className="buy-modal__breakdown-row">
                  <span className="buy-modal__breakdown-label">Protocol Fee</span>
                  <span className="buy-modal__breakdown-value buy-modal__breakdown-value--fee">
                    {formatPrice(quote.protocolFee)} ETH
                  </span>
                </div>
                <div className="buy-modal__breakdown-divider" />
                <div className="buy-modal__breakdown-row buy-modal__breakdown-row--total">
                  <span className="buy-modal__breakdown-label">Total</span>
                  <span className="buy-modal__breakdown-value">
                    {formatPrice(quote.totalPrice)} ETH
                  </span>
                </div>
              </div>
            )}

            {/* Error */}
            {error && (
              <div className="buy-modal__alert buy-modal__alert--error">
                {error.message}
              </div>
            )}

            {/* Success */}
            {txHash && (
              <div className="buy-modal__alert buy-modal__alert--success">
                Purchase successful!{" "}
                <a
                  href={`https://sepolia.etherscan.io/tx/${txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  View transaction →
                </a>
              </div>
            )}

            {/* Actions */}
            <div className="buy-modal__actions">
              <button className="buy-modal__btn buy-modal__btn--cancel" onClick={onClose}>
                Cancel
              </button>
              <button
                className="buy-modal__btn buy-modal__btn--confirm"
                onClick={handleBuy}
                disabled={pending || !quote}
              >
                {pending && <span className="buy-modal__spinner" />}
                {pending ? "Confirming…" : "Confirm Purchase"}
              </button>
            </div>
          </div>
        ) : (
          <p className="buy-modal__not-found">Listing not found</p>
        )}
      </div>
    </div>
  );
}
