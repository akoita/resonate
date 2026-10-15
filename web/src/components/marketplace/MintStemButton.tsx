import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../auth/AuthProvider";
import { useZeroDev } from "../auth/ZeroDevProviderClient";
import type { Address } from "viem";
import {
    useListStemTiers,
    useMintAndListStem,
    useStemBalance,
} from "../../hooks/useContracts";
import { usePaymentAssets } from "../../hooks/usePaymentAssets";
import { useStemTierPricing } from "../../hooks/useStemTierPricing";
import { getBalance, getStemData } from "../../lib/contracts";
import {
    buildTierNotifyPayload,
    describeTierPlan,
    orderTiers,
    planTierListings,
    resolveListingPriceCapUnits,
    type PlannedTierListing,
    type TierListingInput,
} from "../../lib/multiTierListing";
import { TierPickerDialog, type TierDialogPlanCheck } from "./TierPickerDialog";
import { NOTIFY_LISTING_DELAYED_MESSAGE, postNotifyListing } from "../../lib/listingTiers";
import {
    getListingsByStem,
    getStemNftInfo,
    type ReleaseContentProtectionData,
    type TrustTier,
} from "../../lib/api";
import {
    clearStemMarketplaceStatus,
    persistStemMarketplaceStatus,
    STEM_MARKETPLACE_STATUS_EVENT,
    type StemMarketplaceStatus,
    type StemMarketplaceStatusEventDetail,
} from "../../lib/stemMarketplaceStatus";
import { useToast } from "../ui/Toast";
import {
    formatListingPrice,
    listingPaymentToken,
    selectDefaultMarketplaceListingAsset,
} from "../../lib/listingPricing";
import { resolveStakeSafeListingPriceUnits } from "../../lib/stakeSafeListingPrice";

// Poll backend until the minted token ID is indexed (max ~30s)
async function pollForMintedTokenId(
    stemId: string,
    maxAttempts = 15,
    intervalMs = 2000
): Promise<bigint> {
    for (let i = 0; i < maxAttempts; i++) {
        try {
            const nftInfo = await getStemNftInfo(stemId);
            if (nftInfo?.tokenId != null) {
                return BigInt(nftInfo.tokenId);
            }
        } catch {
            // Indexer may not have processed yet, keep trying
        }
        if (i < maxAttempts - 1) {
            await new Promise((r) => setTimeout(r, intervalMs));
        }
    }
    throw new Error("Timed out waiting for mint confirmation from backend");
}

// Poll backend until the listing is indexed (max ~30s)
async function pollForListing(
    stemId: string,
    maxAttempts = 15,
    intervalMs = 2000
): Promise<boolean> {
    for (let i = 0; i < maxAttempts; i++) {
        try {
            const listings = await getListingsByStem(stemId);
            if (listings && listings.length > 0) {
                return true;
            }
        } catch {
            // Keep trying
        }
        if (i < maxAttempts - 1) {
            await new Promise((r) => setTimeout(r, intervalMs));
        }
    }
    return false;
}

interface MintStemButtonProps {
    stemId: string;
    stemType: string;
    listingPricePerUnit: bigint;
    /** License tier recorded on the listing intent; defaults to personal. */
    licenseType?: "personal" | "remix" | "commercial";
    releaseProtection?: Pick<ReleaseContentProtectionData, "active" | "stakeAmount" | "staked"> | null;
    trustTier?: Pick<TrustTier, "maxListingPriceWei" | "maxListingPriceUncapped" | "maxPriceMultiplier"> | null;
    onBeforeMint?: () => Promise<boolean | { ready: boolean; protectionId?: bigint }>;
    disabled?: boolean;
    disabledReason?: string;
    disabledLabel?: string;
}

// Keep a successful wallet transaction visible while the backend indexer catches up.
// "Listed" is reserved for listings confirmed by the marketplace API.
const LISTING_PENDING_TTL_MS = 60 * 60 * 1000;
const LISTING_DURATION_SECONDS = 7 * 24 * 60 * 60;
type MintStemButtonState = "idle" | "confirming_mint" | "minted" | "confirming_list" | "listing_pending" | "listed";

