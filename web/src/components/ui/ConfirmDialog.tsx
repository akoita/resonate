"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "./Button";

interface ConfirmDialogProps {
    isOpen: boolean;
    title: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    variant?: "danger" | "warning" | "default";
    onConfirm: () => void;
    onCancel: () => void;
}

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

    useEffect(() => setMounted(true), []);

    useEffect(() => {
        if (!isOpen) return;
        const handleKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") onCancel();
        };
        window.addEventListener("keydown", handleKey);
        return () => window.removeEventListener("keydown", handleKey);
    }, [isOpen, onCancel]);

    if (!isOpen || !mounted) return null;

    const iconMap = {
        danger: "🗑️",
        warning: "⚠️",
        default: "❓",
    };

    const confirmColorMap = {
        danger: "var(--color-error, #ef4444)",
        warning: "var(--color-warning, #eab308)",
        default: "var(--color-accent, #6366f1)",
    };

    const dialog = (
        <div
            style={{
                position: "fixed",
                inset: 0,
                background: "rgba(0, 0, 0, 0.85)",
                backdropFilter: "blur(8px)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                zIndex: 9999,
                animation: "modal-backdrop-in 0.3s ease-out",
            }}
            onClick={onCancel}
        >
            <div
                onClick={(e) => e.stopPropagation()}
                style={{
                    maxWidth: "440px",
                    width: "calc(100% - 48px)",
                    background: "#1a1a24",
                    border: "1px solid rgba(255, 255, 255, 0.12)",
                    borderRadius: "24px",
                    boxShadow: "0 30px 80px rgba(0, 0, 0, 0.9), 0 0 0 1px rgba(255, 255, 255, 0.05)",
                    overflow: "hidden",
                    animation: "modal-slide-up 0.4s cubic-bezier(0.16, 1, 0.3, 1)",
                }}
            >
                <div style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    padding: "32px 32px 16px",
                    gap: "16px",
                    textAlign: "center",
                }}>
                    <div style={{
                        width: "56px",
                        height: "56px",
                        borderRadius: "50%",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: "24px",
                        background: variant === "danger"
                            ? "rgba(239, 68, 68, 0.15)"
                            : variant === "warning"
                                ? "rgba(234, 179, 8, 0.15)"
                                : "rgba(99, 102, 241, 0.15)",
                        border: `1px solid ${variant === "danger"
                            ? "rgba(239, 68, 68, 0.25)"
                            : variant === "warning"
                                ? "rgba(234, 179, 8, 0.25)"
                                : "rgba(99, 102, 241, 0.25)"}`,
                    }}>
                        {iconMap[variant]}
                    </div>

                    <h3 style={{
                        fontSize: "20px",
                        fontWeight: 600,
                        color: "#fff",
                        margin: 0,
                    }}>
                        {title}
                    </h3>

                    <p style={{
                        fontSize: "14px",
                        lineHeight: 1.6,
                        color: "rgba(255,255,255,0.6)",
                        margin: 0,
                        maxWidth: "340px",
                    }}>
                        {message}
                    </p>
                </div>

                <div style={{
                    display: "flex",
                    gap: "12px",
                    padding: "16px 32px 28px",
                }}>
                    <Button
                        variant="ghost"
                        onClick={onCancel}
                        className="flex-1"
                    >
                        {cancelLabel}
                    </Button>
                    <Button
                        onClick={onConfirm}
                        className="flex-1"
                        style={{
                            background: confirmColorMap[variant],
                            color: "white",
                            border: "none",
                        }}
                    >
                        {confirmLabel}
                    </Button>
                </div>
            </div>
        </div>
    );

    return createPortal(dialog, document.body);
}
