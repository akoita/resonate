"use client";

import { useState, useEffect, useMemo } from "react";
import type { Address } from "viem";
import { useBuyQuote, useBuyStem, useListing, useProtocolFee, useStemData } from "../../hooks/useContracts";
import { usePaymentAssets } from "../../hooks/usePaymentAssets";
import { useX402PublicConfig } from "../../hooks/useX402PublicConfig";
import { useAuth } from "../auth/AuthProvider";
import { useZeroDev } from "../auth/ZeroDevProviderClient";
import { API_BASE } from "../../lib/api";
import { recordProductAnalytics } from "../../lib/productAnalytics";
import {
  defaultBuyPaymentMethod,
  formatUsdPrice,
  getCheckoutRailLabel,
  getCheckoutRailSubLabel,
  type BuyPaymentMethod,
} from "../../lib/buyPricing";
import { getExplorerTxUrl } from "../../lib/explorer";
import {
  findPaymentAssetForToken,
  formatPaymentAmount,
  isNativePaymentToken,
  paymentAssetSymbol,
} from "../../lib/payments";
import { hasStablecoinMarketplaceAsset } from "../../lib/listingPricing";
import { formatBpsPercent } from "../../lib/marketplaceProceeds";
import { getX402ChainName } from "../../lib/x402BrowserWallet";
import { payStemWithX402SmartAccount } from "../../lib/x402SmartAccountPay";
import type { X402PaymentResult } from "../../lib/x402Pay";
import {
  getX402TransferParams,
  parseX402StemQuote,
  type X402StemQuote,
} from "../../lib/x402StemQuote";
import { LicenseTermsPreview } from "./LicenseTermsPreview";
import { StemSourceBadge } from "../stem/StemSourceBadge";
import { LICENSE_PLAIN_TERMS, STEM_SOURCE_DESCRIPTIONS, type StemSource } from "../../lib/stemSource";
import { LicenseTypeSelector, type LicenseType } from "./LicenseTypeSelector";
import { PurchaseHandoff } from "./PurchaseHandoff";
import type { Listing } from "../../lib/contracts";
import "../../styles/buy-modal.css";
import { DeliveryConsentStep, useConsentWording } from "../consent/DeliveryConsentStep";
import {
  INITIAL_DELIVERY_CONSENT,
  formatHoldDate,
  isDeliveryConsentComplete,
  recordDeliveryChoice,
  type DeliveryConsentState,
} from "../consent/deliveryConsent";
import "../../styles/license-terms.css";

type X402StatusPhase = "challenging" | "signing" | "settling" | "downloading";

const X402_STATUS_LABEL: Record<X402StatusPhase, string> = {
  challenging: "Requesting payment quote…",
  signing: "Awaiting wallet signature…",
  settling: "Verifying payment on-chain…",
  downloading: "Downloading stem…",
};

function getX402WalletNote(
  x402ChainId: number | null | undefined,
  assetSymbol: string,
) {
  const x402Chain = getX402ChainName(x402ChainId);
  return `x402 checkout uses your Resonate passkey wallet with ${assetSymbol} on ${x402Chain}.`;
}

type TierListings = Partial<Record<LicenseType, string>>;

type IndexedListingSnapshot = {
  listingId: string;
  tokenId: string;
  chainId: number;
  seller: string;
  price: string;
  amount: string;
  paymentToken?: string;
  expiresAt: string;
};

interface BuyModalProps {
  listingId: bigint;
  stemId?: string;
  artistId?: string;
  /** Source catalog track: enables "Open in Remix Studio" after a remix-ready purchase (#2042). */
  trackId?: string;
  trackTitle?: string;
  listingChainId?: number;
  initialListing?: IndexedListingSnapshot;
  licenseType?: LicenseType;
  /** Where the stem's audio comes from (#1976); shown next to the license terms. */
  stemSource?: StemSource | null;
  separationModel?: string | null;
  tierListings?: TierListings;
  tierPricesUsd?: Partial<Record<LicenseType, number>>;
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (txHash: string, purchase?: BuyModalPurchase) => void;
}

/** What was actually bought (#1173): pages use this to settle eligibility. */
export type BuyModalPurchase = {
  licenseType: LicenseType;
  amount: bigint;
  listingId: bigint;
};

const LICENSE_TYPES: LicenseType[] = ["personal", "remix", "commercial"];

/**
 * A purchase that finished inside the modal (#2042). Captured at the moment
 * of success so the success view no longer depends on the listing, which the
 * caller may refresh, consume, or swap underneath the open modal.
 */
export type CompletedPurchase =
  | { method: "onchain"; licenseType: LicenseType; txHash: string; waited?: boolean }
  | { method: "x402"; licenseType: LicenseType; result: X402PaymentResult };

