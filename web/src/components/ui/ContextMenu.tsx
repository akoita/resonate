"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useFocusContainment } from "./useFocusContainment";

export type ContextMenuItem = {
    label: string;
    icon?: ReactNode;
    onClick: () => void;
    variant?: "default" | "destructive";
    separator?: boolean;
    disabled?: boolean;
};

interface ContextMenuProps {
    x: number;
    y: number;
    items: ContextMenuItem[];
    onClose: () => void;
    /** Optional explicit opener; otherwise the focused element is restored. */
    openerRef?: { readonly current: HTMLElement | null };
    /** Accessible name for the menu. */
    ariaLabel?: string;
}

export function ContextMenu({
    x,
    y,
    items,
    onClose,
    openerRef,
    ariaLabel = "Context menu",
}: ContextMenuProps) {
    const menuRef = useRef<HTMLDivElement>(null);
    const firstItemRef = useRef<HTMLButtonElement>(null);
    const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
    const [activeIndex, setActiveIndex] = useState<number | null>(null);
    const enabledIndices = items.reduce<number[]>((indices, item, index) => {
        if (!item.separator && !item.disabled) indices.push(index);
        return indices;
    }, []);
    const firstEnabledIndex = enabledIndices[0];
    const rovingIndex = activeIndex !== null && enabledIndices.includes(activeIndex)
        ? activeIndex
        : firstEnabledIndex;

    useFocusContainment({
        active: typeof document !== "undefined",
        containerRef: menuRef,
        initialFocusRef: firstItemRef,
        restoreFocusRef: openerRef,
        onEscape: onClose,
        trapTab: false,
    });

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                onClose();
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [onClose]);

    const focusItem = (index: number) => {
        if (!enabledIndices.includes(index)) return;
        setActiveIndex(index);
        itemRefs.current[index]?.focus();
    };

    const handleMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (enabledIndices.length === 0) return;

        const focusedIndex = itemRefs.current.findIndex((item) => item === document.activeElement);
        const currentIndex = focusedIndex >= 0 && enabledIndices.includes(focusedIndex)
            ? focusedIndex
            : rovingIndex ?? enabledIndices[0];
        const currentPosition = Math.max(0, enabledIndices.indexOf(currentIndex));
        let nextIndex: number | undefined;

        switch (event.key) {
            case "ArrowDown":
                nextIndex = enabledIndices[(currentPosition + 1) % enabledIndices.length];
                break;
            case "ArrowUp":
                nextIndex = enabledIndices[(currentPosition - 1 + enabledIndices.length) % enabledIndices.length];
                break;
            case "Home":
                nextIndex = enabledIndices[0];
                break;
            case "End":
                nextIndex = enabledIndices[enabledIndices.length - 1];
                break;
            default:
                return;
        }

        event.preventDefault();
        if (nextIndex !== undefined) focusItem(nextIndex);
    };

    const style = {
        top: y,
        left: x,
    };

    if (typeof document === "undefined") return null;

    return createPortal(
        <div
            ref={menuRef}
            className="fixed z-[9999] min-w-[200px] bg-[#1E1E1E]/90 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl py-1.5 animate-in fade-in zoom-in-95 duration-200 overflow-hidden"
            style={style}
            role="menu"
            aria-label={ariaLabel}
            tabIndex={-1}
            onKeyDown={handleMenuKeyDown}
            onContextMenu={(event) => event.preventDefault()}
        >
            {items.map((item, index) => (
                <div key={`${item.label}-${index}`}>
                    {item.separator && (
                        <div
                            className="h-[1px] bg-white/5 my-1"
                            role="separator"
                            aria-hidden="true"
                        />
                    )}
                    {!item.separator && (
                        <button
                            type="button"
                            role="menuitem"
                            disabled={item.disabled}
                            aria-disabled={item.disabled || undefined}
                            tabIndex={index === rovingIndex ? 0 : -1}
                            ref={(element) => {
                                itemRefs.current[index] = element;
                                if (index === firstEnabledIndex) firstItemRef.current = element;
                            }}
                            onFocus={() => setActiveIndex(index)}
                            onClick={() => {
                                item.onClick();
                                onClose();
                            }}
                            className={`w-full text-left px-4 py-2 text-[13px] font-medium flex items-center gap-3 hover:bg-white/10 transition-all active:scale-95
                  ${item.variant === "destructive" ? "text-red-400 hover:text-red-300 hover:bg-red-500/10" : "text-white/80 hover:text-white"}
                `}
                        >
                            {item.icon && (
                                <span
                                    className="w-5 h-5 flex items-center justify-center text-sm opacity-80"
                                    aria-hidden="true"
                                >
                                    {item.icon}
                                </span>
                            )}
                            <span>{item.label}</span>
                        </button>
                    )}
                </div>
            ))}
        </div>,
        document.body,
    );
}
