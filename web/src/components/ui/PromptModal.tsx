"use client";

import { useState, useEffect, useRef } from "react";
import { Button } from "./Button";

interface PromptModalProps {
    isOpen: boolean;
    title: string;
    description?: string;
    placeholder?: string;
    initialValue?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    onConfirm: (value: string) => void;
    onCancel: () => void;
}

export function PromptModal({
    isOpen,
    title,
    description,
    placeholder = "Enter value...",
    initialValue = "",
    confirmLabel = "Confirm",
    cancelLabel = "Cancel",
    onConfirm,
    onCancel,
}: PromptModalProps) {
    const [value, setValue] = useState(initialValue);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (isOpen) {
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setValue(initialValue);
            // Autofocus after animation
            setTimeout(() => inputRef.current?.focus(), 100);
        }
    }, [isOpen, initialValue]);

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter") {
            onConfirm(value);
        } else if (e.key === "Escape") {
            onCancel();
        }
    };

    if (!isOpen) return null;

    return (
        <div className="playlist-modal-overlay" style={{ zIndex: 2000 }}>
            <div
                className="playlist-modal redesigned"
                onClick={(e) => e.stopPropagation()}
                style={{ maxWidth: "400px" }}
            >
                <div className="playlist-modal-header" style={{ paddingBottom: "16px" }}>
                    <h3 style={{ fontSize: "20px" }}>{title}</h3>
                    {description && (
                        <p className="text-sm text-white/50 mt-1">{description}</p>
                    )}
                </div>

                <div style={{ padding: "24px 32px" }}>
                    <input
                        ref={inputRef}
                        type="text"
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder={placeholder}
                        className="playlist-search-input"
                        style={{ paddingLeft: "16px" }}
                    />
                </div>

                <div className="playlist-modal-footer flex gap-3">
                    <Button
                        variant="ghost"
                        onClick={onCancel}
                        className="flex-1"
                    >
                        {cancelLabel}
                    </Button>
                    <Button
                        onClick={() => onConfirm(value)}
                        className="flex-1"
                        style={{
                            background: "var(--color-accent)",
                            color: "white",
                            border: "none"
                        }}
                    >
                        {confirmLabel}
                    </Button>
                </div>
            </div>
        </div>
    );
}
