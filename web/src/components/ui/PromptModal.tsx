"use client";

import { useState, useEffect, useId, useRef, type KeyboardEvent } from "react";
import { Button } from "./Button";
import { useFocusContainment } from "./useFocusContainment";

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
    const dialogRef = useRef<HTMLDivElement>(null);
    const ids = useId().replace(/:/g, "");
    const titleId = `prompt-modal-title-${ids}`;
    const descriptionId = `prompt-modal-description-${ids}`;
    const inputId = `prompt-modal-input-${ids}`;

    useEffect(() => {
        if (isOpen) {
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setValue(initialValue);
        }
    }, [isOpen, initialValue]);

    useFocusContainment({
        active: isOpen,
        containerRef: dialogRef,
        initialFocusRef: inputRef,
        onEscape: onCancel,
    });

    const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter") {
            e.preventDefault();
            onConfirm(value);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="playlist-modal-overlay" style={{ zIndex: 2000 }}>
            <div
                className="playlist-modal redesigned"
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                aria-describedby={description ? descriptionId : undefined}
                tabIndex={-1}
                onClick={(e) => e.stopPropagation()}
                style={{ maxWidth: "400px" }}
            >
                <div className="playlist-modal-header" style={{ paddingBottom: "16px" }}>
                    <h3 id={titleId} style={{ fontSize: "20px" }}>{title}</h3>
                    {description && (
                        <p id={descriptionId} className="text-sm text-white/50 mt-1">{description}</p>
                    )}
                </div>

                <div style={{ padding: "24px 32px" }}>
                    <input
                        ref={inputRef}
                        id={inputId}
                        type="text"
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder={placeholder}
                        aria-label={title}
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