export type BuyModalView = "success" | "loading" | "consumed" | "listing" | "not_found";

/**
 * Which body the modal shows. A finished purchase always wins: once the buyer
 * has paid, the modal shows the outcome and next steps (and nothing that can
 * buy again), even if the listing has since sold out or is reloading.
 */
export function resolveBuyModalView(input: {
  completed: CompletedPurchase | null;
  listingLoading: boolean;
  hasListing: boolean;
  consumed: boolean;
}): BuyModalView {
  if (input.completed) return "success";
  if (input.listingLoading) return "loading";
  if (input.hasListing && input.consumed) return "consumed";
  if (input.hasListing) return "listing";
  return "not_found";
}

/**
 * A consumed or cancelled marketplace listing reads back from the contract
 * as a zeroed struct (#1172). Without this check the modal rendered
 * "TOKEN #0 / 0x0000…0000 / 0 ETH" with a misleading legacy-native-ETH
 * warning for a listing that was never ETH-denominated. The indexed row can
 * lag the chain (sold-out listings linger transiently), so the modal must
 * recognize the phantom rather than invite a purchase of nothing.
 */
export function isConsumedOnchainListing(
  listing: { seller: string; amount: bigint } | null | undefined,
): boolean {
  if (!listing) return false;
  return /^0x0{40}$/i.test(listing.seller) || listing.amount === 0n;
}

/**
 * The legacy native-ETH re-list warning applies only to LIVE listings whose
 * payment token is the zero address by design (pre-stablecoin listings). A
 * consumed listing also reads paymentToken = 0x0, which is what made the
 * #1172 phantom look like a legacy ETH listing.
 */
export function showLegacyNativeWarning(
  listing:
    | { seller: string; amount: bigint; paymentToken: string }
    | null
    | undefined,
  stablecoinMarketplaceConfigured: boolean,
): boolean {
  if (!listing || isConsumedOnchainListing(listing)) return false;
  return (
    isNativePaymentToken(listing.paymentToken) && stablecoinMarketplaceConfigured
  );
}

