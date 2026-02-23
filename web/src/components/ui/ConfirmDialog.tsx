"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

interface ConfirmDialogProps {
    isOpen: boolean;
    title: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    variant?: "danger" | "warning" | "default";
    onConfirm: () => void | Promise<void>;
    onCancel: () => void;
}

/* ---------- SVG Icons ---------- */

function TrashIcon() {
    return (
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            <line x1="10" y1="11" x2="10" y2="17" />
            <line x1="14" y1="11" x2="14" y2="17" />
        </svg>
    );
}

function WarningIcon() {
    return (
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
    );
}

function QuestionIcon() {
    return (
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
    );
}

/* ---------- Variant Configs ---------- */

const variantConfig = {
    danger: {
        color: "#ef4444",
        bgLight: "rgba(239, 68, 68, 0.08)",
        bgMedium: "rgba(239, 68, 68, 0.12)",
        borderColor: "rgba(239, 68, 68, 0.20)",
        glow: "0 0 40px rgba(239, 68, 68, 0.15)",
        Icon: TrashIcon,
    },
    warning: {
        color: "#f59e0b",
        bgLight: "rgba(245, 158, 11, 0.08)",
        bgMedium: "rgba(245, 158, 11, 0.12)",
        borderColor: "rgba(245, 158, 11, 0.20)",
        glow: "0 0 40px rgba(245, 158, 11, 0.15)",
        Icon: WarningIcon,
    },
    default: {
        color: "#8b5cf6",
        bgLight: "rgba(139, 92, 246, 0.08)",
        bgMedium: "rgba(139, 92, 246, 0.12)",
        borderColor: "rgba(139, 92, 246, 0.20)",
        glow: "0 0 40px rgba(139, 92, 246, 0.15)",
        Icon: QuestionIcon,
    },
};

/* ---------- Component ---------- */

