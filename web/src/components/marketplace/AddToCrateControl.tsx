"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useAuth } from "../auth/AuthProvider";
import { useToast } from "../ui/Toast";
import { addCrateItem, listCrates } from "../../lib/api";
import { crateErrorMessage, type CrateListEntry } from "../../lib/crates";

type Props = {
  /** The listing's track. The control is not rendered by callers without one. */
  trackId: string;
  trackTitle?: string;
};

type Position = { top: number; left: number; minWidth: number };

const POPOVER_WIDTH = 260;
const POPOVER_GAP = 6;

function crateLabel(crate: Pick<CrateListEntry, "title">): string {
  return crate.title?.trim() || "Untitled crate";
}

export type AddTrackToCrateResult =
  | { ok: true; title: string; message: string; crateHref: string }
  | { ok: false; message: string };

/**
 * Add a track to one crate and describe the outcome in plain language: the
 * success copy for the toast, or the readable reason it failed (`line_exists`,
 * `crate_full`, `track_not_found` map in `crateErrorMessage`).
 */
export async function addTrackToCrate(
  token: string,
  crate: Pick<CrateListEntry, "id" | "title">,
  trackId: string,
  trackTitle?: string,
): Promise<AddTrackToCrateResult> {
  try {
    await addCrateItem(token, crate.id, trackId);
  } catch (err) {
    return {
      ok: false,
      message: crateErrorMessage(err, "We could not add that track. Please try again."),
    };
  }
  return {
    ok: true,
    title: "Added to crate",
    message: `${trackTitle ? `"${trackTitle}"` : "That track"} is now in ${crateLabel(crate)}.`,
    crateHref: `/crates/${encodeURIComponent(crate.id)}`,
  };
}

/**
 * "Add to crate" for a browsed stem listing (#2032). Signed out it asks to
 * connect; signed in it opens a small popover listing the DJ's crates (fetched
 * on first open) plus a way to start a new crate from the listing's track.
 *
 * The listing card clips its content, so the popover is portalled to the body
 * and positioned from the button. Focus moves into it on open, Tab stays inside,
 * and Escape or a click outside closes it and returns focus to the button.
 */
export function AddToCrateControl({ trackId, trackTitle }: Props) {
  const { token, connectPrivy } = useAuth();
  const { addToast } = useToast();
  const router = useRouter();
  const popoverId = useId();
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<Position | null>(null);
  const [crates, setCrates] = useState<CrateListEntry[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fetchedFor = useRef<string | null>(null);

  const close = useCallback((returnFocus = true) => {
    setOpen(false);
    setError(null);
    if (returnFocus) buttonRef.current?.focus();
  }, []);

  const place = useCallback(() => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(POPOVER_WIDTH, window.innerWidth - 16);
    const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8));
    setPosition({ top: rect.bottom + POPOVER_GAP, left, minWidth: width });
  }, []);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  // Lazy first load of the user's crates (once per token).
  useEffect(() => {
    if (!open || !token || fetchedFor.current === token) return;
    fetchedFor.current = token;
    let cancelled = false;
    setLoadError(null);
    listCrates(token)
      .then((result) => {
        if (!cancelled) setCrates(result?.crates ?? []);
      })
      .catch(() => {
        if (cancelled) return;
        fetchedFor.current = null;
        setLoadError("We could not load your crates.");
      });
    return () => {
      cancelled = true;
    };
  }, [open, token]);

  // Keep the popover attached to the button; close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (popoverRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      close(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        close(true);
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = popoverRef.current?.querySelectorAll<HTMLElement>(
        "button:not([disabled]), a[href]",
      );
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !popoverRef.current?.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !popoverRef.current?.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, close, place]);

  // Move focus into the popover once it is on screen.
  useEffect(() => {
    if (!open || !position) return;
    const first = popoverRef.current?.querySelector<HTMLElement>("button:not([disabled])");
    (first ?? popoverRef.current)?.focus();
    // Only on open: later position updates must not steal focus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, position === null]);

  if (!trackId) return null;

  const onToggle = () => {
    if (!token) {
      void connectPrivy();
      return;
    }
    if (open) close(true);
    else setOpen(true);
  };

  const onChoose = async (crate: CrateListEntry) => {
    if (!token || adding) return;
    setAdding(crate.id);
    setError(null);
    const result = await addTrackToCrate(token, crate, trackId, trackTitle);
    setAdding(null);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setCrates((current) =>
      current
        ? current.map((entry) =>
            entry.id === crate.id ? { ...entry, itemCount: entry.itemCount + 1 } : entry,
          )
        : current,
    );
    addToast({
      type: "success",
      title: result.title,
      message: result.message,
      actionLabel: `Open ${crateLabel(crate)}`,
      onClick: () => router.push(result.crateHref),
    });
    close(true);
  };

  const newCrateHref = `/crates?referenceTrackId=${encodeURIComponent(trackId)}`;

  const popover =
    open && position
      ? createPortal(
          <div
            ref={popoverRef}
            id={popoverId}
            role="dialog"
            aria-label="Add this track to a crate"
            tabIndex={-1}
            className="add-to-crate__popover"
            style={{ top: position.top, left: position.left, width: position.minWidth }}
          >
            <p className="add-to-crate__heading">Add to crate</p>
            {loadError ? (
              <p className="add-to-crate__note" role="alert">
                {loadError}
              </p>
            ) : crates === null ? (
              <p className="add-to-crate__note" role="status">
                Loading your crates…
              </p>
            ) : crates.length === 0 ? (
              <p className="add-to-crate__note">No crates yet.</p>
            ) : (
              <ul className="add-to-crate__list">
                {crates.map((crate) => (
                  <li key={crate.id}>
                    <button
                      type="button"
                      className="add-to-crate__item"
                      disabled={adding !== null}
                      onClick={() => void onChoose(crate)}
                    >
                      <span className="add-to-crate__item-title">{crateLabel(crate)}</span>
                      <span className="add-to-crate__item-meta">
                        {adding === crate.id
                          ? "Adding…"
                          : `${crate.itemCount} ${crate.itemCount === 1 ? "line" : "lines"}`}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {error ? (
              <p className="add-to-crate__error" role="alert">
                {error}
              </p>
            ) : null}
            <button
              type="button"
              className="add-to-crate__new"
              onClick={() => {
                setOpen(false);
                router.push(newCrateHref);
              }}
            >
              New crate from this track
            </button>
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="stem-card__add-to-crate"
        aria-haspopup={token ? "dialog" : undefined}
        aria-expanded={token ? open : undefined}
        aria-controls={token && open ? popoverId : undefined}
        aria-label={trackTitle ? `Add to crate: ${trackTitle}` : undefined}
        onClick={onToggle}
      >
        Add to crate
      </button>
      {popover}
    </>
  );
}
