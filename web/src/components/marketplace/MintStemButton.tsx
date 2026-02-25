import { useState, useEffect } from "react";
import { useAuth } from "../auth/AuthProvider";
import { useMintStem, useListStem, useMintAndListStem } from "../../hooks/useContracts";
import { getListingsByStem, getStemNftInfo } from "../../lib/api";
import { useToast } from "../ui/Toast";
import { type Address } from "viem";

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
    stemTitle: string;
    stemType: string;
    trackTitle: string;
    metadataUri?: string;
}

export function MintStemButton({
    stemId,
    
    stemType,
    
    metadataUri,
}: MintStemButtonProps) {
    const { address, status, kernelAccount } = useAuth();
    const { mint, pending: mintPending } = useMintStem();
    const { list, pending: listPending } = useListStem();
    const { mintAndList, pending: mintAndListPending } = useMintAndListStem();
    const { addToast } = useToast();

    // Determine if we should use the single-click AA flow
    const currentChainId = process.env.NEXT_PUBLIC_CHAIN_ID || "31337";
    const isLocalDev = currentChainId === "31337" || (process.env.NEXT_PUBLIC_RPC_URL || "").includes("localhost");

    // State machine: "idle" -> "minted" -> "listed"
    // "confirming_mint" and "confirming_list" are transient states while polling the backend
    const [state, setState] = useState<"idle" | "confirming_mint" | "minted" | "confirming_list" | "listed">("idle");
    const [mintedTokenId, setMintedTokenId] = useState<bigint | null>(null);

    // Persistence check on mount
    useEffect(() => {
        const checkStatus = async () => {
            try {
                // 1. Initial hint from local storage (faster UI)
                const localStatus = localStorage.getItem(`stem_status_${stemId}`);
                if (localStatus === "listed") {
                    setState("listed");
                } else if (localStatus === "minted") {
                    const localId = localStorage.getItem(`stem_token_id_${stemId}`);
                    if (localId) {
                        setMintedTokenId(BigInt(localId));
                        setState("minted");
                    }
                }

                // 2. Verify with backend API (source of truth)
                // First check for a listing
                const listings = await getListingsByStem(stemId);
                if (listings && listings.length > 0) {
                    setState("listed");
                    localStorage.setItem(`stem_status_${stemId}`, "listed");
                    return;
                }

                // If not listed in backend, check if it was at least minted
                const nftInfo = await getStemNftInfo(stemId);
                if (nftInfo) {
                    const tid = BigInt(nftInfo.tokenId);
                    setMintedTokenId(tid);
                    setState("minted");
                    localStorage.setItem(`stem_status_${stemId}`, "minted");
                    localStorage.setItem(`stem_token_id_${stemId}`, tid.toString());
                } else {
                    // Not minted in backend truth
                    setState("idle");
                    localStorage.removeItem(`stem_status_${stemId}`);
                    localStorage.removeItem(`stem_token_id_${stemId}`);
                }
            } catch (err) {
                // Ignore API errors, stick with local hint if available
                console.warn("Status check failed, falling back to local state", err);
            }
        };

        if (stemId) {
            checkStatus();
        }
    }, [stemId]);

    const handleMint = async () => {
        if (!address) {
            addToast({
                type: "error",
                title: "Wallet Required",
                message: "Connect your wallet to mint NFTs",
            });
            return;
        }

        try {
            const currentChainId = process.env.NEXT_PUBLIC_CHAIN_ID || "31337";
            const tokenUri = metadataUri || `${window.location.protocol}//${window.location.host}/api/metadata/${currentChainId}/stem/${stemId}`;

            const hash = await mint({
                to: address as Address,
                amount: BigInt(1),
                tokenURI: tokenUri,
                royaltyReceiver: address as Address,
                royaltyBps: 500,
                remixable: true,
                parentIds: [],
            });

            // Tx confirmed on-chain — now wait for backend indexer to process the event
            // and give us the actual token ID (no more stale-counter guessing)
            setState("confirming_mint");

            const actualTokenId = await pollForMintedTokenId(stemId);
            setMintedTokenId(actualTokenId);
            setState("minted");

            // Persist to local storage
            localStorage.setItem(`stem_status_${stemId}`, "minted");
            localStorage.setItem(`stem_token_id_${stemId}`, actualTokenId.toString());

            addToast({
                type: "success",
                title: "NFT Minted!",
                message: `${stemType} stem minted (Token #${actualTokenId}). Now list it for sale.`,
            });
        } catch (error) {
            console.error("Mint failed:", error);
            addToast({
                type: "error",
                title: "Mint Failed",
                message: error instanceof Error ? error.message : "Transaction failed",
            });
        }
    };

    const handleList = async () => {
        if (!address || !mintedTokenId) {
            addToast({
                type: "error",
                title: "Error",
                message: "No minted token to list",
            });
            return;
        }

        try {
            // List for 0.01 ETH, 1 unit, 7 days
            const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;

            const hash = await list({
                tokenId: mintedTokenId,
                pricePerUnit: BigInt("10000000000000000"), // 0.01 ETH
                amount: BigInt(1),
                paymentToken: ZERO_ADDRESS,
                durationSeconds: BigInt(7 * 24 * 60 * 60),
            });

            // Tx confirmed on-chain — wait for backend indexer to confirm listing
            setState("confirming_list");

            const confirmed = await pollForListing(stemId);
            if (confirmed) {
                setState("listed");
                localStorage.setItem(`stem_status_${stemId}`, "listed");
                addToast({
                    type: "success",
                    title: "Listed for Sale!",
                    message: `${stemType} stem (Token #${mintedTokenId}) is now on the marketplace for 0.01 ETH`,
                });
            } else {
                // Listing tx went through but indexer hasn't confirmed yet
                // Stay in "minted" so user can retry
                setState("minted");
                addToast({
                    type: "warning",
                    title: "Listing Pending",
                    message: "Transaction succeeded but marketplace hasn't confirmed yet. Try again in a moment.",
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

    const handleMintAndList = async () => {
        if (!address) {
            addToast({ type: "error", title: "Wallet Required", message: "Connect your wallet" });
            return;
        }

        try {
            const tokenUri = metadataUri || `${window.location.protocol}//${window.location.host}/api/metadata/${currentChainId}/stem/${stemId}`;
            const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;

            setState("confirming_mint");

            const { expectedTokenId } = await mintAndList({
                amount: BigInt(1),
                tokenURI: tokenUri,
                royaltyBps: 500,
                remixable: true,
                parentIds: [],
                pricePerUnit: BigInt("10000000000000000"), // 0.01 ETH
                paymentToken: ZERO_ADDRESS,
                durationSeconds: BigInt(7 * 24 * 60 * 60),
            });

            // The batch UserOperation already waited for on-chain receipt,
            // so mint + approve + list are all confirmed at this point.
            setMintedTokenId(expectedTokenId);
            setState("listed");
            localStorage.setItem(`stem_status_${stemId}`, "listed");
            localStorage.setItem(`stem_token_id_${stemId}`, expectedTokenId.toString());

            addToast({
                type: "success",
                title: "Minted & Listed!",
                message: `${stemType} stem (Token #${expectedTokenId}) is now on the marketplace for 0.01 ETH`,
            });

            // Kick off background indexer poll (non-blocking) so the
            // marketplace page picks up the listing faster
            pollForListing(stemId).catch(() => { /* indexer will catch up eventually */ });
        } catch (error) {
            console.error("Mint & List failed:", error);
            setState("idle");
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
                    background: "#3f3f46",
                    color: "#71717a",
                    border: "none",
                    borderRadius: 8,
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
                    background: "#065f46",
                    color: "#10b981",
                    border: "1px solid #10b981",
                    borderRadius: 8,
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: "default",
                }}
            >
                ✓ Listed
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
                    background: "#3f3f46",
                    color: "#a1a1aa",
                    border: "1px solid rgba(161, 161, 170, 0.3)",
                    borderRadius: 8,
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: "wait",
                    opacity: 0.8,
                }}
            >
                {state === "confirming_mint" ? (!isLocalDev ? "Confirming transaction..." : "Confirming mint...") : "Confirming listing..."}
            </button>
        );
    }

    if (state === "minted") {
        return (
            <button
                onClick={handleList}
                disabled={listPending}
                style={{
                    width: "100%",
                    padding: "8px 12px",
                    background: listPending ? "#3f3f46" : "#8b5cf6",
                    color: "#fff",
                    border: "none",
                    borderRadius: 8,
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: listPending ? "wait" : "pointer",
                    opacity: listPending ? 0.7 : 1,
                }}
            >
                {listPending ? "Listing..." : "List for Sale"}
            </button>
        );
    }

    if (!isLocalDev) {
        return (
            <button
                onClick={handleMintAndList}
                disabled={mintAndListPending}
                style={{
                    width: "100%",
                    padding: "8px 12px",
                    background: mintAndListPending ? "#3f3f46" : "#8b5cf6",
                    color: "#fff",
                    border: "none",
                    borderRadius: 8,
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: mintAndListPending ? "wait" : "pointer",
                    opacity: mintAndListPending ? 0.7 : 1,
                }}
            >
                {mintAndListPending ? "Processing..." : "Mint & List"}
            </button>
        );
    }

    return (
        <button
            onClick={handleMint}
            disabled={mintPending}
            style={{
                width: "100%",
                padding: "8px 12px",
                background: mintPending ? "#3f3f46" : "#10b981",
                color: "#fff",
                border: "none",
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
                cursor: mintPending ? "wait" : "pointer",
                opacity: mintPending ? 0.7 : 1,
            }}
        >
            {mintPending ? "Minting..." : "Mint as NFT"}
        </button>
    );
}