export function ConfirmDialog({
    isOpen,
    title,
    message,
    confirmLabel = "Confirm",
    cancelLabel = "Cancel",
    variant = "default",
    onConfirm,
    onCancel,
}: ConfirmDialogProps) {
    const [mounted, setMounted] = useState(false);
    const [animating, setAnimating] = useState(false);
    const [loading, setLoading] = useState(false);

    // eslint-disable-next-line react-hooks/set-state-in-effect -- SSR hydration guard
    useEffect(() => setMounted(true), []);

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- trigger enter animation
        if (isOpen) setAnimating(true);
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen) {
            return;
        }
        // eslint-disable-next-line react-hooks/set-state-in-effect -- reset loading when dialog opens
        setLoading(false);
        const handleKey = (e: KeyboardEvent) => {
            if (e.key === "Escape" && !loading) onCancel();
        };
        window.addEventListener("keydown", handleKey);
        return () => {
            window.removeEventListener("keydown", handleKey);
        };
    }, [isOpen, onCancel, loading]);

    if (!isOpen || !mounted) return null;

    const v = variantConfig[variant];
    const IconComponent = v.Icon;

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
                padding: "24px",
            }}
            onClick={() => { if (!loading) onCancel(); }}
        >
            {/* Keyframes injected inline */}
            <style>{`
                @keyframes confirm-spinner {
                    to { transform: rotate(360deg); }
                }
                @keyframes confirm-dialog-enter {
                    from {
                        opacity: 0;
                        transform: scale(0.95) translateY(8px);
                    }
                    to {
                        opacity: 1;
                        transform: scale(1) translateY(0);
                    }
                }
                @keyframes confirm-icon-pulse {
                    0%, 100% { transform: scale(1); }
                    50% { transform: scale(1.05); }
                }
                .confirm-dialog-cancel-btn {
                    flex: 1;
                    padding: 12px 24px;
                    border-radius: 12px;
                    border: 1px solid rgba(255, 255, 255, 0.10);
                    background: rgba(255, 255, 255, 0.04);
                    color: rgba(255, 255, 255, 0.7);
                    font-size: 14px;
                    font-weight: 500;
                    cursor: pointer;
                    transition: all 0.2s ease;
                    font-family: inherit;
                    letter-spacing: 0.01em;
                }
                .confirm-dialog-cancel-btn:hover {
                    background: rgba(255, 255, 255, 0.08);
                    border-color: rgba(255, 255, 255, 0.18);
                    color: #fff;
                }
                .confirm-dialog-confirm-btn {
                    flex: 1;
                    padding: 12px 24px;
                    border-radius: 12px;
                    border: none;
                    color: #fff;
                    font-size: 14px;
                    font-weight: 600;
                    cursor: pointer;
                    transition: all 0.2s ease;
                    font-family: inherit;
                    letter-spacing: 0.01em;
                }
                .confirm-dialog-confirm-btn:hover:not(:disabled) {
                    filter: brightness(1.15);
                    transform: translateY(-1px);
                    box-shadow: 0 4px 16px rgba(0,0,0,0.3);
                }
                .confirm-dialog-confirm-btn:active:not(:disabled) {
                    transform: translateY(0);
                }
                .confirm-dialog-confirm-btn:disabled,
                .confirm-dialog-cancel-btn:disabled {
                    opacity: 0.5;
                    cursor: not-allowed;
                    pointer-events: none;
                }
            `}</style>

            <div
                onClick={(e) => e.stopPropagation()}
                style={{
                    maxWidth: "420px",
                    width: "100%",
                    background: "linear-gradient(170deg, rgba(30, 30, 40, 0.98) 0%, rgba(18, 18, 24, 0.99) 100%)",
                    border: `1px solid ${v.borderColor}`,
                    borderRadius: "20px",
                    boxShadow: `
                        0 24px 80px rgba(0, 0, 0, 0.6),
                        0 0 0 1px rgba(255, 255, 255, 0.04),
                        ${v.glow}
                    `,
                    overflow: "hidden",
                    animation: "confirm-dialog-enter 0.35s cubic-bezier(0.16, 1, 0.3, 1)",
                }}
            >
                {/* Top accent line */}
                <div style={{
                    height: "2px",
                    background: `linear-gradient(90deg, transparent, ${v.color}, transparent)`,
                    opacity: 0.6,
                }} />

                {/* Content */}
                <div style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    padding: "36px 32px 20px",
                    gap: "20px",
                    textAlign: "center",
                }}>
                    {/* Icon */}
                    <div style={{
                        width: "64px",
                        height: "64px",
                        borderRadius: "18px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        background: v.bgLight,
                        border: `1px solid ${v.borderColor}`,
                        color: v.color,
                        animation: "confirm-icon-pulse 2s ease-in-out infinite",
                        boxShadow: `inset 0 1px 0 rgba(255,255,255,0.04)`,
                    }}>
                        <IconComponent />
                    </div>

                    {/* Title */}
                    <h3 style={{
                        fontSize: "18px",
                        fontWeight: 600,
                        color: "#fff",
                        margin: 0,
                        letterSpacing: "-0.01em",
                        lineHeight: 1.3,
                    }}>
                        {title}
                    </h3>

                    {/* Message */}
                    <p style={{
                        fontSize: "13.5px",
                        lineHeight: 1.65,
                        color: "rgba(255, 255, 255, 0.5)",
                        margin: 0,
                        maxWidth: "320px",
                    }}>
                        {message}
                    </p>
                </div>

                {/* Divider */}
                <div style={{
                    height: "1px",
                    background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.06), transparent)",
                    margin: "0 24px",
                }} />

                {/* Actions */}
                <div style={{
                    display: "flex",
                    gap: "10px",
                    padding: "20px 24px 24px",
                }}>
                    <button
                        className="confirm-dialog-cancel-btn"
                        onClick={onCancel}
                        disabled={loading}
                    >
                        {cancelLabel}
                    </button>
                    <button
                        className="confirm-dialog-confirm-btn"
                        onClick={async () => {
                            setLoading(true);
                            try {
                                await onConfirm();
                            } catch {
                                setLoading(false);
                            }
                        }}
                        disabled={loading}
                        style={{
                            background: `linear-gradient(135deg, ${v.color}, ${v.color}dd)`,
                            boxShadow: `0 2px 12px ${v.color}40`,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: "8px",
                        }}
                    >
                        {loading && (
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                                style={{ animation: "confirm-spinner 0.8s linear infinite" }}>
                                <circle cx="12" cy="12" r="10" stroke="rgba(255,255,255,0.3)"
                                    strokeWidth="3" />
                                <path d="M12 2a10 10 0 0 1 10 10" stroke="#fff"
                                    strokeWidth="3" strokeLinecap="round" />
                            </svg>
                        )}
                        {loading ? "Processing…" : confirmLabel}
                    </button>
                </div>
            </div>
        </div>
    );

    return createPortal(dialog, document.body);
}
