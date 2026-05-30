"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatUnits, type Address } from "viem";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useAuth } from "../../../components/auth/AuthProvider";
import { useZeroDev } from "../../../components/auth/ZeroDevProviderClient";
import { useListStem } from "../../../hooks/useContracts";
import { usePaymentAssets } from "../../../hooks/usePaymentAssets";
import {
  findPaymentAssetForToken,
  paymentAssetSupportsSurface,
  ZERO_PAYMENT_TOKEN,
  type PaymentAsset,
} from "../../../lib/payments";
import {
  formatListingPrice,
  listingAssetDecimals,
  listingAssetSymbol,
  listingPaymentToken,
  parseListingPriceUnits,
  type MarketplaceListingAsset,
} from "../../../lib/listingPricing";
import { API_BASE, getReleaseArtworkUrl } from "../../../lib/api";
import "../marketplace.css";

type ListingLifecycleStatus =
  | "all"
  | "active"
  | "expiring_soon"
  | "expired"
  | "sold"
  | "cancelled"
  | "stale";

type OwnerListing = {
  id: string;
  listingId: string;
  tokenId: string;
  chainId: number;
  seller: string;
  price: string;
  paymentToken: string;
  licenseType: string;
  amount: string;
  status: string;
  lifecycleStatus: Exclude<ListingLifecycleStatus, "all">;
  expiresAt: string;
  listedAt?: string;
  durationDays?: number;
  relistable?: boolean;
  stem: {
    id: string;
    title: string;
    type: string;
    track?: string;
    artist?: string;
    artworkUrl?: string;
    releaseId?: string;
  } | null;
};

const FILTERS: Array<{ value: ListingLifecycleStatus; label: string }> = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "expiring_soon", label: "Expiring" },
  { value: "expired", label: "Expired" },
  { value: "sold", label: "Sold" },
  { value: "cancelled", label: "Cancelled" },
];

function statusLabel(status: OwnerListing["lifecycleStatus"]) {
  return status.replace("_", " ");
}

function resolveArtworkUrl(path?: string | null): string | undefined {
  if (!path) return undefined;
  if (path.startsWith("http")) return path;
  if (path.startsWith("/default-stem-cover")) return path;
  return `${API_BASE}${path}`;
}

function formatShortDate(value?: string | null) {
  if (!value) return "No date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No date";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function shortAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function resolveListingAsset(
  assets: PaymentAsset[],
  chainId: number | undefined,
  token?: string | null,
): MarketplaceListingAsset {
  if (!token || token.toLowerCase() === ZERO_PAYMENT_TOKEN) return null;
  return findPaymentAssetForToken(assets, chainId, token);
}

function priceInputFromListing(listing: OwnerListing, asset: MarketplaceListingAsset) {
  return formatUnits(BigInt(listing.price), listingAssetDecimals(asset));
}

function ListingManagerArtwork({
  src,
  title,
  type,
}: {
  src?: string;
  title: string;
  type?: string | null;
}) {
  const [failed, setFailed] = useState(false);

  if (src && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={src} alt={title} onError={() => setFailed(true)} />
    );
  }

  return (
    <div className="marketplace-manager-row__art-fallback" aria-hidden="true">
      <span>{type?.slice(0, 1).toUpperCase() ?? "S"}</span>
      <small>{type || "Stem"}</small>
    </div>
  );
}

