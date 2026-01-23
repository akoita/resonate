"use client";

import { useCallback, useRef, useState } from "react";

type FileDropZoneProps = {
    onFileSelect: (file: File) => void;
    accept?: string;
    disabled?: boolean;
};

export function FileDropZone({
    onFileSelect,
    accept = "audio/*",
    disabled = false,
}: FileDropZoneProps) {
    const [isDragging, setIsDragging] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    const handleDragOver = useCallback(
        (e: React.DragEvent) => {
            e.preventDefault();
            e.stopPropagation();
            if (!disabled) {
                setIsDragging(true);
            }
        },
        [disabled]
    );

    const handleDragLeave = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);
    }, []);

    const handleDrop = useCallback(
        (e: React.DragEvent) => {
            e.preventDefault();
            e.stopPropagation();
            setIsDragging(false);

            if (disabled) return;

            const files = e.dataTransfer.files;
            if (files.length > 0) {
                const file = files[0];
                if (file) {
                    onFileSelect(file);
                }
            }
        },
        [disabled, onFileSelect]
    );

    const handleClick = useCallback(() => {
        if (!disabled && inputRef.current) {
            inputRef.current.click();
        }
    }, [disabled]);

    const handleInputChange = useCallback(
        (e: React.ChangeEvent<HTMLInputElement>) => {
            const files = e.target.files;
            if (files && files.length > 0) {
                const file = files[0];
                if (file) {
                    onFileSelect(file);
                }
            }
            // Reset input so the same file can be selected again
            e.target.value = "";
        },
        [onFileSelect]
    );

    return (
        <div
            className={`file-drop-zone ${isDragging ? "file-drop-zone-active" : ""} ${disabled ? "file-drop-zone-disabled" : ""}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={handleClick}
            role="button"
            tabIndex={disabled ? -1 : 0}
            onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                    handleClick();
                }
            }}
        >
            <input
                ref={inputRef}
                type="file"
                accept={accept}
                onChange={handleInputChange}
                style={{ display: "none" }}
                disabled={disabled}
            />
            <div className="file-drop-zone-icon">
                <svg
                    width="32"
                    height="32"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                >
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="17 8 12 3 7 8" />
                    <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
            </div>
            <div className="file-drop-zone-text">
                <span className="file-drop-zone-primary">
                    Drop audio file here or <span className="file-drop-zone-link">browse</span>
                </span>
                <span className="file-drop-zone-secondary">
                    Supports MP3, WAV, FLAC, AIFF
                </span>
            </div>
        </div>
    );
}
