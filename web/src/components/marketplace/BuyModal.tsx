"use client";

import { useState, useEffect, useMemo } from "react";
import { useBuyQuote, useBuyStem, useListing } from "../../hooks/useContracts";
import { useX402PublicConfig } from "../../hooks/useX402PublicConfig";
import { useAuth } from "../auth/AuthProvider";
import { formatPrice } from "../../lib/contracts";
import { payStemWithX402, X402PaymentError, type X402PaymentResult } from "../../lib/x402Pay";
import { LicenseTypeSelector, type LicenseType } from "./LicenseTypeSelector";
import { LicenseTermsPreview } from "./LicenseTermsPreview";
import "../../styles/buy-modal.css";
import "../../styles/license-badges.css";
import "../../styles/license-terms.css";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

type X402StatusPhase = "challenging" | "signing" | "settling" | "downloading";

const X402_STATUS_LABEL: Record<X402StatusPhase, string> = {
  challenging: "Requesting payment quote…",
  signing: "Awaiting wallet signature…",
  settling: "Settling payment with facilitator…",
  downloading: "Downloading stem…",
};

type X402QuoteInfo = {
  amountUsd: number | null;
  payTo: string | null;
};

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
  const [paymentMethod, setPaymentMethod] = useState<"onchain" | "x402">("onchain");
  const [x402Quote, setX402Quote] = useState<X402QuoteInfo | null>(null);
  const [x402Status, setX402Status] = useState<X402StatusPhase | null>(null);
  const [x402Error, setX402Error] = useState<string | null>(null);
  const [x402Result, setX402Result] = useState<X402PaymentResult | null>(null);
  const { listing, loading: listingLoading } = useListing(listingId);
  const { quote, loading: quoteLoading } = useBuyQuote(listingId, amount);
  const { buy, pending, error, txHash } = useBuyStem();
  const { config: x402Config } = useX402PublicConfig();
  const { kernelAccount, login } = useAuth();
  const x402Available = useMemo(
    () => Boolean(x402Config?.enabled && stemId),
    [x402Config, stemId],
  );
  const x402Asset = x402Config?.enabled ? x402Config.asset : null;
  const x402DownloadUrl = useMemo(
    () => (x402Result ? URL.createObjectURL(x402Result.audio) : null),
    [x402Result],
  );
  useEffect(() => {
    if (!x402DownloadUrl) return;
    return () => URL.revokeObjectURL(x402DownloadUrl);
  }, [x402DownloadUrl]);

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

  // Fetch x402 quote when the user switches to the x402 method
  useEffect(() => {
    if (!isOpen || paymentMethod !== "x402" || !stemId || !x402Available) return;
    let cancelled = false;
    fetch(`${API_BASE}/api/stems/${stemId}/x402/info`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data?.x402) return;
        setX402Quote({
          amountUsd: typeof data.price?.usd === "number" ? data.price.usd : null,
          payTo: data.x402?.payTo ?? null,
        });
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("x402 quote fetch error:", err);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, paymentMethod, stemId, x402Available]);

  // Reset x402 transient state whenever the modal is closed/reopened
  useEffect(() => {
    if (isOpen) return;
    setX402Status(null);
    setX402Error(null);
    setX402Result(null);
  }, [isOpen]);

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

  const handleX402Pay = async () => {
    if (!stemId) return;
    setX402Error(null);
    setX402Result(null);
    try {
      // Kernel accounts are lazily reconstructed after page reloads, so the
      // value from useAuth() may be null even when the user is authenticated.
      // Mirror what signMessage does and reconnect via login() before signing.
      let signer = kernelAccount;
      if (!signer?.signTypedData) {
        signer = await login();
      }
      if (!signer?.signTypedData) {
        setX402Error(
          "Could not connect a wallet that supports typed-data signing. Try signing in again, or use an EOA wallet that holds USDC.",
        );
        return;
      }
      // viem's toSmartAccount is supposed to wrap signTypedData with ERC-6492
      // when the Kernel smart account is not yet deployed, but on staging the
      // facilitator keeps reporting invalid_exact_evm_payload_undeployed_smart_wallet.
      // Wrap the signer so we can confirm the signature shape end-to-end.
      const debugSigner = {
        address: signer.address,
        signTypedData: async (msg: Parameters<typeof signer.signTypedData>[0]) => {
          let isDeployed: boolean | string = "unknown";
          let factoryArgs: { factory?: string; factoryData?: string } = {};
          try {
            isDeployed = typeof signer.isDeployed === "function"
              ? await signer.isDeployed()
              : "no isDeployed()";
          } catch (probeErr) {
            isDeployed = `probe error: ${probeErr instanceof Error ? probeErr.message : String(probeErr)}`;
          }
          try {
            factoryArgs = typeof signer.getFactoryArgs === "function"
              ? await signer.getFactoryArgs()
              : { factory: undefined, factoryData: undefined };
          } catch (probeErr) {
            factoryArgs = {
              factory: `probe error: ${probeErr instanceof Error ? probeErr.message : String(probeErr)}`,
            };
          }
          console.info("[x402 debug] account state before sign", {
            address: signer.address,
            isDeployed,
            factory: factoryArgs.factory,
            factoryDataLength: factoryArgs.factoryData?.length,
          });
          const sig = await signer.signTypedData(msg);
          const ERC6492_MAGIC = "6492649264926492649264926492649264926492649264926492649264926492";
          const sigStr = typeof sig === "string" ? sig : String(sig);
          const tail = sigStr.slice(-64).toLowerCase();
          console.info("[x402 debug] signature shape", {
            length: sigStr.length,
            endsWithErc6492Magic: tail === ERC6492_MAGIC,
            tail,
          });
          return sig;
        },
      };
      const result = await payStemWithX402({
        stemId,
        signer: debugSigner,
        onStatus: (phase) => setX402Status(phase),
      });
      setX402Result(result);
      setX402Status(null);
    } catch (err) {
      const message = err instanceof X402PaymentError
        ? err.message
        : err instanceof Error
          ? err.message
          : String(err);
      setX402Error(message);
      setX402Status(null);
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

            {/* Payment method (#705) — only shown when x402 is configured for this server */}
            {x402Available && (
              <div className="buy-modal__pay-methods" role="tablist" aria-label="Payment method">
                <button
                  type="button"
                  role="tab"
                  aria-selected={paymentMethod === "onchain"}
                  className={`buy-modal__pay-method${paymentMethod === "onchain" ? " buy-modal__pay-method--active" : ""}`}
                  onClick={() => setPaymentMethod("onchain")}
                  disabled={pending || x402Status !== null}
                >
                  <span>On-chain</span>
                  <span className="buy-modal__pay-method-sub">NFT mint · ETH</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={paymentMethod === "x402"}
                  className={`buy-modal__pay-method${paymentMethod === "x402" ? " buy-modal__pay-method--active" : ""}`}
                  onClick={() => setPaymentMethod("x402")}
                  disabled={pending || x402Status !== null}
                >
                  <span>USDC (x402)</span>
                  <span className="buy-modal__pay-method-sub">Pay-per-download</span>
                </button>
              </div>
            )}

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
            {paymentMethod === "onchain" && quote && !quoteLoading && (
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

            {/* x402 Quote */}
            {paymentMethod === "x402" && (
              <div className="buy-modal__x402-quote" data-testid="buy-modal-x402-quote">
                <div className="buy-modal__x402-row">
                  <span>Stem download (personal license)</span>
                  <span>{x402Quote?.amountUsd != null ? `$${x402Quote.amountUsd.toFixed(2)}` : "—"}</span>
                </div>
                <div className="buy-modal__x402-row">
                  <span>Asset</span>
                  <span>{x402Asset?.name ?? "USDC"}</span>
                </div>
                {x402Quote?.payTo && (
                  <div className="buy-modal__x402-row">
                    <span>Pay to</span>
                    <span>
                      {x402Quote.payTo.slice(0, 6)}…{x402Quote.payTo.slice(-4)}
                    </span>
                  </div>
                )}
                <div className="buy-modal__x402-row buy-modal__x402-row--total">
                  <span>Total</span>
                  <span>{x402Quote?.amountUsd != null ? `$${x402Quote.amountUsd.toFixed(2)} USDC` : "—"}</span>
                </div>
                {x402Status && (
                  <div className="buy-modal__x402-status" role="status">
                    {X402_STATUS_LABEL[x402Status]}
                  </div>
                )}
              </div>
            )}

            {/* Error */}
            {paymentMethod === "onchain" && error && (
              <div className="buy-modal__alert buy-modal__alert--error">
                {error.message}
              </div>
            )}
            {paymentMethod === "x402" && x402Error && (
              <div className="buy-modal__alert buy-modal__alert--error">
                {x402Error}
              </div>
            )}

            {/* Success */}
            {paymentMethod === "onchain" && txHash && (
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
            {paymentMethod === "x402" && x402Result && x402DownloadUrl && (
              <div className="buy-modal__alert buy-modal__alert--success">
                Payment settled.{" "}
                <a
                  href={x402DownloadUrl}
                  download={x402Result.filename}
                >
                  Download stem →
                </a>
                {x402Result.receiptId && (
                  <div className="buy-modal__x402-status">
                    Receipt {x402Result.receiptId}
                  </div>
                )}
              </div>
            )}

            {/* Actions */}
            <div className="buy-modal__actions">
              <button className="buy-modal__btn buy-modal__btn--cancel" onClick={onClose}>
                Cancel
              </button>
              {paymentMethod === "onchain" ? (
                <button
                  className="buy-modal__btn buy-modal__btn--confirm"
                  onClick={handleBuy}
                  disabled={pending || !quote}
                >
                  {pending && <span className="buy-modal__spinner" />}
                  {pending ? "Confirming…" : "Confirm Purchase"}
                </button>
              ) : (
                <button
                  className="buy-modal__btn buy-modal__btn--confirm"
                  onClick={handleX402Pay}
                  disabled={x402Status !== null || !x402Quote}
                >
                  {x402Status !== null && <span className="buy-modal__spinner" />}
                  {x402Status !== null ? X402_STATUS_LABEL[x402Status] : "Pay with USDC"}
                </button>
              )}
            </div>
          </div>
        ) : (
          <p className="buy-modal__not-found">Listing not found</p>
        )}
      </div>
    </div>
  );
}