export default function MarketplaceListingManagerPage() {
  const searchParams = useSearchParams();
  const initialStatus = (searchParams.get("status") as ListingLifecycleStatus | null) ?? "all";
  const highlightedListingId = searchParams.get("listing");
  const { address, smartAccountAddress, token } = useAuth();
  const { chainId } = useZeroDev();
  const { list, pending, error } = useListStem();
  const {
    assets: paymentAssets,
    loading: paymentAssetsLoading,
  } = usePaymentAssets(chainId);

  const sellerAddress = (smartAccountAddress || address || "").toLowerCase();
  const [status, setStatus] = useState<ListingLifecycleStatus>(
    FILTERS.some((filter) => filter.value === initialStatus) ? initialStatus : "all",
  );
  const [listings, setListings] = useState<OwnerListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [relisting, setRelisting] = useState<OwnerListing | null>(null);
  const [price, setPrice] = useState("");
  const [amount, setAmount] = useState("1");
  const [duration, setDuration] = useState("7");
  const [paymentToken, setPaymentToken] = useState<string>(ZERO_PAYMENT_TOKEN);
  const [success, setSuccess] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const marketplaceAssets = useMemo(
    () => paymentAssets.filter((asset) => {
      if (chainId && asset.chainId !== chainId) return false;
      return paymentAssetSupportsSurface(asset, "marketplace");
    }),
    [chainId, paymentAssets],
  );

  const selectedAsset = useMemo(
    () => resolveListingAsset(paymentAssets, chainId, paymentToken),
    [chainId, paymentAssets, paymentToken],
  );

  const visibleListings = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return listings;

    return listings.filter((listing) => {
      const haystack = [
        listing.listingId,
        listing.tokenId,
        listing.licenseType,
        listing.lifecycleStatus,
        listing.stem?.title,
        listing.stem?.track,
        listing.stem?.artist,
        listing.stem?.type,
      ].filter(Boolean).join(" ").toLowerCase();

      return haystack.includes(normalized);
    });
  }, [listings, query]);

  const managerStats = useMemo(() => {
    const relistable = listings.filter((listing) => listing.relistable).length;
    const expiring = listings.filter((listing) => listing.lifecycleStatus === "expiring_soon").length;
    const active = listings.filter((listing) => listing.lifecycleStatus === "active").length;

    return { active, expiring, relistable, total: listings.length };
  }, [listings]);

  const fetchListings = useCallback(async () => {
    if (!sellerAddress) return;
    setLoading(true);
    setLoadError(null);
    try {
      const params = new URLSearchParams({
        lifecycle: status,
        sortBy: status === "all" ? "status" : "expiry_asc",
        limit: "100",
      });
      if (chainId) params.set("chainId", String(chainId));
      const res = await fetch(`/api/metadata/listings/owner/${sellerAddress}?${params.toString()}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(`Failed to load listings (${res.status})`);
      const data = await res.json();
      setListings(data.listings || []);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load listings");
      setListings([]);
    } finally {
      setLoading(false);
    }
  }, [chainId, sellerAddress, status, token]);

  useEffect(() => {
    void fetchListings();
  }, [fetchListings]);

  const openRelist = (listing: OwnerListing) => {
    const asset = resolveListingAsset(paymentAssets, chainId, listing.paymentToken);
    setRelisting(listing);
    setPrice(priceInputFromListing(listing, asset));
    setAmount(listing.amount || "1");
    setDuration(String(listing.durationDays || 7));
    setPaymentToken(listing.paymentToken || ZERO_PAYMENT_TOKEN);
    setSuccess(null);
  };

  const submitRelist = async () => {
    if (!relisting) return;
    const priceUnits = parseListingPriceUnits({ price, asset: selectedAsset });
    const txHash = await list({
      tokenId: BigInt(relisting.tokenId),
      amount: BigInt(amount),
      pricePerUnit: priceUnits,
      paymentToken: listingPaymentToken(selectedAsset) as Address,
      durationSeconds: BigInt(parseInt(duration) * 24 * 60 * 60),
    });

    await fetch("/api/contracts/notify-listing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tokenId: relisting.tokenId,
        seller: sellerAddress,
        price: priceUnits.toString(),
        amount,
        paymentToken: listingPaymentToken(selectedAsset),
        licenseType: relisting.licenseType,
        durationSeconds: String(parseInt(duration) * 24 * 60 * 60),
        transactionHash: txHash,
        stemId: relisting.stem?.id,
      }),
    }).catch(() => undefined);

    setSuccess("Listing transaction submitted. The indexer will attach the new listing shortly.");
    setRelisting(null);
    await fetchListings();
  };

  if (!sellerAddress) {
    return (
      <main className="marketplace-page marketplace-manager">
        <section className="marketplace-hero marketplace-manager-hero">
          <div className="marketplace-manager-hero__copy">
            <span className="marketplace-manager-kicker">Seller workspace</span>
            <h1 className="marketplace-title">Listing Manager</h1>
            <p className="marketplace-subtitle">Connect a wallet to manage your marketplace listings.</p>
          </div>
          <div className="marketplace-manager-hero__actions">
            <Link href="/marketplace" className="marketplace-secondary-link">
              Browse marketplace
            </Link>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="marketplace-page marketplace-manager">
      <section className="marketplace-hero marketplace-manager-hero">
        <div className="marketplace-manager-hero__copy">
          <span className="marketplace-manager-kicker">Seller workspace</span>
          <h1 className="marketplace-title">Listing Manager</h1>
          <p className="marketplace-subtitle">
            Track active, expiring, expired, sold, and cancelled stem listings from one owner view.
          </p>
          <div className="marketplace-manager-owner">
            <span>Managing</span>
            <strong>{shortAddress(sellerAddress)}</strong>
            {chainId && <span>Chain {chainId}</span>}
          </div>
        </div>
        <div className="marketplace-manager-hero__actions">
          <Link href="/marketplace" className="marketplace-secondary-link">
            Browse marketplace
          </Link>
          <Link href="/artist/upload" className="marketplace-action-btn marketplace-action-btn--link">
            Upload & mint
          </Link>
        </div>
      </section>

      <section className="marketplace-manager-summary" aria-label="Listing summary">
        <div>
          <span>Total listings</span>
          <strong>{managerStats.total}</strong>
        </div>
        <div>
          <span>Active</span>
          <strong>{managerStats.active}</strong>
        </div>
        <div>
          <span>Expiring</span>
          <strong>{managerStats.expiring}</strong>
        </div>
        <div>
          <span>Ready to relist</span>
          <strong>{managerStats.relistable}</strong>
        </div>
      </section>

      <section className="marketplace-manager-controls" aria-label="Listing filters">
        <div className="marketplace-manager-search">
          <span aria-hidden="true">Search</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Track, stem, token, status..."
          />
        </div>
        <div className="marketplace-manager-toolbar">
          <div className="marketplace-toolbar__group" role="tablist" aria-label="Listing status">
            {FILTERS.map((filter) => (
              <button
                key={filter.value}
                type="button"
                onClick={() => setStatus(filter.value)}
                className={`stem-pill ${status === filter.value ? "stem-pill--active" : ""}`}
              >
                {filter.label}
              </button>
            ))}
          </div>
          <button type="button" onClick={() => void fetchListings()} className="marketplace-clear-btn">
            Refresh
          </button>
        </div>
      </section>

      {success && <div className="marketplace-manager-alert marketplace-manager-alert--success">{success}</div>}
      {loadError && <div className="marketplace-manager-alert marketplace-manager-alert--error">{loadError}</div>}

      {loading ? (
        <div className="marketplace-empty">Loading listings...</div>
      ) : listings.length === 0 ? (
        <div className="marketplace-empty marketplace-manager-empty">
          <div className="marketplace-empty__icon">♪</div>
          <h3 className="marketplace-empty__title">No listings in this state</h3>
          <p className="marketplace-empty__text">Switch filters, browse the public marketplace, or mint a new stem listing.</p>
          <div className="marketplace-manager-empty__actions">
            <Link href="/marketplace" className="marketplace-secondary-link">
              Browse marketplace
            </Link>
            <Link href="/artist/upload" className="marketplace-action-btn marketplace-action-btn--link">
              Upload & mint
            </Link>
          </div>
        </div>
      ) : visibleListings.length === 0 ? (
        <div className="marketplace-empty marketplace-manager-empty">
          <div className="marketplace-empty__icon">⌕</div>
          <h3 className="marketplace-empty__title">No matching listings</h3>
          <p className="marketplace-empty__text">Try another track, stem type, token ID, or status.</p>
        </div>
      ) : (
        <div className="marketplace-manager-list">
          {visibleListings.map((listing) => {
            const asset = resolveListingAsset(paymentAssets, chainId, listing.paymentToken);
            const symbol = listingAssetSymbol(asset);
            const isHighlighted = highlightedListingId === listing.id;
            const artworkUrl = resolveArtworkUrl(listing.stem?.artworkUrl)
              ?? (listing.stem?.releaseId ? getReleaseArtworkUrl(listing.stem.releaseId) : undefined);
            return (
              <article
                key={listing.id}
                className={`marketplace-manager-row ${isHighlighted ? "marketplace-manager-row--highlighted" : ""}`}
              >
                <div className="marketplace-manager-row__art">
                  <ListingManagerArtwork
                    src={artworkUrl}
                    title={listing.stem?.title ?? `Token #${listing.tokenId}`}
                    type={listing.stem?.type}
                  />
                </div>
                <div className="marketplace-manager-row__main">
                  <div className="marketplace-manager-row__eyebrow">
                    <span>{listing.stem?.type ?? "Stem"}</span>
                    <span>{listing.licenseType}</span>
                    <span>Token #{listing.tokenId}</span>
                  </div>
                  <div className="marketplace-manager-row__title">
                    {listing.stem?.title ?? `Token #${listing.tokenId}`}
                  </div>
                  <div className="marketplace-manager-row__meta">
                    {listing.stem?.track ?? "Unknown track"}
                    {listing.stem?.artist ? ` by ${listing.stem.artist}` : ""}
                  </div>
                  <div className="marketplace-manager-row__facts">
                    <span>{formatListingPrice({ priceUnits: BigInt(listing.price), asset })}</span>
                    <span>{listing.amount} available</span>
                    <span>Expires {formatShortDate(listing.expiresAt)}</span>
                    <span>{symbol}</span>
                  </div>
                </div>
                <div className="marketplace-manager-row__actions">
                  <span className={`listing-status-pill listing-status-pill--${listing.lifecycleStatus}`}>
                    {statusLabel(listing.lifecycleStatus)}
                  </span>
                  {listing.relistable && (
                    <button type="button" className="marketplace-action-btn" onClick={() => openRelist(listing)}>
                      Relist
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {relisting && (
        <div className="marketplace-manager-modal" role="dialog" aria-modal="true">
          <div className="marketplace-manager-modal__panel">
            <button
              type="button"
              className="marketplace-manager-modal__close"
              onClick={() => setRelisting(null)}
              aria-label="Close"
            >
              ×
            </button>
            <h2>Relist {relisting.stem?.title ?? `Token #${relisting.tokenId}`}</h2>
            <label>
              Price
              <input value={price} type="number" min="0" step="0.000001" onChange={(event) => setPrice(event.target.value)} />
            </label>
            <label>
              Payment asset
              <select value={paymentToken} onChange={(event) => setPaymentToken(event.target.value)}>
                <option value={ZERO_PAYMENT_TOKEN}>Native ETH</option>
                {marketplaceAssets.map((asset) => (
                  <option key={asset.assetId} value={asset.tokenAddress}>
                    {asset.name} ({asset.symbol})
                  </option>
                ))}
              </select>
            </label>
            <label>
              Quantity
              <input value={amount} type="number" min="1" onChange={(event) => setAmount(event.target.value)} />
            </label>
            <label>
              Duration
              <select value={duration} onChange={(event) => setDuration(event.target.value)}>
                <option value="1">1 day</option>
                <option value="3">3 days</option>
                <option value="7">7 days</option>
                <option value="14">14 days</option>
                <option value="30">30 days</option>
                <option value="90">90 days</option>
              </select>
            </label>
            <div className="marketplace-manager-modal__summary">
              {price && amount
                ? `${formatListingPrice({
                  priceUnits: parseListingPriceUnits({ price, asset: selectedAsset }) * BigInt(amount || "1"),
                  asset: selectedAsset,
                })} total`
                : "Enter a price and quantity"}
            </div>
            {error && <div className="marketplace-manager-alert marketplace-manager-alert--error">{error.message}</div>}
            <div className="marketplace-manager-modal__actions">
              <button type="button" className="marketplace-clear-btn" onClick={() => setRelisting(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="marketplace-action-btn"
                onClick={() => void submitRelist()}
                disabled={pending || paymentAssetsLoading || !price || !amount}
              >
                {pending ? "Submitting..." : "Create new listing"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
