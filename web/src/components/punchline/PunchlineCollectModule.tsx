"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  collectPunchlineMoment,
  listMyPunchlineCollectibles,
  listTrackPunchlineDrops,
  type PunchlineDrop,
  type PunchlineMoment,
  type Track,
} from "../../lib/api";
import { useAuth } from "../auth/AuthProvider";
import { useToast } from "../ui/Toast";
import { PunchlineCollectibleCard } from "./PunchlineCollectibleCard";
import {
  collectableDrops,
  describeCollectError,
  dropSetProgress,
  formatEditionsRemaining,
  momentCollectState,
  resolveClipUrl,
  type MomentCollectState,
} from "./punchlineCollectHelpers";
import "../../styles/punchline.css";

/**
 * Fan-facing "Collect moments" module (#486), rendered on the release page for
 * every visitor. Published drops surface per track: lyric-first collectible
 * cards with clip preview, live scarcity ("N of M left" / sold out), set
 * progress for signed-in fans, and the Collect CTA.
 *
 * Free moments collect end-to-end (#485). Paid moments render their price with
 * an honest "opens soon" state until the paid rail lands (#1462) — never a
 * dead-looking button. Signed-out visitors get a working "Sign in to collect".
 *
 * The module renders nothing at all when no track has a published drop, so
 * releases without drops pay zero visual cost.
 */

export interface PunchlineCollectModuleProps {
  tracks: Track[];
}

type DropsByTrack = Map<string, PunchlineDrop[]>;