export function MintStemButton({
    stemId,
    stemType,
    listingPricePerUnit,
    licenseType = "personal",
    releaseProtection,
    trustTier,
    onBeforeMint,
    disabled = false,
    disabledReason,
    disabledLabel,
}: MintStemButtonProps) {
    const { address, status, smartAccountAddress, token } = useAuth();
    const { chainId, publicClient } = useZeroDev();
    const {
        assets: paymentAssets,
        defaultAsset,
        loading: paymentAssetsLoading,
    } = usePaymentAssets(chainId);
    const { listTiers, pending: listPending } = useListStemTiers();
    const { mintAndList, pending: mintAndListPending } = useMintAndListStem();
    const { addToast } = useToast();
    const listingAsset = selectDefaultMarketplaceListingAsset({
        assets: paymentAssets,
        chainId,
        defaultAssetId: defaultAsset,
    });
    const listingPriceUnits = resolveStakeSafeListingPriceUnits({
        asset: listingAsset,
        releaseProtection,
        trustTier,
    }, listingPricePerUnit);
    const listingToken = listingPaymentToken(listingAsset);
    const listingPriceLabel = formatListingPrice({
        priceUnits: listingPriceUnits,
        asset: listingAsset,
    });
    const listingPriceUnavailable = !paymentAssetsLoading && listingPriceUnits <= 0n;
    // Per-edition price limit for this release (stake or trust-tier cap);
    // every tier price must stay within it.
    const maxPriceUnits = resolveListingPriceCapUnits({
        asset: listingAsset,
        releaseProtection,
        trustTier,
    });
    // Tier picker (#2041): "mint" for Mint & List, "list" for an already
    // minted stem. Price defaults come from the stem's catalog pricing.
    const [tierDialog, setTierDialog] = useState<"mint" | "list" | null>(null);
    const tierPricing = useStemTierPricing(tierDialog ? stemId : null);
    // State machine: "idle" -> "minted" -> "listing_pending" -> "listed"
    // "confirming_mint" and "confirming_list" are transient states while polling the backend
    const [state, setState] = useState<MintStemButtonState>("idle");
    const [mintedTokenId, setMintedTokenId] = useState<bigint | null>(null);
    const { balance: mintedBalance } = useStemBalance(
        tierDialog === "list" && mintedTokenId != null ? mintedTokenId : undefined,
    );
    const notifyListing = useCallback(async (input: {
        tokenId: bigint;
        transactionHash: string;
        tiers: PlannedTierListing[];
        listingIds?: bigint[];
    }) => {
        const result = await postNotifyListing(
            buildTierNotifyPayload({
                tokenId: input.tokenId,
                chainId,
                seller: smartAccountAddress || address || "",
                paymentToken: listingToken,
                durationSeconds: BigInt(LISTING_DURATION_SECONDS),
                transactionHash: input.transactionHash,
                stemId,
                tiers: input.tiers,
                listingIds: input.listingIds,
            }),
            token,
        );
        if (!result.ok) {
            // Non-blocking: the listing exists on-chain and the indexer
            // still records it; only the tier label may lag.
            addToast({ type: "warning", title: "Listing created", message: NOTIFY_LISTING_DELAYED_MESSAGE });
        }
    }, [addToast, address, chainId, listingToken, smartAccountAddress, stemId, token]);
    const applyStatusDetail = useCallback((detail: StemMarketplaceStatusEventDetail) => {
        if (detail.stemId !== stemId) return;

        if (detail.tokenId) {
            setMintedTokenId(BigInt(detail.tokenId));
        } else if (detail.status === "idle") {
            setMintedTokenId(null);
        }

        if (detail.status === "idle") {
            setState("idle");
            return;
        }

        setState(detail.status);
    }, [stemId]);

    const checkStatus = useCallback(async () => {
        try {
            const localData = localStorage.getItem(`stem_status_${stemId}`);
            let localStatus: StemMarketplaceStatus | null = null;
            let localTimestamp: number | null = null;

            // Parse localStorage: supports both legacy string ("listed") and new JSON format
            if (localData) {
                try {
                    const parsed = JSON.parse(localData);
                    localStatus = parsed.status;
                    localTimestamp = parsed.timestamp;
                } catch {
                    // Legacy format: plain string "listed" or "minted"
                    if (localData === "listed" || localData === "minted") {
                        localStatus = localData;
                    }
                }
            }

            const localId = localStorage.getItem(`stem_token_id_${stemId}`);
            const localTokenId = localId ? BigInt(localId) : null;
            const localStatusAge =
                localTimestamp != null ? Date.now() - localTimestamp : Number.POSITIVE_INFINITY;
            const isRecentPending =
                localStatus === "listing_pending" && localStatusAge < LISTING_PENDING_TTL_MS;

            if (localTokenId != null) {
                setMintedTokenId(localTokenId);
                if (isRecentPending || localStatus === "listed") {
                    setState("listing_pending");
                } else if (localStatus === "minted") {
                    setState("minted");
                }
            }

            // Verify with backend API (source of truth)
            const listings = await getListingsByStem(stemId);
            if (listings && listings.length > 0) {
                persistStemMarketplaceStatus(stemId, "listed", localTokenId ?? mintedTokenId);
                setState("listed");
                return;
            }

            if (isRecentPending && localTokenId != null) {
                setState("listing_pending");
                return;
            }

            // If not listed, check if at least minted
            const nftInfo = await getStemNftInfo(stemId);
            if (nftInfo) {
                const tid = BigInt(nftInfo.tokenId);
                setMintedTokenId(tid);
                setState("minted");
                persistStemMarketplaceStatus(stemId, "minted", tid);
            } else {
                // Not minted — clear everything
                setState("idle");
                clearStemMarketplaceStatus(stemId);
            }
        } catch (err) {
            // Ignore API errors, stick with local hint if available
            console.warn("Status check failed, falling back to local state", err);
        }
    }, [mintedTokenId, stemId]);

    // Persistence check on mount and sync with batch updates in the same tab
    useEffect(() => {
        if (!stemId || typeof window === "undefined") return;

        const initialCheckId = window.setTimeout(() => {
            void checkStatus();
        }, 0);

        const handleStatusUpdate = (event: Event) => {
            const detail = (event as CustomEvent<StemMarketplaceStatusEventDetail>).detail;
            if (detail) {
                applyStatusDetail(detail);
                if (detail.status === "listing_pending") {
                    window.setTimeout(() => void checkStatus(), 5000);
                }
            }
        };

        const handleStorage = (event: StorageEvent) => {
            if (
                event.key === `stem_status_${stemId}` ||
                event.key === `stem_token_id_${stemId}` ||
                event.key === null
            ) {
                void checkStatus();
            }
        };

        window.addEventListener(STEM_MARKETPLACE_STATUS_EVENT, handleStatusUpdate as EventListener);
        window.addEventListener("storage", handleStorage);

        return () => {
            window.clearTimeout(initialCheckId);
            window.removeEventListener(STEM_MARKETPLACE_STATUS_EVENT, handleStatusUpdate as EventListener);
            window.removeEventListener("storage", handleStorage);
        };
    }, [applyStatusDetail, checkStatus, stemId]);

    const handleList = async (tiers: TierListingInput[]) => {
        const seller = (smartAccountAddress || address) as Address | undefined;
        if (!seller || !mintedTokenId) {
            addToast({
                type: "error",
                title: "Error",
                message: "No minted token to list",
            });
            return;
        }

        try {
            // Re-read balance and creator at confirm time so the plan never
            // lists more editions than the seller holds or can mint.
            const [balance, stemData] = await Promise.all([
                getBalance(publicClient, chainId, seller, mintedTokenId),
                getStemData(publicClient, chainId, mintedTokenId),
            ]);
            const plan = planTierListings({
                tiers,
                balance,
                // "minted" means the marketplace has no active listing yet.
                committedAmount: 0n,
                canMintMore: stemData.creator.toLowerCase() === seller.toLowerCase(),
            });
            if (!plan.ok) {
                addToast({ type: "error", title: "Cannot list these tiers", message: plan.message });
                return;
            }
            setTierDialog(null);
            const { hash, listingIds } = await listTiers(plan, {
                tokenId: mintedTokenId,
                paymentToken: listingToken,
                durationSeconds: BigInt(LISTING_DURATION_SECONDS),
            });

            // Tx confirmed on-chain — wait for backend indexer to confirm listing
            setState("confirming_list");
            persistStemMarketplaceStatus(stemId, "listing_pending", mintedTokenId);
            try {
                await notifyListing({
                    tokenId: mintedTokenId,
                    transactionHash: hash,
                    tiers: plan.tiers,
                    listingIds,
                });
            } catch {
                // Best-effort — indexer can still catch up from chain events.
            }

            const confirmed = await pollForListing(stemId);
            if (confirmed) {
                setState("listed");
                persistStemMarketplaceStatus(stemId, "listed", mintedTokenId);
                addToast({
                    type: "success",
                    title: "Listed for Sale!",
                    message: `${stemType} stem (Token #${mintedTokenId}) is now on the marketplace in ${plan.tiers.length} license tier${plan.tiers.length === 1 ? "" : "s"}`,
                });
            } else {
                setState("listing_pending");
                addToast({
                    type: "warning",
                    title: "Listing Indexing",
                    message: "Transaction succeeded. The listing will appear once the marketplace indexer confirms it.",
                });
            }
        } catch (error) {
            console.error("List failed:", error);
            addToast({
                type: "error",
                title: "List Failed",
                message: error instanceof Error ? error.message : "Transaction failed",
            });
        }
    };

    const openTierDialog = (mode: "mint" | "list") => {
        if (!address) {
            addToast({ type: "error", title: "Wallet Required", message: "Connect your wallet" });
            return;
        }
        if (listingPriceUnits <= 0n) {
            addToast({
                type: "error",
                title: "Listing price unavailable",
                message: "Marketplace listing price must be greater than zero.",
            });
            return;
        }
        setTierDialog(mode);
    };

    const checkTierPlan = (tiers: TierListingInput[]): TierDialogPlanCheck => {
        if (tierDialog === "list") {
            const plan = planTierListings({
                tiers,
                balance: mintedBalance,
                committedAmount: 0n,
                // Confirm re-checks the creator on-chain; the release owner
                // who minted the stem is its creator.
                canMintMore: true,
            });
            return plan.ok
                ? {
                    ok: true,
                    summary: describeTierPlan({
                        tierCount: plan.tiers.length,
                        totalAmount: plan.totalAmount,
                        mintAmount: plan.mintAmount,
                        mode: "list",
                    }),
                }
                : { ok: false, message: plan.message };
        }
        const ordered = orderTiers(tiers);
        return ordered.ok
            ? {
                ok: true,
                summary: describeTierPlan({
                    tierCount: ordered.tiers.length,
                    totalAmount: ordered.totalAmount,
                    mintAmount: ordered.totalAmount,
                    mode: "mint",
                }),
            }
            : { ok: false, message: ordered.message };
    };

    const handleMintAndList = async (tierInputs: TierListingInput[]) => {
        if (!address) {
            addToast({ type: "error", title: "Wallet Required", message: "Connect your wallet" });
            return;
        }
        const ordered = orderTiers(tierInputs);
        if (!ordered.ok) {
            addToast({ type: "error", title: "Cannot list these tiers", message: ordered.message });
            return;
        }
        setTierDialog(null);

        try {
            let releaseProtectionId: bigint | undefined;
            if (onBeforeMint) {
                const beforeMintResult = await onBeforeMint();
                const readyToMint =
                    typeof beforeMintResult === "boolean"
                        ? beforeMintResult
                        : beforeMintResult.ready;
                releaseProtectionId =
                    typeof beforeMintResult === "boolean"
                        ? undefined
                        : beforeMintResult.protectionId;
                if (!readyToMint) {
                    return;
                }
            }

            setState("confirming_mint");

            const { hash, tokenId, listingIds } = await mintAndList({
                stemId,
                amount: ordered.totalAmount,
                royaltyBps: 500,
                remixable: true,
                parentIds: [],
                protectionId: releaseProtectionId,
                pricePerUnit: ordered.tiers[0].pricePerUnit,
                paymentToken: listingToken,
                durationSeconds: BigInt(LISTING_DURATION_SECONDS),
                tiers: ordered.tiers,
            });

            const actualTokenId = tokenId ?? await pollForMintedTokenId(stemId);

            setMintedTokenId(actualTokenId);
            setState("confirming_list");
            persistStemMarketplaceStatus(stemId, "listing_pending", actualTokenId);

            // Notify backend so it can attach listing metadata while the indexer catches up.
            try {
                await notifyListing({
                    tokenId: actualTokenId,
                    transactionHash: hash,
                    tiers: ordered.tiers,
                    listingIds: tokenId != null ? listingIds : undefined,
                });
            } catch {
                // Best-effort — indexer can still catch up from chain events.
            }

            const confirmed = await pollForListing(stemId);
            if (confirmed) {
                setState("listed");
                persistStemMarketplaceStatus(stemId, "listed", actualTokenId);
                addToast({
                    type: "success",
                    title: "Minted & Listed!",
                    message: ordered.tiers.length > 1
                        ? `${stemType} stem (Token #${actualTokenId}) is now on the marketplace in ${ordered.tiers.length} license tiers`
                        : `${stemType} stem (Token #${actualTokenId}) is now on the marketplace for ${formatListingPrice({ priceUnits: ordered.tiers[0].pricePerUnit, asset: listingAsset })}`,
                });
            } else {
                setState("listing_pending");
                addToast({
                    type: "warning",
                    title: "Listing Indexing",
                    message: "Transaction succeeded. The listing will appear once the marketplace indexer confirms it.",
                });
            }
        } catch (error) {
            console.error("Mint & List failed:", error);
            setState("idle");
            // Clear stale localStorage so failed txs don't persist as "listed"
            clearStemMarketplaceStatus(stemId);
            addToast({
                type: "error",
                title: "Transaction Failed",
                message: error instanceof Error ? error.message : "Transaction failed",
            });
        }
    };

    if (status !== "authenticated") {
        return (
            <button
                disabled
                style={{
                    width: "100%",
                    padding: "8px 12px",
                    background: "rgba(63,63,70,0.5)",
                    color: "#71717a",
                    border: "none",
                    borderRadius: 10,
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: "not-allowed",
                }}
            >
                Connect Wallet
            </button>
        );
    }

    if (state === "listed") {
        return (
            <button
                disabled
                style={{
                    width: "100%",
                    padding: "8px 12px",
                    background: "rgba(16,185,129,0.12)",
                    color: "#10b981",
                    border: "1px solid rgba(16,185,129,0.3)",
                    borderRadius: 10,
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: "default",
                    transition: "all 0.2s",
                }}
            >
                ✓ Listed
            </button>
        );
    }

    if (state === "listing_pending") {
        return (
            <button
                disabled
                title="The wallet transaction succeeded. Waiting for the marketplace indexer to confirm the public listing."
                style={{
                    width: "100%",
                    padding: "8px 12px",
                    background: "rgba(139,92,246,0.12)",
                    color: "#c4b5fd",
                    border: "1px solid rgba(139,92,246,0.3)",
                    borderRadius: 10,
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: "wait",
                    transition: "all 0.2s",
                }}
            >
                Indexing listing...
            </button>
        );
    }

    if (disabled) {
        return (
            <button
                disabled
                title={disabledReason}
                style={{
                    width: "100%",
                    padding: "8px 12px",
                    background: "rgba(63,63,70,0.5)",
                    color: "#a1a1aa",
                    border: "1px solid rgba(161, 161, 170, 0.15)",
                    borderRadius: 10,
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: "not-allowed",
                    opacity: 0.7,
                }}
            >
                {disabledLabel || "Attestation Required"}
            </button>
        );
    }

    if (state === "confirming_mint" || state === "confirming_list") {
        return (
            <button
                disabled
                style={{
                    width: "100%",
                    padding: "8px 12px",
                    background: "rgba(139,92,246,0.1)",
                    color: "#a78bfa",
                    border: "1px solid rgba(139,92,246,0.2)",
                    borderRadius: 10,
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: "wait",
                    animation: "mint-pulse 1.5s ease-in-out infinite",
                }}
            >
                <style>{`@keyframes mint-pulse { 0%,100% { opacity:0.7; } 50% { opacity:1; } }`}</style>
                {state === "confirming_mint" ? "Confirming transaction..." : "Confirming listing..."}
            </button>
        );
    }

    const tierDialogNode = tierDialog ? (
        <TierPickerDialog
            title={tierDialog === "mint" ? `Mint & list ${stemType}` : `List ${stemType} for sale`}
            confirmLabel={tierDialog === "mint" ? "Mint & list" : "List for sale"}
            asset={listingAsset}
            personalPriceUnits={listingPriceUnits}
            pricing={tierPricing}
            initialTier={licenseType}
            maxPriceUnits={maxPriceUnits}
            checkPlan={checkTierPlan}
            onConfirm={(tiers) => {
                if (tierDialog === "mint") void handleMintAndList(tiers);
                else void handleList(tiers);
            }}
            onClose={() => setTierDialog(null)}
            pending={tierDialog === "mint" ? mintAndListPending : listPending}
            notice={
                <p className="text-xs text-zinc-400">
                    {maxPriceUnits != null
                        ? `Suggested price ${listingPriceLabel} per edition. This release's current limit is ${formatListingPrice({ priceUnits: maxPriceUnits, asset: listingAsset })} per edition.`
                        : `Suggested price ${listingPriceLabel} per edition. Listings run for 7 days.`}
                </p>
            }
        />
    ) : null;

    if (state === "minted") {
        return (
            <>
            {tierDialogNode}
            <button
                onClick={() => openTierDialog("list")}
                disabled={listPending || paymentAssetsLoading || listingPriceUnavailable}
                style={{
                    width: "100%",
                    padding: "8px 12px",
                    background: listPending || paymentAssetsLoading || listingPriceUnavailable ? "rgba(63,63,70,0.5)" : "#8b5cf6",
                    color: "#fff",
                    border: "none",
                    borderRadius: 10,
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: listPending || paymentAssetsLoading ? "wait" : listingPriceUnavailable ? "not-allowed" : "pointer",
                    opacity: listPending || paymentAssetsLoading || listingPriceUnavailable ? 0.7 : 1,
                    transition: "all 0.2s",
                }}
            >
                {paymentAssetsLoading ? "Loading asset..." : listPending ? "Listing..." : listingPriceUnavailable ? "Price unavailable" : "List for Sale"}
            </button>
            </>
        );
    }

    return (
        <>
        {tierDialogNode}
        <button
            onClick={() => openTierDialog("mint")}
            disabled={mintAndListPending || paymentAssetsLoading || listingPriceUnavailable}
            style={{
                width: "100%",
                padding: "8px 12px",
                background: mintAndListPending || paymentAssetsLoading || listingPriceUnavailable ? "rgba(63,63,70,0.5)" : "#8b5cf6",
                color: "#fff",
                border: "none",
                borderRadius: 10,
                fontSize: 13,
                fontWeight: 600,
                cursor: mintAndListPending || paymentAssetsLoading ? "wait" : listingPriceUnavailable ? "not-allowed" : "pointer",
                opacity: mintAndListPending || paymentAssetsLoading || listingPriceUnavailable ? 0.7 : 1,
                transition: "all 0.2s",
            }}
        >
            {paymentAssetsLoading ? "Loading asset..." : mintAndListPending ? "Processing..." : listingPriceUnavailable ? "Price unavailable" : "Mint & List"}
        </button>
        </>
    );
}
