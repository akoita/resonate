"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { parseEther, type Address } from "viem";
import { Button } from "../ui/Button";
import { useListStem } from "../../hooks/useContracts";
import { useToast } from "../ui/Toast";

interface ResaleModalProps {
    modal: {
        isOpen: boolean;
        stemId: string;
        tokenId: string;
        stemTitle: string;
        onSuccess?: () => void;
    } | null;
    onClose: () => void;
}

export function ResaleModal({ modal, onClose }: ResaleModalProps) {
    // SSR guard
    if (typeof window === "undefined" || !modal?.isOpen) {
        return null;
    }

    // Key forces fresh state each time modal opens
    return <ResaleModalInner modal={modal} onClose={onClose} />;
}

function ResaleModalInner({ modal, onClose }: ResaleModalProps) {
    const [price, setPrice] = useState("");
    const [duration, setDuration] = useState("7"); // days
    const { list, pending, error } = useListStem();
    const { addToast } = useToast();

    const { stemTitle, tokenId, onSuccess } = modal!;

    const handleList = async () => {
        if (!price || parseFloat(price) <= 0) {
            addToast({ type: "error", title: "Invalid Price", message: "Please enter a valid price" });
            return;
        }

        try {
            const priceInWei = parseEther(price);
            const durationSeconds = BigInt(parseInt(duration) * 24 * 60 * 60);

            await list({
                tokenId: BigInt(tokenId),
                amount: BigInt(1),
                pricePerUnit: priceInWei,
                paymentToken: "0x0000000000000000000000000000000000000000" as Address, // ETH
                durationSeconds,
            });

            addToast({
                type: "success",
                title: "Listed for Resale!",
                message: `${stemTitle} is now listed for ${price} ETH`,
            });

            onSuccess?.();
            onClose();
        } catch (err) {
            console.error("Resale listing failed:", err);
            addToast({
                type: "error",
                title: "Listing Failed",
                message: err instanceof Error ? err.message : "Failed to list stem",
            });
        }
    };

    const modalContent = (
        <div
            className="playlist-modal-overlay"
            onClick={onClose}
            style={{
                zIndex: 10000,
                background: "rgba(0, 0, 0, 0.85)",
                backdropFilter: "blur(12px)",
                position: "fixed",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                pointerEvents: "auto"
            }}
        >
            <div
                className="playlist-modal redesigned"
                onClick={(e) => e.stopPropagation()}
                style={{
                    boxShadow: "0 40px 100px rgba(0, 0, 0, 0.8), 0 0 40px rgba(124, 92, 255, 0.15)",
                    background: "#0f0f14",
                    border: "1px solid rgba(255, 255, 255, 0.08)",
                    borderRadius: "28px",
                    padding: "32px",
                    width: "100%",
                    maxWidth: "440px",
                    position: "relative"
                }}
            >
                <div style={{ marginBottom: 28 }}>
                    <h2 style={{ color: "white", fontSize: 26, fontWeight: 800, marginBottom: 8, letterSpacing: "-0.02em" }}>
                        List for Resale
                    </h2>
                    <p style={{ color: "#a1a1aa", fontSize: 15, lineHeight: 1.5 }}>
                        Set your price and duration for <span style={{ color: "white", fontWeight: 600 }}>{stemTitle}</span>
                    </p>
                </div>

                {/* Price Input */}
                <div style={{ marginBottom: 24 }}>
                    <label style={{ display: "block", color: "white", fontSize: 13, fontWeight: 700, marginBottom: 10, opacity: 0.8, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                        Price (ETH)
                    </label>
                    <div style={{ position: "relative" }}>
                        <input
                            type="number"
                            step="0.001"
                            min="0"
                            value={price}
                            onChange={(e) => setPrice(e.target.value)}
                            placeholder="0.05"
                            autoFocus
                            className="playlist-modal-input"
                            style={{
                                width: "100%",
                                padding: "16px",
                                background: "rgba(255, 255, 255, 0.03)",
                                border: "1px solid rgba(255, 255, 255, 0.1)",
                                borderRadius: "16px",
                                fontSize: "18px",
                                fontWeight: 500
                            }}
                        />
                        <div style={{ position: "absolute", right: 20, top: "50%", transform: "translateY(-50%)", color: "var(--color-accent)", fontSize: 14, fontWeight: 700 }}>
                            ETH
                        </div>
                    </div>
                </div>

                {/* Duration Select */}
                <div style={{ marginBottom: 36 }}>
                    <label style={{ display: "block", color: "white", fontSize: 13, fontWeight: 700, marginBottom: 10, opacity: 0.8, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                        Listing Duration
                    </label>
                    <div style={{ position: "relative" }}>
                        <select
                            value={duration}
                            onChange={(e) => setDuration(e.target.value)}
                            className="playlist-modal-input"
                            style={{
                                width: "100%",
                                appearance: "none",
                                padding: "16px",
                                background: "rgba(255, 255, 255, 0.03)",
                                border: "1px solid rgba(255, 255, 255, 0.1)",
                                borderRadius: "16px",
                                cursor: "pointer"
                            }}
                        >
                            <option value="1">1 Day</option>
                            <option value="3">3 Days</option>
                            <option value="7">7 Days</option>
                            <option value="14">14 Days</option>
                            <option value="30">30 Days</option>
                        </select>
                        <div style={{ position: "absolute", right: 20, top: "50%", transform: "translateY(-50%)", pointerEvents: "none", opacity: 0.5 }}>
                            ▼
                        </div>
                    </div>
                </div>

                {/* Action Buttons */}
                <div style={{ display: "flex", gap: 16 }}>
                    <Button
                        variant="ghost"
                        onClick={onClose}
                        style={{
                            flex: 1,
                            padding: "16px",
                            borderRadius: "16px",
                            fontWeight: 600,
                            border: "1px solid rgba(255, 255, 255, 0.05)"
                        }}
                    >
                        Cancel
                    </Button>
                    <Button
                        variant="primary"
                        onClick={handleList}
                        disabled={pending || !price}
                        style={{
                            flex: 1,
                            padding: "16px",
                            borderRadius: "16px",
                            background: "linear-gradient(135deg, var(--color-accent) 0%, var(--color-accent-2) 100%)",
                            fontWeight: 800,
                            boxShadow: "0 12px 24px rgba(124, 92, 255, 0.3)",
                            border: "none"
                        }}
                    >
                        {pending ? "Listing..." : "Confirm Listing"}
                    </Button>
                </div>

                {error && (
                    <div style={{
                        marginTop: 24,
                        padding: "16px",
                        borderRadius: "16px",
                        background: "rgba(239, 68, 68, 0.08)",
                        border: "1px solid rgba(239, 68, 68, 0.15)",
                        color: "#f87171",
                        fontSize: 14,
                        lineHeight: 1.5
                    }}>
                        {error.message}
                    </div>
                )}
            </div>
        </div>
    );

    return createPortal(modalContent, document.body);
}