export function PunchlineCollectModule({ tracks }: PunchlineCollectModuleProps) {
  const { token, login } = useAuth();
  const { addToast } = useToast();

  const [dropsByTrack, setDropsByTrack] = useState<DropsByTrack | null>(null);
  const [ownedMomentIds, setOwnedMomentIds] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [collectedCounts, setCollectedCounts] = useState<Map<string, number>>(
    new Map(),
  );
  const [collectingId, setCollectingId] = useState<string | null>(null);
  const [playingMomentId, setPlayingMomentId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Published drops for every track, fetched once in parallel. A failed track
  // fetch degrades to "no drops" rather than breaking the release page.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        tracks.map(async (track) => {
          try {
            const result = await listTrackPunchlineDrops(track.id);
            return [track.id, collectableDrops(result.items)] as const;
          } catch {
            return [track.id, [] as PunchlineDrop[]] as const;
          }
        }),
      );
      if (!cancelled) {
        setDropsByTrack(new Map(entries));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tracks]);

  // Owned moments for the signed-in viewer (drives owned states + set progress).
  useEffect(() => {
    if (!token) {
      setOwnedMomentIds(new Set());
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const mine = await listMyPunchlineCollectibles(token);
        if (!cancelled) {
          setOwnedMomentIds(new Set(mine.items.map((item) => item.moment.id)));
        }
      } catch {
        // Inventory is an enhancement here — the module still works without it.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const stopClip = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      audioRef.current = null;
    }
    setPlayingMomentId(null);
  }, []);

  useEffect(() => () => stopClip(), [stopClip]);

  const playClip = useCallback(
    (moment: PunchlineMoment) => {
      const url = resolveClipUrl(moment.clipAssetUri);
      if (!url) {
        addToast({
          type: "error",
          title: "Preview unavailable",
          message: "This moment's clip isn't ready yet.",
        });
        return;
      }
      stopClip();
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.addEventListener("ended", stopClip);
      audio.addEventListener("error", () => {
        stopClip();
        addToast({
          type: "error",
          title: "Preview unavailable",
          message: "Could not play this moment's clip.",
        });
      });
      audio
        .play()
        .then(() => setPlayingMomentId(moment.id))
        .catch(() => stopClip());
    },
    [addToast, stopClip],
  );

  const effectiveCollectedCount = useCallback(
    (moment: PunchlineMoment) =>
      collectedCounts.get(moment.id) ?? moment.collectedCount,
    [collectedCounts],
  );

  const collect = useCallback(
    async (drop: PunchlineDrop, moment: PunchlineMoment) => {
      if (!token) {
        const result = await login();
        if (!result) {
          return;
        }
        // The owned/inventory effect re-runs off the new token; the fan taps
        // Collect again now that they're signed in.
        return;
      }
      setCollectingId(moment.id);
      try {
        const result = await collectPunchlineMoment(moment.id, token);
        setOwnedMomentIds((prev) => new Set([...prev, moment.id]));
        setCollectedCounts((prev) => {
          const next = new Map(prev);
          next.set(moment.id, effectiveCollectedCount(moment) + 1);
          return next;
        });
        addToast({
          type: "success",
          title: `Edition #${result.collectible.editionNumber} is yours`,
          message: `“${moment.title}” is now in your collection.`,
        });
        if (result.setCompleted) {
          addToast({
            type: "success",
            title: "Set complete! 🎉",
            message: `You collected every moment in ${
              drop.title ? `“${drop.title}”` : "this drop"
            }.`,
          });
        }
      } catch (error) {
        const described = describeCollectError(error);
        if (described.becameState === "owned") {
          setOwnedMomentIds((prev) => new Set([...prev, moment.id]));
        }
        if (described.becameState === "sold_out") {
          setCollectedCounts((prev) => {
            const next = new Map(prev);
            next.set(moment.id, moment.editionSize);
            return next;
          });
        }
        addToast({
          type: "error",
          title: "Not collected",
          message: described.message,
        });
      } finally {
        setCollectingId(null);
      }
    },
    [token, login, addToast, effectiveCollectedCount],
  );

  const tracksWithDrops = useMemo(() => {
    if (!dropsByTrack) {
      return [];
    }
    return tracks
      .map((track) => ({ track, drops: dropsByTrack.get(track.id) ?? [] }))
      .filter((entry) => entry.drops.length > 0);
  }, [tracks, dropsByTrack]);

  // Loading (first fetch) and empty states render nothing — the module only
  // exists on releases that actually have published drops.
  if (tracksWithDrops.length === 0) {
    return null;
  }

  const signedIn = !!token;

  return (
    <section className="punchline-collect-module glass-panel">
      <div className="punchline-collect-header">
        <div>
          <h3>Collect moments</h3>
          <p className="punchline-collect-subtitle">
            Own a piece of the hook — limited-edition vocal moments from this
            release.
          </p>
        </div>
      </div>

      {tracksWithDrops.map(({ track, drops }) => (
        <div key={track.id} className="punchline-collect-track">
          {tracksWithDrops.length > 1 && (
            <h4 className="punchline-collect-track-title">{track.title}</h4>
          )}

          {drops.map((drop) => {
            const progress = dropSetProgress(drop, ownedMomentIds, signedIn);
            return (
              <div key={drop.id} className="punchline-collect-drop">
                <div className="punchline-collect-drop-head">
                  <div>
                    {drop.title && (
                      <h5 className="punchline-collect-drop-title">
                        {drop.title}
                      </h5>
                    )}
                    {drop.description && (
                      <p className="punchline-collect-drop-note">
                        {drop.description}
                      </p>
                    )}
                  </div>
                  {progress && progress.total > 1 && (
                    <span
                      className={`punchline-collect-progress ${
                        progress.complete ? "is-complete" : ""
                      }`}
                    >
                      {progress.complete
                        ? "Set complete 🎉"
                        : `You own ${progress.owned} of ${progress.total}`}
                    </span>
                  )}
                </div>

                <div className="punchline-collect-grid">
                  {drop.moments.map((moment) => {
                    const collectedCount = effectiveCollectedCount(moment);
                    const state = momentCollectState({
                      moment: { ...moment, collectedCount },
                      ownedMomentIds,
                      momentId: moment.id,
                      signedIn,
                    });
                    return (
                      <div key={moment.id} className="punchline-collect-item">
                        <PunchlineCollectibleCard
                          title={moment.title}
                          lyricText={moment.lyricText}
                          artworkUrl={moment.artworkUrl}
                          durationMs={moment.endMs - moment.startMs}
                          editionSize={moment.editionSize}
                          priceCents={moment.priceCents}
                          rightsLabel={moment.rightsLabel}
                        />
                        <div className="punchline-collect-item-footer">
                          <span
                            className={`punchline-collect-remaining ${
                              state === "sold_out" ? "is-sold-out" : ""
                            }`}
                          >
                            {formatEditionsRemaining(
                              moment.editionSize,
                              collectedCount,
                            )}
                          </span>
                          <div className="punchline-collect-actions">
                            <button
                              type="button"
                              className="punchline-btn-secondary punchline-collect-play"
                              onClick={
                                playingMomentId === moment.id
                                  ? stopClip
                                  : () => playClip(moment)
                              }
                              aria-label={
                                playingMomentId === moment.id
                                  ? `Stop preview of ${moment.title}`
                                  : `Preview ${moment.title}`
                              }
                            >
                              {playingMomentId === moment.id ? "■ Stop" : "▶ Play"}
                            </button>
                            <CollectButton
                              state={state}
                              editionNumber={null}
                              busy={collectingId === moment.id}
                              onCollect={() => collect(drop, moment)}
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </section>
  );
}

/**
 * The Collect CTA in each of its five states. Exported for static-markup
 * tests. Disabled states are honest: visible label + title explain why.
 */
export function CollectButton({
  state,
  busy,
  onCollect,
}: {
  state: MomentCollectState;
  editionNumber: number | null;
  busy: boolean;
  onCollect: () => void;
}) {
  switch (state) {
    case "owned":
      return (
        <span className="punchline-collect-owned" role="status">
          ✓ Owned
        </span>
      );
    case "sold_out":
      return (
        <button
          type="button"
          className="punchline-btn-secondary"
          disabled
          aria-disabled="true"
        >
          Sold out
        </button>
      );
    case "paid_pending":
      return (
        <button
          type="button"
          className="punchline-btn-secondary"
          disabled
          aria-disabled="true"
          title="Paid collecting opens soon — free moments can be collected today."
        >
          Coming soon
        </button>
      );
    case "sign_in":
      return (
        <button
          type="button"
          className="punchline-btn-primary"
          onClick={onCollect}
        >
          Sign in to collect
        </button>
      );
    case "collectable":
    default:
      return (
        <button
          type="button"
          className="punchline-btn-primary"
          onClick={onCollect}
          disabled={busy}
          aria-disabled={busy}
        >
          {busy ? "Collecting…" : "Collect free"}
        </button>
      );
  }
}

export default PunchlineCollectModule;
