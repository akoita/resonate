"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Switch } from "../ui/Switch";
import { useToast } from "../ui/Toast";
import { setPlaylistVisibility, type PlaylistVisibility } from "../../lib/playlistStore";
import { recordProductAnalyticsFromBrowser } from "../../lib/productAnalytics";

interface PlaylistShareControlProps {
  playlistId: string;
  visibility: PlaylistVisibility;
  /** True when the playlist only lives on this device and cannot be shared yet. */
  localOnly?: boolean;
  onVisibilityChange?: (visibility: PlaylistVisibility) => void;
}

/**
 * Owner control for sharing a playlist: a Share button that opens a popover with
 * a public/private toggle and a copyable link. Private by default; flipping to
 * public reveals the shareable URL.
 */
export function PlaylistShareControl({
  playlistId,
  visibility,
  localOnly = false,
  onVisibilityChange,
}: PlaylistShareControlProps) {
  const { addToast } = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const isPublic = visibility === "public";
  const shareUrl =
    typeof window !== "undefined" ? `${window.location.origin}/playlist/${playlistId}` : "";

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const handleToggle = useCallback(
    async (next: boolean) => {
      if (busy || localOnly) return;
      const nextVisibility: PlaylistVisibility = next ? "public" : "private";
      setBusy(true);
      try {
        const updated = await setPlaylistVisibility(playlistId, nextVisibility);
        const applied = updated?.visibility ?? nextVisibility;
        onVisibilityChange?.(applied);
        addToast({
          type: "success",
          title: applied === "public" ? "Playlist is public" : "Playlist is private",
          message:
            applied === "public"
              ? "Anyone with the link can now listen and save it."
              : "Only you can see this playlist now.",
        });
      } catch {
        addToast({ type: "error", title: "Couldn't update", message: "Please try again." });
      } finally {
        setBusy(false);
      }
    },
    [addToast, busy, localOnly, onVisibilityChange, playlistId]
  );

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      addToast({ type: "success", title: "Link copied", message: "Share it anywhere." });
      recordProductAnalyticsFromBrowser("playlist.shared", {
        source: "playlist_share_control",
        subjectType: "playlist",
        subjectId: playlistId,
        payload: { playlistId, channel: "copy_link" },
      });
    } catch {
      addToast({ type: "error", title: "Couldn't copy", message: "Copy the link manually." });
    }
  }, [addToast, playlistId, shareUrl]);

  return (
    <div className="pl-share" ref={containerRef}>
      <button
        type="button"
        className={`ui-btn ui-btn-ghost pl-share-trigger${isPublic ? " is-public" : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <ShareIcon />
        <span>{isPublic ? "Public" : "Share"}</span>
      </button>

      {open && (
        <div className="pl-share-popover glass-panel" role="dialog" aria-label="Share playlist">
          <div className="pl-share-row">
            <div className="pl-share-row-text">
              <div className="pl-share-row-title">Public playlist</div>
              <div className="pl-share-row-sub">
                {localOnly
                  ? "Save this playlist to your account to share it."
                  : "Let anyone listen and add it to their library."}
              </div>
            </div>
            <Switch
              checked={isPublic}
              onChange={handleToggle}
              disabled={busy || localOnly}
              label="Make playlist public"
            />
          </div>

          {isPublic && !localOnly && (
            <>
              <div className="pl-share-link">
                <input className="pl-share-link-input" readOnly value={shareUrl} aria-label="Share link" />
                <button type="button" className="ui-btn ui-btn-primary pl-share-copy" onClick={handleCopy}>
                  Copy
                </button>
              </div>
              <div className="pl-share-hint">
                <InfoIcon />
                <span>Tracks from your device that aren’t in the catalog can’t be played by others.</span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ShareIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  );
}
