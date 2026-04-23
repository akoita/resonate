"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

interface ErrorDetailsDialogProps {
    isOpen: boolean;
    title: string;
    message: string;
    onClose: () => void;
}

export function ErrorDetailsDialog({ isOpen, title, message, onClose }: ErrorDetailsDialogProps) {
    const [mounted, setMounted] = useState(false);
    const [animating, setAnimating] = useState(false);

    // eslint-disable-next-line react-hooks/set-state-in-effect -- SSR hydration guard
    useEffect(() => setMounted(true), []);

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- trigger enter animation
        if (isOpen) setAnimating(true);
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen) return;
        const handleKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };
        window.addEventListener("keydown", handleKey);
        return () => window.removeEventListener("keydown", handleKey);
    }, [isOpen, onClose]);

    if (!isOpen || !mounted) return null;

    const copyToClipboard = async () => {
        try {
            await navigator.clipboard.writeText(message);
        } catch {
            // best-effort; some browsers block this off a user gesture chain
        }
    };

    const dialog = (
        <div
            style={{
                position: "fixed",
                inset: 0,
                background: "rgba(0, 0, 0, 0.75)",
                backdropFilter: "blur(12px)",
                WebkitBackdropFilter: "blur(12px)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                zIndex: 9999,
                opacity: animating ? 1 : 0,
                transition: "opacity 0.2s ease-out",
                padding: 24,
            }}
            onClick={onClose}
        >
            <div
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-label={title}
                style={{
                    width: "min(720px, 100%)",
                    maxHeight: "min(80vh, 640px)",
                    display: "flex",
                    flexDirection: "column",
                    background: "linear-gradient(170deg, rgba(30,30,40,0.98) 0%, rgba(18,18,24,0.99) 100%)",
                    border: "1px solid rgba(239, 68, 68, 0.22)",
                    borderRadius: 16,
                    boxShadow:
                        "0 24px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04), 0 0 40px rgba(239,68,68,0.10)",
                    overflow: "hidden",
                    animation: "error-dialog-enter 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
                }}
            >
                <style>{`
                    @keyframes error-dialog-enter {
                        from { opacity: 0; transform: scale(0.97) translateY(6px); }
                        to { opacity: 1; transform: scale(1) translateY(0); }
                    }
                `}</style>

                <div
                    style={{
                        height: 2,
                        background: "linear-gradient(90deg, transparent, #ef4444, transparent)",
                        opacity: 0.6,
                    }}
                />

                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "18px 22px 12px",
                        gap: 12,
                    }}
                >
                    <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                        <span
                            aria-hidden
                            style={{
                                width: 10,
                                height: 10,
                                borderRadius: "50%",
                                background: "#ef4444",
                                boxShadow: "0 0 0 3px rgba(239,68,68,0.18)",
                                flexShrink: 0,
                            }}
                        />
                        <h2
                            style={{
                                margin: 0,
                                fontSize: 15,
                                fontWeight: 600,
                                color: "#fff",
                                letterSpacing: "0.01em",
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                            }}
                        >
                            {title}
                        </h2>
                    </div>
                    <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                        <button
                            type="button"
                            onClick={copyToClipboard}
                            style={{
                                padding: "6px 12px",
                                borderRadius: 8,
                                border: "1px solid rgba(255,255,255,0.10)",
                                background: "rgba(255,255,255,0.04)",
                                color: "rgba(255,255,255,0.75)",
                                fontSize: 12,
                                fontWeight: 500,
                                cursor: "pointer",
                                fontFamily: "inherit",
                            }}
                        >
                            Copy
                        </button>
                        <button
                            type="button"
                            onClick={onClose}
                            aria-label="Close"
                            style={{
                                padding: "6px 12px",
                                borderRadius: 8,
                                border: "1px solid rgba(255,255,255,0.10)",
                                background: "rgba(255,255,255,0.04)",
                                color: "rgba(255,255,255,0.75)",
                                fontSize: 12,
                                fontWeight: 500,
                                cursor: "pointer",
                                fontFamily: "inherit",
                            }}
                        >
                            Close
                        </button>
                    </div>
                </div>

                <pre
                    style={{
                        margin: 0,
                        padding: "14px 22px 22px",
                        fontFamily:
                            "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Monaco, Consolas, monospace",
                        fontSize: 12.5,
                        lineHeight: 1.55,
                        color: "rgba(248, 113, 113, 0.92)",
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                        overflowY: "auto",
                        flex: 1,
                    }}
                >
                    {message}
                </pre>
            </div>
        </div>
    );

    return createPortal(dialog, document.body);
}
