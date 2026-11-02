"use client";

import Link from "next/link";
import {
    useCallback,
    useEffect,
    useId,
    useLayoutEffect,
    useState,
    useSyncExternalStore,
    type RefObject,
} from "react";
import { createPortal } from "react-dom";
import {
    FEATURE_TIPS,
    FEATURE_TIP_SHOW_DELAY_MS,
    closeFeatureTip,
    featureTipModKey,
    getActiveFeatureTip,
    openFeatureTip,
    subscribeFeatureTips,
    turnOffFeatureTips,
    type FeatureTipId,
} from "../../lib/featureTips";

const GAP = 10;
const GUTTER = 16;
const MAX_WIDTH = 320;

function hasFinePointer(): boolean {
    try {
        return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    } catch {
        return false;
    }
}

/**
 * Whether this placement's tip is on screen. The tip opens once `eligible` has held for a
 * short delay, if the shared rules allow it (see `lib/featureTips.ts`), and closes when the
 * spot stops being eligible or unmounts.
 */
export function useFeatureTip(id: FeatureTipId, eligible: boolean) {
    const owner = useId();
    const active = useSyncExternalStore(subscribeFeatureTips, getActiveFeatureTip, () => null);
    const open = active?.owner === owner;
    const somethingOpen = active !== null;

    useEffect(() => {
        if (!eligible || somethingOpen) return;
        if (FEATURE_TIPS[id].needsFinePointer && !hasFinePointer()) return;
        const timer = window.setTimeout(() => {
            if (document.visibilityState === "visible") openFeatureTip(id, owner);
        }, FEATURE_TIP_SHOW_DELAY_MS);
        return () => window.clearTimeout(timer);
    }, [eligible, somethingOpen, id, owner]);

    useEffect(() => {
        if (!eligible) closeFeatureTip(owner);
    }, [eligible, owner]);

    useEffect(() => () => closeFeatureTip(owner), [owner]);

    const dismiss = useCallback(() => closeFeatureTip(owner), [owner]);
    return { open, dismiss, turnOff: turnOffFeatureTips };
}

interface Position {
    top: number;
    left: number;
    width: number;
    arrowLeft: number;
    side: "above" | "below" | "inside";
}

export type FeatureTipPlacement = "above" | "below" | "inside";

/** Where the card goes for this anchor, or null while the anchor is out of view. Exported for tests. */
export function placeFeatureTip(
    anchor: Pick<DOMRect, "top" | "bottom" | "left" | "width">,
    placement: FeatureTipPlacement,
    cardHeight: number,
    viewport: { width: number; height: number },
): Position | null {
    const vw = viewport.width;
    const vh = viewport.height;
    // Out of view: wait (the tip is still remembered as shown, so nothing comes back later).
    if (anchor.bottom < 0 || anchor.top > vh || anchor.width === 0) return null;
    const width = Math.min(MAX_WIDTH, vw - GUTTER * 2);
    const left = Math.min(Math.max(anchor.left, GUTTER), vw - GUTTER - width);
    const arrowTarget = anchor.left + Math.min(32, anchor.width / 2);
    const arrowLeft = Math.min(Math.max(arrowTarget - left, 16), width - 16);
    const above = anchor.top - GAP - cardHeight;
    const below = anchor.bottom + GAP;
    const inside = Math.max(GUTTER, Math.min(anchor.top + GAP, vh - GUTTER - cardHeight));
    if (placement === "inside") return { top: inside, left, width, arrowLeft, side: "inside" };
    // Prefer the requested side; flip when it would leave the viewport.
    let side: Position["side"] = placement;
    if (side === "above" && above < GUTTER) side = "below";
    else if (side === "below" && below + cardHeight > vh - GUTTER && above >= GUTTER) side = "above";
    let top = side === "above" ? above : below;
    // A tall anchor (a whole list) can leave no room either side: sit just inside its top edge.
    if (top + cardHeight > vh - GUTTER) {
        top = inside;
        side = "inside";
    }
    return { top, left, width, arrowLeft, side };
}

export interface FeatureTipProps {
    tipId: FeatureTipId;
    /** The element the tip points at. */
    anchorRef: RefObject<HTMLElement | null>;
    /** The spot is in use and the feature applies (e.g. a list with a few tracks). */
    eligible: boolean;
    /** Beside the anchor, or overlapping its top edge (for a panel with no room around it). */
    placement?: FeatureTipPlacement;
}

/**
 * A small, dismissible pop-up beside a feature that is easy to miss. It never takes focus or
 * blocks the page (a non-modal dialog); Escape closes it while focus is inside.
 */
export function FeatureTip({ tipId, anchorRef, eligible, placement = "above" }: FeatureTipProps) {
    const { open, dismiss, turnOff } = useFeatureTip(tipId, eligible);
    const [card, setCard] = useState<HTMLDivElement | null>(null);
    const [position, setPosition] = useState<Position | null>(null);
    const titleId = useId();
    const tip = FEATURE_TIPS[tipId];
    const modKey = typeof navigator === "undefined" ? "Ctrl" : featureTipModKey(navigator.platform);

    useLayoutEffect(() => {
        if (!open) return;
        let frame = 0;
        const update = () => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(() => {
                const anchor = anchorRef.current;
                if (!anchor) return;
                setPosition(
                    placeFeatureTip(anchor.getBoundingClientRect(), placement, card?.offsetHeight ?? 150, {
                        width: window.innerWidth,
                        height: window.innerHeight,
                    }),
                );
            });
        };
        update();
        window.addEventListener("resize", update, { passive: true });
        window.addEventListener("scroll", update, { passive: true, capture: true });
        return () => {
            cancelAnimationFrame(frame);
            window.removeEventListener("resize", update);
            window.removeEventListener("scroll", update, { capture: true });
        };
    }, [open, anchorRef, placement, card]);

    if (!open || typeof document === "undefined") return null;

    return createPortal(
        <div
            ref={setCard}
            className={`feature-tip feature-tip--${position?.side ?? placement}`}
            role="dialog"
            aria-modal="false"
            aria-labelledby={titleId}
            data-tip={tipId}
            style={
                position
                    ? { top: position.top, left: position.left, width: position.width }
                    : { visibility: "hidden", top: 0, left: 0, width: MAX_WIDTH }
            }
            onKeyDown={(event) => {
                if (event.key === "Escape") {
                    event.stopPropagation();
                    dismiss();
                }
            }}
        >
            <span
                className="feature-tip__arrow"
                aria-hidden="true"
                style={position ? { left: position.arrowLeft } : undefined}
            />
            <div className="feature-tip__head">
                <span className="feature-tip__badge" aria-hidden="true">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.2 1 2V17h6v-.3c0-.8.4-1.5 1-2A7 7 0 0 0 12 2z" />
                    </svg>
                </span>
                <span className="feature-tip__kicker">Tip</span>
                <button type="button" className="feature-tip__close" onClick={dismiss} aria-label="Close tip">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                </button>
            </div>
            <strong id={titleId} className="feature-tip__title">{tip.title}</strong>
            <p className="feature-tip__body">{tip.body({ modKey, touch: !hasFinePointer() })}</p>
            <div className="feature-tip__actions">
                <button type="button" className="feature-tip__primary" onClick={dismiss}>
                    Got it
                </button>
                <Link className="feature-tip__link" href={tip.learnMore.href} onClick={dismiss}>
                    Learn more
                </Link>
                <button type="button" className="feature-tip__off" onClick={turnOff}>
                    Turn off tips
                </button>
            </div>
        </div>,
        document.body,
    );
}
