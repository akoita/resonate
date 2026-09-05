"use client";

import { useEffect, useRef } from "react";

type FocusRef = {
    readonly current: HTMLElement | null;
};

type FocusContainmentOptions = {
    active: boolean;
    containerRef: FocusRef;
    initialFocusRef?: FocusRef;
    restoreFocusRef?: FocusRef;
    onEscape?: () => void;
    escapeDisabled?: boolean;
    trapTab?: boolean;
};

const FOCUSABLE_SELECTOR = [
    "a[href]",
    "area[href]",
    "button:not([disabled])",
    "input:not([disabled]):not([type=\"hidden\"])",
    "select:not([disabled])",
    "textarea:not([disabled])",
    "iframe",
    "object",
    "embed",
    "[contenteditable=\"true\"]",
    "[tabindex]:not([tabindex=\"-1\"])",
].join(",");

function getFocusableElements(container: HTMLElement): HTMLElement[] {
    return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (element) => !element.hidden && element.getAttribute("aria-hidden") !== "true",
    );
}

/**
 * Gives a transient dialog/menu a predictable initial focus, keyboard focus
 * containment, Escape handling, and focus restoration to its opener.
 */
export function useFocusContainment({
    active,
    containerRef,
    initialFocusRef,
    restoreFocusRef,
    onEscape,
    escapeDisabled = false,
    trapTab = true,
}: FocusContainmentOptions) {
    const onEscapeRef = useRef(onEscape);
    const escapeDisabledRef = useRef(escapeDisabled);

    useEffect(() => {
        onEscapeRef.current = onEscape;
    }, [onEscape]);

    useEffect(() => {
        escapeDisabledRef.current = escapeDisabled;
    }, [escapeDisabled]);

    useEffect(() => {
        if (!active || typeof document === "undefined") {
            return;
        }

        const container = containerRef.current;
        if (!container) {
            return;
        }

        const activeElement = document.activeElement;
        const opener = restoreFocusRef?.current ?? (
            activeElement instanceof HTMLElement ? activeElement : null
        );

        const requestedInitialFocus = initialFocusRef?.current;
        const focusableElements = getFocusableElements(container);
        const initialFocus = requestedInitialFocus &&
            container.contains(requestedInitialFocus) &&
            !requestedInitialFocus.hasAttribute("disabled")
            ? requestedInitialFocus
            : focusableElements[0] ?? container;

        // A dialog/menu is mounted after its opener's event has focused it, so
        // this also works when the component is rendered through a portal.
        initialFocus.focus();

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                if (!escapeDisabledRef.current) {
                    event.preventDefault();
                    event.stopPropagation();
                    onEscapeRef.current?.();
                }
                return;
            }

            if (!trapTab || event.key !== "Tab") {
                return;
            }

            const currentContainer = containerRef.current;
            if (!currentContainer) {
                return;
            }

            const currentFocusableElements = getFocusableElements(currentContainer);
            if (currentFocusableElements.length === 0) {
                event.preventDefault();
                currentContainer.focus();
                return;
            }

            const currentIndex = currentFocusableElements.indexOf(
                document.activeElement as HTMLElement,
            );

            if (event.shiftKey) {
                if (currentIndex <= 0) {
                    event.preventDefault();
                    currentFocusableElements[currentFocusableElements.length - 1]?.focus();
                }
            } else if (currentIndex === -1 || currentIndex === currentFocusableElements.length - 1) {
                event.preventDefault();
                currentFocusableElements[0]?.focus();
            }
        };

        document.addEventListener("keydown", handleKeyDown);

        return () => {
            document.removeEventListener("keydown", handleKeyDown);

            if (opener && opener.isConnected && opener !== document.body) {
                opener.focus();
            }
        };
    }, [active, containerRef, initialFocusRef, restoreFocusRef, trapTab]);
}
