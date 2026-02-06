"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";

export type ActionMenuItem = {
    label: string;
    icon?: React.ReactNode;
    onClick: () => void;
    variant?: "default" | "destructive";
};

interface TrackActionMenuProps {
    actions: ActionMenuItem[];
    className?: string;
}

/**
 * A beautiful, subtle "more actions" menu for track items.
 * Displays a minimal ⋮ button that opens a dropdown with available actions.
 */
export function TrackActionMenu({ actions, className = "" }: TrackActionMenuProps) {
    const [isOpen, setIsOpen] = useState(false);
    const buttonRef = useRef<HTMLButtonElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);

    // Close on outside click
    useEffect(() => {
        if (!isOpen) return;

        const handleClickOutside = (e: MouseEvent) => {
            if (
                menuRef.current &&
                !menuRef.current.contains(e.target as Node) &&
                buttonRef.current &&
                !buttonRef.current.contains(e.target as Node)
            ) {
                setIsOpen(false);
            }
        };

        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === "Escape") setIsOpen(false);
        };

        document.addEventListener("mousedown", handleClickOutside);
        document.addEventListener("keydown", handleEscape);
        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
            document.removeEventListener("keydown", handleEscape);
        };
    }, [isOpen]);

    // Position the dropdown menu via callback ref (avoids reading refs during render)
    const positionMenu = useCallback((node: HTMLDivElement | null) => {
        if (!node || !buttonRef.current) return;
        menuRef.current = node;
        const rect = buttonRef.current.getBoundingClientRect();
        const menuWidth = 200;
        const menuHeight = actions.length * 40 + 16;

        let top = rect.bottom + 8;
        let left = rect.right - menuWidth;

        if (left < 16) left = 16;
        if (top + menuHeight > window.innerHeight - 16) {
            top = rect.top - menuHeight - 8;
        }

        node.style.position = "fixed";
        node.style.top = `${top}px`;
        node.style.left = `${left}px`;
        node.style.zIndex = "9999";
    }, [actions.length]);

    const handleActionClick = (action: ActionMenuItem) => {
        action.onClick();
        setIsOpen(false);
    };

    return (
        <>
            <button
                ref={buttonRef}
                className={`track-action-menu-trigger ${isOpen ? "active" : ""} ${className}`}
                onClick={(e) => {
                    e.stopPropagation();
                    setIsOpen(!isOpen);
                }}
                aria-label="More actions"
                title="More actions"
            >
                <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                >
                    <circle cx="12" cy="5" r="1.5" fill="currentColor" stroke="none" />
                    <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
                    <circle cx="12" cy="19" r="1.5" fill="currentColor" stroke="none" />
                </svg>
            </button>

            {isOpen &&
                typeof document !== "undefined" &&
                createPortal(
                    <div
                        ref={positionMenu}
                        className="track-action-menu-dropdown"
                    >
                        {actions.map((action, index) => (
                            <button
                                key={index}
                                className={`track-action-menu-item ${action.variant === "destructive" ? "destructive" : ""}`}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    handleActionClick(action);
                                }}
                            >
                                {action.icon && (
                                    <span className="track-action-menu-icon">{action.icon}</span>
                                )}
                                <span>{action.label}</span>
                            </button>
                        ))}
                    </div>,
                    document.body
                )}
        </>
    );
}
