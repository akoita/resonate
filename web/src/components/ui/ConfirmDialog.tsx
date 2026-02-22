"use client";

import { useEffect } from "react";
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




    useEffect(() => {
        if (!isOpen) return;
        const handleKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") onCancel();
        };
        window.addEventListener("keydown", handleKey);
        return () => window.removeEventListener("keydown", handleKey);
    }, [isOpen, onCancel]);

    if (!isOpen) return null;

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

    return (
        <div
            className="playlist-modal-overlay"
            style={{ zIndex: 2000 }}
            onClick={onCancel}
        >
            <div
                className="playlist-modal redesigned"
                onClick={(e) => e.stopPropagation()}
                style={{ maxWidth: "440px" }}
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
                        color: "var(--color-text-primary, #fff)",
                        margin: 0,
                    }}>
                        {title}
                    </h3>

                    <p style={{
                        fontSize: "14px",
                        lineHeight: 1.6,
                        color: "var(--color-text-secondary, rgba(255,255,255,0.6))",
                        margin: 0,
                        maxWidth: "340px",
                    }}>
                        {message}
                    </p>
                </div>

                <div className="playlist-modal-footer" style={{
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
}
