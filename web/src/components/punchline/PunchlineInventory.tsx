"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type {
  PunchlineCollectibleItem,
  PunchlineUnlockGrantItem,
} from "../../lib/api";
import { PunchlineCollectibleCard } from "./PunchlineCollectibleCard";
import { resolveClipUrl } from "./punchlineCollectHelpers";
import "../../styles/punchline.css";

/**
 * Collector inventory (#487) — the "Moments" tab in the Library.
 *
 * Presentation-only: the Library page owns the fetch (like the stems tab) and
 * passes the caller-scoped items down. Owned moments group by drop with set
 * progress ("you own N of M" / "Set complete"), each rendered as the same
 * collectible card fans collected from, plus edition number, acquisition date,
 * clip playback, and a link back to the release.
 */

export interface PunchlineInventoryProps {
  items: PunchlineCollectibleItem[];
  /** Granted set rewards (#488), revealed for completed drops. */
  unlocks?: PunchlineUnlockGrantItem[];
  loading: boolean;
  signedIn: boolean;
}

export type InventoryDropGroup = {
  dropId: string;
  dropTitle: string | null;
  trackTitle: string | null;
  releaseId: string | null;
  artistName: string | null;
  /** Total moments in the drop (set size). */
  momentCount: number;
  items: PunchlineCollectibleItem[];
  complete: boolean;
};

/** Group owned items by drop, newest acquisition first, set progress attached. */
export function groupCollectiblesByDrop(
  items: PunchlineCollectibleItem[],
): InventoryDropGroup[] {
  const groups = new Map<string, InventoryDropGroup>();
  for (const item of items) {
    let group = groups.get(item.drop.id);
    if (!group) {
      group = {
        dropId: item.drop.id,
        dropTitle: item.drop.title,
        trackTitle: item.drop.trackTitle,
        releaseId: item.drop.releaseId,
        artistName: item.drop.artistName,
        momentCount: item.drop.momentCount,
        items: [],
        complete: false,
      };
      groups.set(item.drop.id, group);
    }
    group.items.push(item);
  }
  for (const group of groups.values()) {
    group.complete =
      group.momentCount > 0 && group.items.length >= group.momentCount;
  }
  return [...groups.values()];
}

/** "Acquired Jul 11, 2026" — acquisition line under a card. */
export function formatAcquiredAt(acquiredAt: string | null): string | null {
  if (!acquiredAt) {
    return null;
  }
  const date = new Date(acquiredAt);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return `Acquired ${date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  })}`;
}

