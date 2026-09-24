"use client";

import Link from "next/link";
import {
  Children,
  isValidElement,
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

/*
 * Home v3 shelf — the one section chrome every Home rail uses.
 *
 * Header: kicker + title (+ optional one-line description) on the left,
 * meta pill, action link and shelf arrows on the right. Body: a single
 * horizontally scrolling row of tiles with scroll-snap.
 *
 * Honesty contract (no dead buttons): the prev/next group renders with the
 * `hidden` attribute until a client-side measurement proves the row actually
 * overflows, so server markup and short shelves never show inert arrows.
 */

export type ShelfTone = "primary" | "tertiary" | "violet";

type ShelfState = {
  overflow: boolean;
  atStart: boolean;
  atEnd: boolean;
};

const INITIAL_STATE: ShelfState = { overflow: false, atStart: true, atEnd: true };
/** Sub-pixel slack so fractional scroll offsets don't flicker the edge state. */
const EDGE_EPSILON = 2;

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function HomeShelf({
  kicker,
  kickerTone = "violet",
  title,
  description,
  meta,
  action,
  itemWidth = 200,
  children,
  testId,
  railKind,
  className,
}: {
  kicker: string;
  kickerTone?: ShelfTone;
  title: string;
  description?: ReactNode;
  meta?: ReactNode;
  action?: { href: string; label: string };
  itemWidth?: number;
  children: ReactNode;
  testId?: string;
  railKind?: string;
  className?: string;
}) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  // Set once the visitor scrolls the row themselves; until then the shelf
  // stays pinned to its first tile (see the item-signature effect below).
  const interactedRef = useRef(false);
  const [state, setState] = useState<ShelfState>(INITIAL_STATE);

  const measure = useCallback(() => {
    const track = trackRef.current;
    if (!track) return;
    const maxScroll = track.scrollWidth - track.clientWidth;
    const overflow = maxScroll > EDGE_EPSILON;
    const atStart = track.scrollLeft <= EDGE_EPSILON;
    const atEnd = track.scrollLeft >= maxScroll - EDGE_EPSILON;
    setState((prev) =>
      prev.overflow === overflow && prev.atStart === atStart && prev.atEnd === atEnd
        ? prev
        : { overflow, atStart, atEnd },
    );
  }, []);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    measure();
    const markInteracted = () => {
      interactedRef.current = true;
    };
    track.addEventListener("scroll", measure, { passive: true });
    track.addEventListener("pointerdown", markInteracted, { passive: true });
    track.addEventListener("wheel", markInteracted, { passive: true });
    track.addEventListener("keydown", markInteracted);
    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(() => measure());
      observer.observe(track);
    } else {
      window.addEventListener("resize", measure);
    }
    return () => {
      track.removeEventListener("scroll", measure);
      track.removeEventListener("pointerdown", markInteracted);
      track.removeEventListener("wheel", markInteracted);
      track.removeEventListener("keydown", markInteracted);
      if (observer) observer.disconnect();
      else window.removeEventListener("resize", measure);
    };
  }, [measure]);

  // Children can change length (e.g. a genre re-rank) without resizing the
  // track element itself, so re-measure after every render of the items.
  // When the items are replaced (e.g. seed campaigns swapped for live ones),
  // scroll-snap follows the previously snapped tile to its new position, which
  // can leave an untouched shelf opened mid-row. Re-pin it to the first tile.
  const itemSignature = Children.toArray(children)
    .map((child) => (isValidElement(child) ? String(child.key) : ""))
    .join("|");
  useEffect(() => {
    const track = trackRef.current;
    if (track && !interactedRef.current && track.scrollLeft !== 0) {
      track.scrollTo({ left: 0, behavior: "auto" });
    }
    measure();
  }, [itemSignature, measure]);

  const scrollByPage = (direction: -1 | 1) => {
    const track = trackRef.current;
    if (!track) return;
    interactedRef.current = true;
    track.scrollBy({
      left: direction * Math.max(1, Math.round(track.clientWidth * 0.9)),
      behavior: prefersReducedMotion() ? "auto" : "smooth",
    });
  };

  const style = {
    "--shelf-item": `${itemWidth}px`,
    "--shelf-item-phone": `${Math.max(148, Math.round(itemWidth * 0.78))}px`,
  } as CSSProperties;

  return (
    <section
      className={["ng-section", "ng-shelf", className].filter(Boolean).join(" ")}
      data-testid={testId}
      data-rail-kind={railKind}
      style={style}
    >
      <header className="ng-shelf__header">
        <div className="ng-shelf__heading">
          <span className={`ng-kicker ng-kicker--${kickerTone}`}>{kicker}</span>
          <h3 className="ng-section-title">{title}</h3>
          {description ? <p className="ng-shelf__description">{description}</p> : null}
        </div>
        <div className="ng-shelf__aside">
          {meta}
          {action ? (
            <Link href={action.href} className="ng-section-link">
              {action.label}
              <span className="ms-icon" aria-hidden style={{ fontSize: 14 }}>arrow_forward</span>
            </Link>
          ) : null}
          <div className="ng-shelf__navs" hidden={!state.overflow}>
            <button
              type="button"
              className="ng-shelf__nav"
              aria-label={`Scroll ${title} back`}
              onClick={() => scrollByPage(-1)}
              disabled={state.atStart}
            >
              <span className="ms-icon" aria-hidden>chevron_left</span>
            </button>
            <button
              type="button"
              className="ng-shelf__nav"
              aria-label={`Scroll ${title} forward`}
              onClick={() => scrollByPage(1)}
              disabled={state.atEnd}
            >
              <span className="ms-icon" aria-hidden>chevron_right</span>
            </button>
          </div>
        </div>
      </header>
      <div
        ref={trackRef}
        className="ng-shelf__track"
        data-fade-start={state.overflow && !state.atStart ? "" : undefined}
        data-fade-end={state.overflow && !state.atEnd ? "" : undefined}
      >
        {Children.map(children, (child) =>
          child === null || child === undefined || child === false ? null : (
            <div className="ng-shelf__item">{child}</div>
          ),
        )}
      </div>
    </section>
  );
}