export function BuyModal({
  listingId,
  stemId,
  artistId,
  trackId,
  trackTitle,
  listingChainId,
  initialListing,
  licenseType = "personal",
  stemSource,
  separationModel,
  tierListings,
  tierPricesUsd,
  isOpen,
  onClose,
  onSuccess,
}: BuyModalProps) {
  const [amount, setAmount] = useState(1n);
  const [selectedLicense, setSelectedLicense] = useState<LicenseType>(licenseType);
  const [paymentMethod, setPaymentMethod] = useState<BuyPaymentMethod>("onchain");
  const [x402Quote, setX402Quote] = useState<X402StemQuote | null>(null);
  const [x402QuoteLoading, setX402QuoteLoading] = useState(false);
  const [x402QuoteError, setX402QuoteError] = useState<string | null>(null);
  const [x402Status, setX402Status] = useState<X402StatusPhase | null>(null);
  const [x402Error, setX402Error] = useState<string | null>(null);
  const [x402Result, setX402Result] = useState<X402PaymentResult | null>(null);
  const [x402Payer, setX402Payer] = useState<string | null>(null);
  const [completed, setCompleted] = useState<CompletedPurchase | null>(null);
  // #1776: the delivery choice is made, and recorded, before any payment starts.
  const [delivery, setDelivery] = useState<DeliveryConsentState>(INITIAL_DELIVERY_CONSENT);
  const [consentError, setConsentError] = useState<string | null>(null);
  const [recordingConsent, setRecordingConsent] = useState(false);
  // An on-chain listing with no catalogue stem has no file this app delivers,
  // so there is nothing to consent to.
  const needsDeliveryConsent = Boolean(stemId);
  const { wording, error: wordingError } = useConsentWording(isOpen && needsDeliveryConsent);
  const deliveryComplete = !needsDeliveryConsent || isDeliveryConsentComplete(delivery);
  const deliveryReady = !needsDeliveryConsent || Boolean(wording);
  const {
    status: authStatus,
    webAuthnKey,
    login,
    token,
    userId,
    address: authAddress,
    smartAccountAddress,
  } = useAuth();
  const { chainId } = useZeroDev();
  const { assets: paymentAssets } = usePaymentAssets(chainId);
  const listingChainMismatch = listingChainId != null && chainId !== listingChainId;
  const selectedListingId = useMemo(() => {
    const tierListingId = tierListings?.[selectedLicense];
    if (tierListingId) return BigInt(tierListingId);
    return selectedLicense === licenseType ? listingId : undefined;
  }, [licenseType, listingId, selectedLicense, tierListings]);
  const initialListingForSelection = useMemo<Listing | null>(() => {
    if (!initialListing || selectedListingId == null) return null;
    if (BigInt(initialListing.listingId) !== selectedListingId) return null;

    return {
      seller: initialListing.seller as Address,
      tokenId: BigInt(initialListing.tokenId),
      amount: BigInt(initialListing.amount),
      pricePerUnit: BigInt(initialListing.price),
      paymentToken: (initialListing.paymentToken || "0x0000000000000000000000000000000000000000") as Address,
      expiry: Math.floor(new Date(initialListing.expiresAt).getTime() / 1000),
    };
  }, [initialListing, selectedListingId]);
  const shouldReadOnchainListing = selectedListingId !== undefined && !initialListingForSelection && !listingChainMismatch;
  const { listing: onchainListing, loading: onchainListingLoading } = useListing(
    shouldReadOnchainListing ? selectedListingId : undefined,
  );
  const listing = initialListingForSelection ?? onchainListing;
  const listingLoading = !initialListingForSelection && onchainListingLoading;
  const { data: stemData } = useStemData(listing?.tokenId);
  const { feeBps: protocolFeeBps } = useProtocolFee();
  const canQuoteOnchain = !listingChainMismatch && selectedListingId !== undefined;
  const { quote, loading: quoteLoading } = useBuyQuote(canQuoteOnchain ? selectedListingId : undefined, amount);
  const { buy, pending, error } = useBuyStem();
  const { config: x402Config } = useX402PublicConfig();
  const x402Asset = x402Config?.enabled ? x402Config.asset : null;
  const x402Symbol = x402Asset?.symbol ?? "USDC";
  const x402Available = useMemo(
    () => Boolean(
      x402Config?.enabled &&
      stemId &&
      listing &&
      x402Config.contractSettlementEnabled &&
      x402Asset?.address &&
      listing.paymentToken.toLowerCase() === x402Asset.address.toLowerCase() &&
      chainId === x402Config.chainId,
    ),
    [chainId, listing, stemId, x402Asset?.address, x402Config],
  );
  const x402AvailableForSelectedLicense = x402Available && selectedLicense === "personal";
  const activePaymentMethod = x402AvailableForSelectedLicense ? paymentMethod : "onchain";
  const x402WalletNote = useMemo(
    () => getX402WalletNote(x402Config?.enabled ? x402Config.chainId : null, x402Symbol),
    [x402Config, x402Symbol],
  );
  const onchainAsset = useMemo(
    () => findPaymentAssetForToken(paymentAssets, chainId, listing?.paymentToken),
    [paymentAssets, chainId, listing?.paymentToken],
  );
  const onchainSymbol = paymentAssetSymbol(onchainAsset, listing?.paymentToken);
  const onchainIsNative = isNativePaymentToken(listing?.paymentToken);
  const onchainDecimals = onchainAsset?.decimals ?? 18;
  const onchainIsStablecoin = onchainAsset?.kind === "stablecoin";
  const stablecoinMarketplaceConfigured = hasStablecoinMarketplaceAsset({
    assets: paymentAssets,
    chainId,
  });
  const isConsumedListing = isConsumedOnchainListing(listing);
  const isLegacyNativeListing = showLegacyNativeWarning(
    listing,
    stablecoinMarketplaceConfigured,
  );
  const onchainAssetLabel = onchainAsset
    ? `${onchainAsset.name} (${onchainSymbol})`
    : onchainIsNative
      ? `Native ${onchainSymbol}`
      : onchainSymbol;
  const onchainTokenLabel = listing?.paymentToken
    ? onchainIsNative
      ? "Native token"
      : `${listing.paymentToken.slice(0, 6)}…${listing.paymentToken.slice(-4)}`
    : "-";
  const formatOnchainAmount = (amountUnits: bigint) =>
    `${formatPaymentAmount(amountUnits, onchainDecimals)} ${onchainSymbol}`;
  const protocolFeePercent = formatBpsPercent(protocolFeeBps);
  const royaltyPercent = formatBpsPercent(stemData?.royaltyBps);
  const x402DownloadUrl = useMemo(
    () => (x402Result ? URL.createObjectURL(x402Result.audio) : null),
    [x402Result],
  );
  useEffect(() => {
    if (!x402DownloadUrl) return;
    return () => URL.revokeObjectURL(x402DownloadUrl);
  }, [x402DownloadUrl]);

  // Every checkout starts with nothing chosen (#1776).
  useEffect(() => {
    if (!isOpen) return;
    setDelivery(INITIAL_DELIVERY_CONSENT);
    setConsentError(null);
  }, [isOpen, listingId]);

  // Prefer stablecoin checkout when it is available for this stem.
  useEffect(() => {
    if (!isOpen) return;
    setPaymentMethod(defaultBuyPaymentMethod(x402Available));
    setSelectedLicense(licenseType);
  }, [isOpen, listingId, stemId, x402Available, licenseType]);

  useEffect(() => {
    if (selectedLicense !== "personal" && paymentMethod === "x402") {
      setPaymentMethod("onchain");
    }
  }, [paymentMethod, selectedLicense]);

  // Fetch x402 quote when stablecoin checkout is active.
  useEffect(() => {
    if (!isOpen || activePaymentMethod !== "x402" || !stemId || !x402AvailableForSelectedLicense) {
      setX402QuoteLoading(false);
      return;
    }
    let cancelled = false;
    setX402Quote(null);
    setX402QuoteError(null);
    setX402QuoteLoading(true);
    fetch(`${API_BASE}/api/stems/${encodeURIComponent(stemId)}/x402/info`)
      .then((res) => {
        if (!res.ok) throw new Error(`Quote request failed (${res.status}).`);
        return res.json() as Promise<unknown>;
      })
      .then((data) => {
        if (cancelled || !x402Config?.enabled || !x402Asset) return;
        setX402Quote(parseX402StemQuote(data, {
          expectedSymbol: x402Asset.symbol,
          decimals: x402Asset.decimals,
          payoutAddress: x402Config.payoutAddress,
        }));
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("x402 quote fetch error:", err);
        setX402Quote(null);
        setX402QuoteError(
          "Quote details unavailable. Refresh the quote or use direct wallet checkout.",
        );
      })
      .finally(() => {
        if (cancelled) return;
        setX402QuoteLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    isOpen,
    activePaymentMethod,
    stemId,
    x402AvailableForSelectedLicense,
    x402Asset,
    x402Config,
  ]);

  // Reset x402 transient state whenever the modal is closed/reopened
  useEffect(() => {
    if (isOpen) return;
    setX402Status(null);
    setX402Error(null);
    setX402Result(null);
    setX402Payer(null);
    setX402QuoteLoading(false);
    setX402QuoteError(null);
    setCompleted(null);
  }, [isOpen]);

  const maxAmount = listing?.amount || 1n;
  useEffect(() => {
    if (amount > maxAmount) {
      setAmount(maxAmount > 0n ? maxAmount : 1n);
    }
  }, [amount, maxAmount]);
  const licenseAvailability = useMemo(
    () => LICENSE_TYPES.reduce<Partial<Record<LicenseType, { enabled: boolean; reason?: string }>>>((acc, tier) => {
      const hasListing = Boolean(tierListings?.[tier]) || tier === licenseType;
      acc[tier] = {
        enabled: hasListing,
        reason: hasListing ? undefined : "No active marketplace listing for this license",
      };
      return acc;
    }, {}),
    [licenseType, tierListings],
  );
  const hasTierChoices = Boolean(tierListings && Object.keys(tierListings).length > 1);

  if (!isOpen) return null;

  /**
   * Record the delivery choice before the payment is initiated (#1776). Returns
   * false (and says why) when it could not be recorded; the caller must then
   * not pay.
   */
  const recordConsentBeforePaying = async (sessionToken: string | null): Promise<boolean> => {
    setConsentError(null);
    if (!stemId) return true;
    if (!sessionToken || !wording) {
      setConsentError("Sign in and load the delivery terms before you pay.");
      return false;
    }
    setRecordingConsent(true);
    try {
      await recordDeliveryChoice(sessionToken, wording, delivery, {
        surface: "stem_purchase",
        subjectId: stemId,
        licenseType: selectedLicense,
      });
      return true;
    } catch (err) {
      setConsentError(
        err instanceof Error ? err.message : "We could not record your delivery choice, so nothing was charged.",
      );
      return false;
    } finally {
      setRecordingConsent(false);
    }
  };

  const handleBuy = async () => {
    if (!selectedListingId) return;
    void recordProductAnalytics(token, "marketplace.purchase_intent", {
      source: "buy_modal",
      subjectType: "marketplace_listing",
      subjectId: selectedListingId.toString(),
      payload: {
        listingId: selectedListingId.toString(),
        stemId,
        artistId,
        licenseType: selectedLicense,
        amount: amount.toString(),
        paymentMethod: "onchain",
        chainId: listingChainId ?? chainId,
        paymentToken: listing?.paymentToken,
      },
    });
    try {
      if (listingChainMismatch) return;
      if (!(await recordConsentBeforePaying(token))) return;
      const hash = await buy(selectedListingId, amount);
      setCompleted({
        method: "onchain",
        licenseType: selectedLicense,
        txHash: hash,
        waited: delivery.choice === "wait",
      });
      onSuccess?.(hash, {
        licenseType: selectedLicense,
        amount,
        listingId: selectedListingId,
      });
    } catch {
      // Error handled by hook
    }
  };

  const handleX402Pay = async () => {
    if (!stemId || !x402Config?.enabled || selectedLicense !== "personal") return;
    if (!x402Quote || !x402Asset?.address) return;
    const transfer = getX402TransferParams(x402Quote);
    void recordProductAnalytics(token, "marketplace.purchase_intent", {
      source: "buy_modal",
      subjectType: "marketplace_listing",
      subjectId: selectedListingId?.toString(),
      payload: {
        listingId: selectedListingId?.toString(),
        stemId,
        artistId,
        licenseType: selectedLicense,
        amount: amount.toString(),
        paymentMethod: "x402",
        chainId: x402Config.chainId,
        paymentAssetSymbol: x402Asset.symbol,
        amountUsd: x402Quote.amountUsd,
      },
    });
    setX402Error(null);
    setX402Result(null);
    setX402Payer(null);
    try {
      let key = webAuthnKey;
      let session = { token, userId, addresses: [userId, authAddress, smartAccountAddress] };
      if (!key || authStatus !== "authenticated" || !token || !userId) {
        const result = await login();
        key = result?.webAuthnKey;
        session = {
          token: result?.token ?? null,
          userId: result?.userId ?? null,
          addresses: [result?.userId ?? null, result?.smartAccountAddress ?? null],
        };
      }
      if (!key || !session.token || !session.userId) {
        throw new Error("Sign in with your Resonate passkey before using x402 checkout.");
      }
      if (!(await recordConsentBeforePaying(session.token))) return;
      setX402Status("signing");
      const result = await payStemWithX402SmartAccount({
        stemId,
        token: session.token,
        buyer: { buyerId: session.userId, buyerAddresses: session.addresses },
        webAuthnKey: key,
        chainId: x402Config.chainId,
        assetAddress: x402Asset.address as `0x${string}`,
        payTo: transfer.payTo,
        amountUnits: transfer.amountUnits,
        onStatus: setX402Status,
        onPayer: setX402Payer,
      });
      setX402Result(result);
      setCompleted({ method: "x402", licenseType: selectedLicense, result });
    } catch (err) {
      setX402Error(err instanceof Error ? err.message : String(err));
    } finally {
      setX402Status(null);
    }
  };

  const view = resolveBuyModalView({
    completed,
    listingLoading,
    hasListing: Boolean(listing),
    consumed: isConsumedListing,
  });

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

        {view === "success" && completed ? (
          <PurchaseSuccessPanel
            completed={completed}
            x402DownloadUrl={x402DownloadUrl}
            trackId={trackId}
            trackTitle={trackTitle}
            stemId={stemId}
            onDone={onClose}
          />
        ) : view === "loading" ? (
          <div className="buy-modal__skeleton">
            <div className="buy-modal__skeleton-line" />
            <div className="buy-modal__skeleton-line" />
          </div>
        ) : view === "consumed" ? (
          <div className="buy-modal__body">
            <div className="buy-modal__info-card" role="status">
              <div className="buy-modal__info-icon">⌛</div>
              <div className="buy-modal__info-details">
                <div className="buy-modal__info-label">
                  This listing is no longer active
                </div>
                <div className="buy-modal__info-value">
                  It may have just sold out or been cancelled. Refresh the
                  page to see current availability.
                </div>
              </div>
            </div>
            <div className="buy-modal__actions">
              <button
                className="buy-modal__btn buy-modal__btn--cancel"
                onClick={onClose}
              >
                Close
              </button>
            </div>
          </div>
        ) : view === "listing" && listing ? (
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

            {/* Payment method (#705) — x402 is shown only when it can settle the marketplace listing */}
            {x402Available && (
              <div className="buy-modal__pay-methods" role="tablist" aria-label="Payment method">
                <button
                  type="button"
                  role="tab"
                  aria-selected={activePaymentMethod === "x402"}
                  className={`buy-modal__pay-method${activePaymentMethod === "x402" ? " buy-modal__pay-method--active" : ""}`}
                  onClick={() => setPaymentMethod("x402")}
                  disabled={pending || x402Status !== null || selectedLicense !== "personal"}
                  title={selectedLicense !== "personal" ? "x402 browser checkout currently settles the personal license tier only." : undefined}
                >
                  <span>{getCheckoutRailLabel("x402")}</span>
                  <span className="buy-modal__pay-method-sub">
                    {getCheckoutRailSubLabel({ method: "x402", symbol: x402Symbol })}
                  </span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activePaymentMethod === "onchain"}
                  className={`buy-modal__pay-method${activePaymentMethod === "onchain" ? " buy-modal__pay-method--active" : ""}`}
                  onClick={() => setPaymentMethod("onchain")}
                  disabled={pending || x402Status !== null || isLegacyNativeListing || listingChainMismatch}
                  title={
                    listingChainMismatch
                      ? `Switch your wallet to chain ${listingChainId} for direct wallet checkout.`
                      : isLegacyNativeListing
                        ? "This listing was created with native ETH and must be relisted in stablecoin for wallet checkout."
                        : undefined
                  }
                >
                  <span>{getCheckoutRailLabel("onchain")}</span>
                  <span className="buy-modal__pay-method-sub">
                    {isLegacyNativeListing
                      ? `Legacy listing · ${onchainSymbol}`
                      : listingChainMismatch
                        ? `Wrong chain · ${listingChainId}`
                      : getCheckoutRailSubLabel({
                          method: "onchain",
                          symbol: onchainSymbol,
                          isStablecoin: onchainIsStablecoin,
                        })}
                  </span>
                </button>
              </div>
            )}

            {hasTierChoices && (
              <LicenseTypeSelector
                selected={selectedLicense}
                onSelect={setSelectedLicense}
                personalPriceUsd={tierPricesUsd?.personal ?? 0.05}
                remixPriceUsd={tierPricesUsd?.remix ?? 5}
                commercialPriceUsd={tierPricesUsd?.commercial ?? 25}
                availability={licenseAvailability}
              />
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

            {/* What the stem is and what the license lets you do, in plain words (#1976) */}
            <div className="stem-source-terms" data-testid="buy-modal-source-terms">
              {stemSource && (
                <p>
                  <StemSourceBadge source={stemSource} separationModel={separationModel} />{" "}
                  {STEM_SOURCE_DESCRIPTIONS[stemSource]}
                </p>
              )}
              <p>
                <strong>{selectedLicense[0].toUpperCase() + selectedLicense.slice(1)} license:</strong>{" "}
                {LICENSE_PLAIN_TERMS[selectedLicense]}
              </p>
            </div>

            {/* License Terms Preview */}
            <LicenseTermsPreview licenseType={selectedLicense} compact />

            {/* Price Breakdown */}
            {activePaymentMethod === "onchain" && quote && !quoteLoading && (
              <div className="buy-modal__breakdown">
                <div className="buy-modal__breakdown-row">
                  <span className="buy-modal__breakdown-label">
                    Price ({amount.toString()} × {formatOnchainAmount(listing.pricePerUnit)})
                  </span>
                  <span className="buy-modal__breakdown-value">
                    {formatOnchainAmount(listing.pricePerUnit * amount)}
                  </span>
                </div>
                <div className="buy-modal__breakdown-row">
                  <span className="buy-modal__breakdown-label">
                    Creator Royalty{royaltyPercent ? ` (${royaltyPercent})` : ""}
                  </span>
                  <span className="buy-modal__breakdown-value buy-modal__breakdown-value--royalty">
                    {formatOnchainAmount(quote.royaltyAmount)}
                  </span>
                </div>
                <div className="buy-modal__breakdown-row">
                  <span className="buy-modal__breakdown-label">
                    Protocol Fee{protocolFeePercent ? ` (${protocolFeePercent})` : ""}
                  </span>
                  <span className="buy-modal__breakdown-value buy-modal__breakdown-value--fee">
                    {formatOnchainAmount(quote.protocolFee)}
                  </span>
                </div>
                <div className="buy-modal__breakdown-row">
                  <span className="buy-modal__breakdown-label">Seller receives</span>
                  <span className="buy-modal__breakdown-value">
                    {formatOnchainAmount(quote.sellerAmount)}
                  </span>
                </div>
                <div className="buy-modal__breakdown-divider" />
                <div className="buy-modal__breakdown-row buy-modal__breakdown-row--total">
                  <span className="buy-modal__breakdown-label">Total</span>
                  <span className="buy-modal__breakdown-value">
                    {formatOnchainAmount(quote.totalPrice)}
                  </span>
                </div>
                <div className="buy-modal__breakdown-row">
                  <span className="buy-modal__breakdown-label">License</span>
                  <span className="buy-modal__breakdown-value">
                    {selectedLicense}
                  </span>
                </div>
                <div className="buy-modal__breakdown-row">
                  <span className="buy-modal__breakdown-label">Settlement asset</span>
                  <span className="buy-modal__breakdown-value">
                    {onchainAssetLabel} · {onchainTokenLabel}
                  </span>
                </div>
                {!onchainIsNative && (
                  <div className="buy-modal__breakdown-note">
                    Direct on-chain checkout signs a wallet transaction that approves {onchainSymbol} and buys the listed stem in one smart-account operation.
                  </div>
                )}
                {onchainIsNative && (
                  <div className="buy-modal__breakdown-note">
                    {isLegacyNativeListing
                      ? `This listing was created with legacy native ${onchainSymbol}. Re-list it with the configured marketplace stablecoin to enable on-chain wallet checkout.`
                      : `This legacy listing uses native ${onchainSymbol}; stablecoin listings use the same wallet rail with ERC-20 approval.`}
                  </div>
                )}
              </div>
            )}

            {/* x402 Quote */}
            {activePaymentMethod === "x402" && (
              <div className="buy-modal__x402-quote" data-testid="buy-modal-x402-quote">
                <X402QuoteBreakdown quote={x402Quote} loading={x402QuoteLoading} />
                <div className="buy-modal__x402-row">
                  <span>License</span>
                  <span>{selectedLicense}</span>
                </div>
                <div className="buy-modal__x402-row">
                  <span>Stablecoin settlement</span>
                  <span>
                    {x402QuoteLoading
                      ? "Loading..."
                      : x402Quote
                        ? `${x402Quote.totalAmount} ${x402Quote.totalCurrency}`
                        : "Unavailable"}
                  </span>
                </div>
                <div className="buy-modal__x402-row">
                  <span>Asset</span>
                  <span>{x402Asset ? `${x402Asset.name} (${x402Symbol})` : x402Symbol}</span>
                </div>
                {x402Quote?.payTo && (
                  <div className="buy-modal__x402-row">
                    <span>Pay to</span>
                    <span>
                      {x402Quote.payTo.slice(0, 6)}…{x402Quote.payTo.slice(-4)}
                    </span>
                  </div>
                )}
                {x402Payer && (
                  <div className="buy-modal__x402-row">
                    <span>Paid by</span>
                    <span>{x402Payer.slice(0, 6)}…{x402Payer.slice(-4)}</span>
                  </div>
                )}
                <div className="buy-modal__breakdown-note">
                  {x402WalletNote}
                </div>
                {x402Status && (
                  <div className="buy-modal__x402-status" role="status">
                    {X402_STATUS_LABEL[x402Status]}
                  </div>
                )}
              </div>
            )}

            {/* Error */}
            {activePaymentMethod === "onchain" && error && (
              <div className="buy-modal__alert buy-modal__alert--error">
                {error.message}
              </div>
            )}
            {selectedLicense !== "personal" && x402Available && (
              <div className="buy-modal__alert">
                x402 checkout is available for the personal license tier. This {selectedLicense} purchase uses the direct on-chain listing rail.
              </div>
            )}
            {activePaymentMethod === "onchain" && isLegacyNativeListing && (
              <div className="buy-modal__alert buy-modal__alert--error">
                This listing is denominated in native {onchainSymbol}. Current on-chain marketplace checkout is stablecoin-native, so this item must be re-listed in the configured stablecoin before wallet purchase.
              </div>
            )}
            {activePaymentMethod === "onchain" && listingChainMismatch && (
              <div className="buy-modal__alert buy-modal__alert--error">
                This listing is indexed on chain {listingChainId}. Switch your wallet to that chain before using direct wallet checkout.
              </div>
            )}
            {activePaymentMethod === "x402" && x402Error && (
              <div className="buy-modal__alert buy-modal__alert--error">
                {x402Error}
              </div>
            )}
            {activePaymentMethod === "x402" && x402QuoteError && (
              <div className="buy-modal__alert buy-modal__alert--error" role="alert">
                {x402QuoteError}
              </div>
            )}

            {/* Delivery and the withdrawal right (#1776): chosen before paying */}
            {needsDeliveryConsent && (
              <DeliveryConsentStep
                wording={wording}
                error={wordingError}
                state={delivery}
                onChange={setDelivery}
                disabled={pending || x402Status !== null || recordingConsent}
              />
            )}
            {consentError && (
              <div className="buy-modal__alert buy-modal__alert--error" role="alert">
                {consentError}
              </div>
            )}

            {/* Actions */}
            <div className="buy-modal__actions">
              <button className="buy-modal__btn buy-modal__btn--cancel" onClick={onClose}>
                Cancel
              </button>
              {activePaymentMethod === "onchain" ? (
                <button
                  className="buy-modal__btn buy-modal__btn--confirm"
                  onClick={handleBuy}
                  disabled={
                    pending ||
                    recordingConsent ||
                    !deliveryComplete ||
                    !deliveryReady ||
                    !quote ||
                    !selectedListingId ||
                    isLegacyNativeListing ||
                    listingChainMismatch
                  }
                >
                  {pending && <span className="buy-modal__spinner" />}
                  {pending ? "Confirming…" : "Confirm wallet purchase"}
                </button>
              ) : (
                <button
                  className="buy-modal__btn buy-modal__btn--confirm"
                  onClick={handleX402Pay}
                  disabled={x402Status !== null || recordingConsent || !deliveryComplete || !deliveryReady || x402QuoteLoading || !x402Quote}
                >
                  {x402Status !== null && <span className="buy-modal__spinner" />}
                  {x402Status !== null
                    ? X402_STATUS_LABEL[x402Status]
                    : x402QuoteLoading
                      ? "Loading quote..."
                      : x402Quote
                        ? `Pay ${x402Quote.totalAmount} ${x402Quote.totalCurrency}`
                        : `Pay with ${x402Symbol}`}
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

/**
 * The modal body once a purchase finished (#2042): the outcome, where the
 * stem lives next, and a single Done button. It renders no purchase control,
 * so the buyer cannot pay twice from the success state.
 */
export function PurchaseSuccessPanel({
  completed,
  x402DownloadUrl,
  trackId,
  trackTitle,
  stemId,
  onDone,
}: {
  completed: CompletedPurchase;
  x402DownloadUrl?: string | null;
  trackId?: string;
  trackTitle?: string;
  stemId?: string;
  onDone: () => void;
}) {
  const txExplorerUrl = completed.method === "onchain" ? getExplorerTxUrl(completed.txHash) : null;
  const x402Result = completed.method === "x402" ? completed.result : null;
  const settlementStatus = x402Result?.receipt?.settlement?.status;
  return (
    <div className="buy-modal__body">
      {completed.method === "onchain" ? (
        <div className="buy-modal__alert buy-modal__alert--success" role="status">
          Purchase successful!{" "}
          {completed.waited && (
            <span data-testid="buy-modal-held-note">
              You chose to keep your right to withdraw, so your download is held until 14 days after your purchase. We will confirm the date in your notices.{" "}
            </span>
          )}
          {txExplorerUrl && (
            <a
              href={txExplorerUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              View transaction →
            </a>
          )}
          {/* Where the purchase lives next (#2042). */}
          <PurchaseHandoff
            licenseType={completed.licenseType}
            trackId={trackId}
            trackTitle={trackTitle}
            stemId={stemId}
            inLibrary
          />
        </div>
      ) : x402Result ? (
        <div className="buy-modal__alert buy-modal__alert--success" role="status">
          Payment settled.{" "}
          {x402Result.held && (
            <span data-testid="buy-modal-held-note">
              Your download is held until {formatHoldDate(x402Result.held.availableAt)}, when your 14-day withdrawal period ends.{" "}
            </span>
          )}
          {x402DownloadUrl && !x402Result.held && (
            <a
              href={x402DownloadUrl}
              download={x402Result.filename}
            >
              Download stem →
            </a>
          )}
          {x402Result.receiptId && (
            <div className="buy-modal__x402-status">
              Receipt {x402Result.receiptId}
              {x402Result.receipt?.payment && (
                <span>
                  {" "}
                  · {x402Result.receipt.payment.canonicalAmountUsd ?? x402Result.receipt.payment.amountUsd} USD
                  {" "}
                  settled as {x402Result.receipt.payment.settlementAmount ?? x402Result.receipt.payment.amount}
                  {" "}
                  {x402Result.receipt.payment.asset?.symbol ?? x402Result.receipt.payment.currency}
                </span>
              )}
              {settlementStatus === "contract_required_missing" && (
                <span>
                  {" "}
                  · contract settlement pending
                </span>
              )}
              {settlementStatus === "contract_backed" && (
                <span>
                  {" "}
                  · contract-backed
                </span>
              )}
            </div>
          )}
          {/* Only a marketplace-settled x402 payment records a purchase,
            * so only then does the stem appear in the library (#2042). */}
          <PurchaseHandoff
            licenseType={completed.licenseType}
            inLibrary={settlementStatus === "contract_backed"}
          />
        </div>
      ) : null}

      <div className="buy-modal__actions">
        <button
          type="button"
          className="buy-modal__btn buy-modal__btn--confirm"
          onClick={onDone}
        >
          Done
        </button>
      </div>
    </div>
  );
}

export function X402QuoteBreakdown({
  quote,
  loading,
}: {
  quote: X402StemQuote | null;
  loading: boolean;
}) {
  const unavailable = !loading && !quote;
  return (
    <>
      <div className="buy-modal__x402-row">
        <span>Price (USD)</span>
        <span>{loading ? "Loading..." : formatUsdPrice(quote?.amountUsd)}</span>
      </div>
      <div className="buy-modal__x402-row">
        <span>Platform fee (included)</span>
        <span>
          {loading
            ? "Loading..."
            : quote
              ? `${quote.platformFee.amount} ${quote.platformFee.currency}`
              : "Unavailable"}
        </span>
      </div>
      <div className="buy-modal__x402-row buy-modal__x402-row--total">
        <span>Total</span>
        <span>
          {loading
            ? "Loading..."
            : quote
              ? `${quote.totalAmount} ${quote.totalCurrency}`
              : "Unavailable"}
        </span>
      </div>
      {unavailable && (
        <div className="buy-modal__x402-unavailable" role="status">
          Quote details unavailable
        </div>
      )}
    </>
  );
}
