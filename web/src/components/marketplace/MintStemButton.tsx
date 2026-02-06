import { useState, useEffect } from "react";
import { useAuth } from "../auth/AuthProvider";
import { useMintStem, useListStem, useTotalStems } from "../../hooks/useContracts";
import { getListingsByStem, getStemNftInfo } from "../../lib/api";
import { useToast } from "../ui/Toast";
import { type Address } from "viem";

interface MintStemButtonProps {
    stemId: string;
    stemTitle: string;
    stemType: string;
    trackTitle: string;
    metadataUri?: string;
}

export function MintStemButton({
    stemId,
    stemTitle,
    stemType,
    trackTitle,
    metadataUri,
}: MintStemButtonProps) {
    const { address, status } = useAuth();
    const { mint, pending: mintPending } = useMintStem();
    const { list, pending: listPending } = useListStem();
    const { total: totalStems, refresh: refetchTotal } = useTotalStems();
    const { addToast } = useToast();

    // State machine: "idle" -> "minted" -> "listed"
    const [state, setState] = useState<"idle" | "minted" | "listed">("idle");
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
            const tokenUri = metadataUri || `${window.location.protocol}//${window.location.host}/api/metadata/31337/stem/${stemId}`;

            // Get user's local signer address (deterministic per user, auto-funded from Anvil)
            const { getLocalSignerAddress } = await import("../../lib/localAA");
            const mintTo = getLocalSignerAddress(address as Address); // User's own local account

            // Get current total before minting (next token ID will be totalStems + 1)
            const currentTotal = totalStems ?? BigInt(0);
            const expectedTokenId = currentTotal + BigInt(1);

            const hash = await mint({
                to: mintTo,
                amount: BigInt(1),
                tokenURI: tokenUri,
                royaltyReceiver: address as Address,
                royaltyBps: 500,
                remixable: true,
                parentIds: [],
            });

            // Use expected token ID
            setMintedTokenId(expectedTokenId);
            setState("minted");

            // Persist to local storage
            localStorage.setItem(`stem_status_${stemId}`, "minted");
            localStorage.setItem(`stem_token_id_${stemId}`, expectedTokenId.toString());

            // Refresh total for next mint
            refetchTotal?.();

            addToast({
                type: "success",
                title: "NFT Minted!",
                message: `${stemType} stem minted (Token #${expectedTokenId}). Now list it for sale.`,
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

            setState("listed");
            localStorage.setItem(`stem_status_${stemId}`, "listed");
            addToast({
                type: "success",
                title: "Listed for Sale!",
                message: `${stemType} stem (Token #${mintedTokenId}) is now on the marketplace for 0.01 ETH`,
            });
        } catch (error) {
            console.error("List failed:", error);
            addToast({
                type: "error",
                title: "List Failed",
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