export function PunchlineInventory({
  items,
  unlocks,
  loading,
  signedIn,
}: PunchlineInventoryProps) {
  const [playingId, setPlayingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playError, setPlayError] = useState<string | null>(null);

  const stopClip = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      audioRef.current = null;
    }
    setPlayingId(null);
  }, []);

  useEffect(() => () => stopClip(), [stopClip]);

  const playBonusClip = useCallback(
    (dropId: string, clipAssetUri: string) => {
      const url = resolveClipUrl(clipAssetUri);
      if (!url) {
        setPlayError("The bonus clip isn't available right now.");
        return;
      }
      stopClip();
      setPlayError(null);
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.addEventListener("ended", stopClip);
      audio.addEventListener("error", () => {
        stopClip();
        setPlayError("Could not play the bonus clip.");
      });
      audio
        .play()
        .then(() => setPlayingId(`bonus-${dropId}`))
        .catch(() => stopClip());
    },
    [stopClip],
  );

  const playClip = useCallback(
    (item: PunchlineCollectibleItem) => {
      const url = resolveClipUrl(item.moment.clipAssetUri);
      if (!url) {
        setPlayError("This moment's clip isn't available right now.");
        return;
      }
      stopClip();
      setPlayError(null);
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.addEventListener("ended", stopClip);
      audio.addEventListener("error", () => {
        stopClip();
        setPlayError("Could not play this moment's clip.");
      });
      audio
        .play()
        .then(() => setPlayingId(item.id))
        .catch(() => stopClip());
    },
    [stopClip],
  );

  if (!signedIn) {
    return (
      <div className="punchline-inventory-empty">
        <span className="punchline-inventory-empty-icon" aria-hidden="true">
          🎤
        </span>
        <h4>Your moments live here</h4>
        <p>
          Sign in to see the Punchline moments you have collected — limited
          vocal moments from the artists you love.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="punchline-inventory-empty" role="status">
        <p>Loading your moments…</p>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="punchline-inventory-empty">
        <span className="punchline-inventory-empty-icon" aria-hidden="true">
          🎤
        </span>
        <h4>No moments yet</h4>
        <p>
          When a release has collectible Punchline moments, you&apos;ll find a
          “Collect moments” section on its page — free moments are one tap away.
        </p>
        <Link href="/catalog" className="punchline-btn-primary">
          Browse the catalog
        </Link>
      </div>
    );
  }

  const groups = groupCollectiblesByDrop(items);
  const rewardByDrop = new Map(
    (unlocks ?? []).map((g) => [g.drop.id, g.reward]),
  );

  return (
    <div className="punchline-inventory">
      {playError && (
        <p className="punchline-error" role="alert">
          {playError}
        </p>
      )}
      {groups.map((group) => (
        <div key={group.dropId} className="punchline-collect-drop">
          <div className="punchline-collect-drop-head">
            <div>
              <h5 className="punchline-collect-drop-title">
                {group.dropTitle ?? group.trackTitle ?? "Punchline Drop"}
              </h5>
              <p className="punchline-collect-drop-note">
                {[group.artistName, group.trackTitle]
                  .filter(Boolean)
                  .join(" · ")}
                {group.releaseId && (
                  <>
                    {" · "}
                    <Link
                      href={`/release/${group.releaseId}`}
                      className="punchline-inventory-release-link"
                    >
                      Open release
                    </Link>
                  </>
                )}
              </p>
            </div>
            <span
              className={`punchline-collect-progress ${
                group.complete ? "is-complete" : ""
              }`}
            >
              {group.complete
                ? "Set complete 🎉"
                : `You own ${group.items.length} of ${group.momentCount}`}
            </span>
          </div>

          {rewardByDrop.has(group.dropId) && (
            <div className="punchline-bonus-reveal" role="status">
              <span className="punchline-bonus-reveal-title">
                🎁 Set bonus unlocked
              </span>
              {rewardByDrop.get(group.dropId)?.message && (
                <p className="punchline-bonus-reveal-message">
                  “{rewardByDrop.get(group.dropId)!.message}”
                </p>
              )}
              {rewardByDrop.get(group.dropId)?.clipAssetUri && (
                <button
                  type="button"
                  className="punchline-btn-secondary punchline-collect-play"
                  onClick={
                    playingId === `bonus-${group.dropId}`
                      ? stopClip
                      : () => playBonusClip(group.dropId, rewardByDrop.get(group.dropId)!.clipAssetUri!)
                  }
                >
                  {playingId === `bonus-${group.dropId}` ? "■ Stop" : "▶ Play bonus clip"}
                </button>
              )}
            </div>
          )}

          <div className="punchline-collect-grid">
            {group.items.map((item) => (
              <div key={item.id} className="punchline-collect-item">
                <PunchlineCollectibleCard
                  title={item.moment.title}
                  lyricText={item.moment.lyricText}
                  artworkUrl={item.moment.artworkUrl}
                  durationMs={item.moment.endMs - item.moment.startMs}
                  editionSize={item.editionSize}
                  priceCents={item.pricePaidCents}
                  rightsLabel={item.moment.rightsLabel}
                />
                <div className="punchline-collect-item-footer">
                  <div className="punchline-inventory-meta">
                    <span className="punchline-inventory-edition">
                      Edition #{item.editionNumber} of {item.editionSize}
                    </span>
                    {formatAcquiredAt(item.acquiredAt) && (
                      <span className="punchline-inventory-acquired">
                        {formatAcquiredAt(item.acquiredAt)}
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    className="punchline-btn-secondary punchline-collect-play"
                    onClick={
                      playingId === item.id ? stopClip : () => playClip(item)
                    }
                    aria-label={
                      playingId === item.id
                        ? `Stop ${item.moment.title}`
                        : `Play ${item.moment.title}`
                    }
                  >
                    {playingId === item.id ? "■ Stop" : "▶ Play"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export default PunchlineInventory;
