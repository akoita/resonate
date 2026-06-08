"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { recordProductAnalytics } from "../../../lib/productAnalytics";
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
    artistId?: string;
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
  const [relistingListings, setRelistingListings] = useState<OwnerListing[]>([]);
  const [selectedListingIds, setSelectedListingIds] = useState<Set<string>>(() => new Set());
  const [price, setPrice] = useState("");
  const [amount, setAmount] = useState("1");
  const [duration, setDuration] = useState("7");
  const [paymentToken, setPaymentToken] = useState<string>(ZERO_PAYMENT_TOKEN);
  const [success, setSuccess] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number; title: string } | null>(null);
  const lastInventoryAnalyticsKeyRef = useRef<string | null>(null);

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

  const visibleRelistableListings = useMemo(
    () => visibleListings.filter((listing) => listing.relistable),
    [visibleListings],
  );

  const selectedRelistableListings = useMemo(
    () => listings.filter((listing) => listing.relistable && selectedListingIds.has(listing.id)),
    [listings, selectedListingIds],
  );

  const allVisibleRelistableSelected = visibleRelistableListings.length > 0
    && visibleRelistableListings.every((listing) => selectedListingIds.has(listing.id));

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
      setSelectedListingIds((current) => {
        const nextListings = (data.listings || []) as OwnerListing[];
        const validIds = new Set(nextListings.filter((listing) => listing.relistable).map((listing) => listing.id));
        return new Set([...current].filter((id) => validIds.has(id)));
      });
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load listings");
      setListings([]);
      setSelectedListingIds(new Set());
    } finally {
      setLoading(false);
    }
  }, [chainId, sellerAddress, status, token]);

  useEffect(() => {
    void fetchListings();
  }, [fetchListings]);

  useEffect(() => {
    if (loading || !token || listings.length === 0) return;

    const byArtist = new Map<string, {
      activeCount: number;
      expiredCount: number;
      expiringSoonCount: number;
      relistableCount: number;
      totalListings: number;
    }>();

    for (const listing of listings) {
      const artistId = listing.stem?.artistId;
      if (!artistId) continue;
      const summary = byArtist.get(artistId) ?? {
        activeCount: 0,
        expiredCount: 0,
        expiringSoonCount: 0,
        relistableCount: 0,
        totalListings: 0,
      };
      summary.totalListings += 1;
      if (listing.lifecycleStatus === "active") summary.activeCount += 1;
      if (listing.lifecycleStatus === "expired") summary.expiredCount += 1;
      if (listing.lifecycleStatus === "expiring_soon") summary.expiringSoonCount += 1;
      if (listing.relistable) summary.relistableCount += 1;
      byArtist.set(artistId, summary);
    }

    const analyticsKey = JSON.stringify({
      status,
      sellerAddress,
      artists: [...byArtist.entries()].sort(([left], [right]) => left.localeCompare(right)),
    });
    if (lastInventoryAnalyticsKeyRef.current === analyticsKey) return;
    lastInventoryAnalyticsKeyRef.current = analyticsKey;

    for (const [artistId, summary] of byArtist) {
      void recordProductAnalytics(token, "marketplace.owner_inventory_viewed", {
        source: "marketplace_manager",
        subjectType: "artist",
        subjectId: artistId,
        payload: {
          artistId,
          statusFilter: status,
          activeCount: summary.activeCount,
          expiredCount: summary.expiredCount,
          expiringSoonCount: summary.expiringSoonCount,
          relistableCount: summary.relistableCount,
          totalListings: summary.totalListings,
        },
      });
    }
  }, [listings, loading, sellerAddress, status, token]);

  const openRelist = (nextListings: OwnerListing[]) => {
    const [firstListing] = nextListings;
    if (!firstListing) return;
    const asset = resolveListingAsset(paymentAssets, chainId, firstListing.paymentToken);
    setRelistingListings(nextListings);
    setPrice(priceInputFromListing(firstListing, asset));
    setAmount(firstListing.amount || "1");
    setDuration(String(firstListing.durationDays || 7));
    setPaymentToken(firstListing.paymentToken || ZERO_PAYMENT_TOKEN);
    setSuccess(null);
    setBatchProgress(null);
  };

  const submitRelist = async () => {
    if (relistingListings.length === 0) return;
    const priceUnits = parseListingPriceUnits({ price, asset: selectedAsset });
    const durationSeconds = String(parseInt(duration) * 24 * 60 * 60);

    try {
      for (let index = 0; index < relistingListings.length; index += 1) {
        const listing = relistingListings[index];
        setBatchProgress({
          current: index + 1,
          total: relistingListings.length,
          title: listing.stem?.title ?? `Token #${listing.tokenId}`,
        });

        const txHash = await list({
          tokenId: BigInt(listing.tokenId),
          amount: BigInt(amount),
          pricePerUnit: priceUnits,
          paymentToken: listingPaymentToken(selectedAsset) as Address,
          durationSeconds: BigInt(durationSeconds),
        });

        await fetch("/api/contracts/notify-listing", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tokenId: listing.tokenId,
            seller: sellerAddress,
            price: priceUnits.toString(),
            amount,
            paymentToken: listingPaymentToken(selectedAsset),
            licenseType: listing.licenseType,
            durationSeconds,
            transactionHash: txHash,
            stemId: listing.stem?.id,
          }),
        }).catch(() => undefined);
      }

      setSuccess(
        relistingListings.length === 1
          ? "Listing transaction submitted. The indexer will attach the new listing shortly."
          : `${relistingListings.length} listing transactions submitted. The indexer will attach the new listings shortly.`,
      );
      setRelistingListings([]);
      setSelectedListingIds(new Set());
      await fetchListings();
    } finally {
      setBatchProgress(null);
    }
  };

  const toggleListingSelection = (listing: OwnerListing) => {
    if (!listing.relistable) return;
    setSelectedListingIds((current) => {
      const next = new Set(current);
      if (next.has(listing.id)) next.delete(listing.id);
      else next.add(listing.id);
      return next;
    });
  };

  const toggleAllVisibleRelistable = () => {
    setSelectedListingIds((current) => {
      const next = new Set(current);
      if (allVisibleRelistableSelected) {
        visibleRelistableListings.forEach((listing) => next.delete(listing.id));
      } else {
        visibleRelistableListings.forEach((listing) => next.add(listing.id));
      }
      return next;
    });
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
        {visibleRelistableListings.length > 0 && (
          <div className="marketplace-manager-bulkbar" aria-label="Batch listing actions">
            <label className="marketplace-manager-select-all">
              <input
                type="checkbox"
                checked={allVisibleRelistableSelected}
                onChange={toggleAllVisibleRelistable}
              />
              <span>Select relistable stems in this view</span>
            </label>
            <div className="marketplace-manager-bulkbar__actions">
              <span>{selectedRelistableListings.length} selected</span>
              {selectedRelistableListings.length > 0 && (
                <button
                  type="button"
                  className="marketplace-clear-btn"
                  onClick={() => setSelectedListingIds(new Set())}
                >
                  Clear
                </button>
              )}
              <button
                type="button"
                className="marketplace-action-btn"
                onClick={() => openRelist(selectedRelistableListings)}
                disabled={selectedRelistableListings.length === 0}
              >
                Relist selected
              </button>
            </div>
          </div>
        )}
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
                className={`marketplace-manager-row marketplace-manager-row--status-${listing.lifecycleStatus} ${isHighlighted ? "marketplace-manager-row--highlighted" : ""} ${
                  selectedListingIds.has(listing.id) ? "marketplace-manager-row--selected" : ""
                }`}
              >
                <label className="marketplace-manager-row__select" title={listing.relistable ? "Select for batch relist" : "This listing is not relistable"}>
                  <input
                    type="checkbox"
                    checked={selectedListingIds.has(listing.id)}
                    disabled={!listing.relistable}
                    onChange={() => toggleListingSelection(listing)}
                    aria-label={`Select ${listing.stem?.title ?? `Token #${listing.tokenId}`} for batch relist`}
                  />
                </label>
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
                    <button type="button" className="marketplace-action-btn" onClick={() => openRelist([listing])}>
                      Relist
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {relistingListings.length > 0 && (
        <div className="marketplace-manager-modal" role="dialog" aria-modal="true">
          <div className="marketplace-manager-modal__panel">
            <button
              type="button"
              className="marketplace-manager-modal__close"
              onClick={() => setRelistingListings([])}
              aria-label="Close"
              disabled={Boolean(batchProgress)}
            >
              ×
            </button>
            <h2>
              {relistingListings.length === 1
                ? `Relist ${relistingListings[0].stem?.title ?? `Token #${relistingListings[0].tokenId}`}`
                : `Relist ${relistingListings.length} selected stems`}
            </h2>
            {relistingListings.length > 1 && (
              <div className="marketplace-manager-modal__selection">
                <p>Apply the same terms to every selected stem. Each listing still submits as its own transaction.</p>
                <div>
                  {relistingListings.slice(0, 6).map((listing) => (
                    <span key={listing.id}>{listing.stem?.title ?? `Token #${listing.tokenId}`}</span>
                  ))}
                  {relistingListings.length > 6 && <span>+{relistingListings.length - 6} more</span>}
                </div>
              </div>
            )}
            <label>
              Price
              <input
                value={price}
                type="number"
                min="0"
                step="0.000001"
                onChange={(event) => setPrice(event.target.value)}
                disabled={Boolean(batchProgress)}
              />
            </label>
            <label>
              Payment asset
              <select
                value={paymentToken}
                onChange={(event) => setPaymentToken(event.target.value)}
                disabled={Boolean(batchProgress)}
              >
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
              <input
                value={amount}
                type="number"
                min="1"
                onChange={(event) => setAmount(event.target.value)}
                disabled={Boolean(batchProgress)}
              />
            </label>
            <label>
              Duration
              <select
                value={duration}
                onChange={(event) => setDuration(event.target.value)}
                disabled={Boolean(batchProgress)}
              >
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
            {batchProgress && (
              <div className="marketplace-manager-modal__progress">
                Submitting {batchProgress.current} / {batchProgress.total}: {batchProgress.title}
              </div>
            )}
            <div className="marketplace-manager-modal__actions">
              <button
                type="button"
                className="marketplace-clear-btn"
                onClick={() => setRelistingListings([])}
                disabled={pending || Boolean(batchProgress)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="marketplace-action-btn"
                onClick={() => void submitRelist()}
                disabled={pending || paymentAssetsLoading || !price || !amount}
              >
                {pending || batchProgress
                  ? "Submitting..."
                  : relistingListings.length === 1
                    ? "Create new listing"
                    : `Relist ${relistingListings.length} stems`}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
