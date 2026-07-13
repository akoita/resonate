"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  collectPunchlineMoment,
  fetchPunchlineMomentQuote,
  listMyPunchlineCollectibles,
  listMyPunchlineUnlocks,
  listTrackPunchlineDrops,
  type PunchlineCollectResult,
  type PunchlineDrop,
  type PunchlineMoment,
  type PunchlineUnlockReward,
  type Track,
} from "../../lib/api";
import { useAuth } from "../auth/AuthProvider";
import { payMomentWithX402SmartAccount } from "../../lib/x402SmartAccountPay";
import { recordProductAnalytics } from "../../lib/productAnalytics";
import { useToast } from "../ui/Toast";
import { PunchlineCollectibleCard } from "./PunchlineCollectibleCard";
import { MomentShareButton } from "./MomentShareButton";
import { DROP_KIND_LABEL, formatPriceCents } from "./punchlineDropHelpers";
import { momentShareText } from "../../lib/momentShare";
import {
  collectableDrops,
  describeCollectError,
  dropSetProgress,
  formatEditionsRemaining,
  momentCollectState,
  resolveClipUrl,
  summarizeCollectableDrops,
  type MomentCollectState,
  type PunchlineCollectSummary,
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
  /**
   * Reports the release-level drop/moment counts once loaded, so the page can
   * render above-the-fold discovery affordances (hero CTA, overview-strip
   * cell) without duplicating the fetch.
   */
  onSummary?: (summary: PunchlineCollectSummary) => void;
}

type DropsByTrack = Map<string, PunchlineDrop[]>;

export function PunchlineCollectModule({ tracks, onSummary }: PunchlineCollectModuleProps) {
  const { token, login, webAuthnKey, status: authStatus } = useAuth();
  const { addToast } = useToast();

  const [dropsByTrack, setDropsByTrack] = useState<DropsByTrack | null>(null);
  const onSummaryRef = useRef(onSummary);
  useEffect(() => {
    onSummaryRef.current = onSummary;
  }, [onSummary]);
  const tokenRef = useRef(token);
  useEffect(() => {
    tokenRef.current = token;
  }, [token]);
  const [ownedMomentIds, setOwnedMomentIds] = useState<ReadonlySet<string>>(
    new Set(),
  );
  // Granted set rewards by dropId (#488) — drives the bonus reveal.
  const [rewardsByDrop, setRewardsByDrop] = useState<
    Map<string, PunchlineUnlockReward | null>
  >(new Map());
  const [collectedCounts, setCollectedCounts] = useState<Map<string, number>>(
    new Map(),
  );
  const [collectingId, setCollectingId] = useState<string | null>(null);
  // Wallet-checkout phase label for the in-flight paid collect (#1462).
  const [paidPhase, setPaidPhase] = useState<string | null>(null);
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
        const next = new Map(entries);
        setDropsByTrack(next);
        onSummaryRef.current?.(summarizeCollectableDrops(next));
        // Funnel (#489): one drop_viewed per visible drop per page load.
        for (const [trackId, drops] of next) {
          for (const d of drops) {
            void recordProductAnalytics(tokenRef.current, "punchline.drop_viewed", {
              payload: {
                dropId: d.id,
                trackId,
                momentCount: d.moments.length,
                source: "release_page",
              },
            });
          }
        }
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
        const [mine, unlocks] = await Promise.all([
          listMyPunchlineCollectibles(token),
          listMyPunchlineUnlocks(token),
        ]);
        if (!cancelled) {
          setOwnedMomentIds(new Set(mine.items.map((item) => item.moment.id)));
          setRewardsByDrop(
            new Map(unlocks.items.map((g) => [g.drop.id, g.reward])),
          );
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
    (moment: PunchlineMoment, dropId?: string) => {
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
        .then(() => {
          setPlayingMomentId(moment.id);
          void recordProductAnalytics(tokenRef.current, "punchline.preview_played", {
            payload: { dropId: dropId ?? null, momentId: moment.id, source: "release_page" },
          });
        })
        .catch(() => stopClip());
    },
    [addToast, stopClip],
  );

  const playBonus = useCallback(
    (dropId: string) => {
      const reward = rewardsByDrop.get(dropId);
      const url = resolveClipUrl(reward?.clipAssetUri ?? null);
      if (!url) {
        addToast({
          type: "error",
          title: "Bonus unavailable",
          message: "The bonus clip isn't ready yet.",
        });
        return;
      }
      stopClip();
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.addEventListener("ended", stopClip);
      audio.addEventListener("error", stopClip);
      audio
        .play()
        .then(() => setPlayingMomentId(`bonus-${dropId}`))
        .catch(() => stopClip());
    },
    [rewardsByDrop, addToast, stopClip],
  );

  const effectiveCollectedCount = useCallback(
    (moment: PunchlineMoment) =>
      collectedCounts.get(moment.id) ?? moment.collectedCount,
    [collectedCounts],
  );

  // Paid checkout (#1462): fetch the x402 quote, pay from the passkey wallet,
  // then collect through the JWT-guarded verify endpoint. Returns the same
  // collect result shape as the free path so success handling is shared.
  const runPaidCollect = useCallback(
    async (moment: PunchlineMoment): Promise<PunchlineCollectResult> => {
      let key = webAuthnKey;
      if (!key || authStatus !== "authenticated") {
        const result = await login();
        key = result?.webAuthnKey;
      }
      const activeToken = token;
      if (!key || !activeToken) {
        throw new Error(
          "Sign in with your Resonate passkey to collect this moment.",
        );
      }
      const quote = await fetchPunchlineMomentQuote(moment.id);
      return payMomentWithX402SmartAccount({
        quote,
        token: activeToken,
        webAuthnKey: key,
        chainId: quote.chainId,
        onStatus: (phase) => setPaidPhase(phase),
      });
    },
    [webAuthnKey, authStatus, login, token],
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
      setPaidPhase(null);
      void recordProductAnalytics(token, "punchline.collect_started", {
        payload: {
          dropId: drop.id,
          momentId: moment.id,
          trackId: drop.trackId,
          priceCents: moment.priceCents,
          source: "release_page",
        },
      });
      try {
        const result =
          moment.priceCents > 0
            ? await runPaidCollect(moment)
            : await collectPunchlineMoment(moment.id, token);
        setOwnedMomentIds((prev) => new Set([...prev, moment.id]));
        setCollectedCounts((prev) => {
          const next = new Map(prev);
          next.set(moment.id, effectiveCollectedCount(moment) + 1);
          return next;
        });
        void recordProductAnalytics(token, "punchline.collect_completed", {
          payload: {
            dropId: drop.id,
            momentId: moment.id,
            trackId: drop.trackId,
            editionNumber: result.collectible.editionNumber,
            setCompleted: result.setCompleted,
            pricePaidCents: result.collectible.pricePaidCents,
            paymentRail: result.collectible.paymentRail,
            source: "release_page",
          },
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
        if (result.unlock?.newlyGranted) {
          setRewardsByDrop((prev) =>
            new Map(prev).set(drop.id, result.unlock?.reward ?? null),
          );
          addToast({
            type: "success",
            title: "🎁 Bonus unlocked!",
            message:
              "Your set reward is waiting below — and in your Library under Moments.",
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
        setPaidPhase(null);
      }
    },
    [token, login, addToast, effectiveCollectedCount, runPaidCollect],
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
    <section
      id="punchline-collect-module"
      className="punchline-collect-module glass-panel"
    >
      <div className="punchline-collect-header">
        <div>
          <span className="punchline-collect-eyebrow">🎤 Drops</span>
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
                    <span className="punchline-kind-chip">{DROP_KIND_LABEL}</span>
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
                  <div className="punchline-collect-head-chips">
                    {drop.unlock && !rewardsByDrop.has(drop.id) && (
                      <span className="punchline-collect-bonus-chip">
                        🎁 Collect the set to unlock a bonus
                      </span>
                    )}
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
                </div>

                {rewardsByDrop.has(drop.id) && (
                  <PunchlineBonusReveal
                    reward={rewardsByDrop.get(drop.id) ?? null}
                    playing={playingMomentId === `bonus-${drop.id}`}
                    onPlay={() => playBonus(drop.id)}
                    onStop={stopClip}
                  />
                )}

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
                          playing={playingMomentId === moment.id}
                        />
                        <div className="punchline-scarcity">
                          <div
                            className="punchline-scarcity-fill"
                            style={{
                              width: `${Math.min(
                                100,
                                (collectedCount / Math.max(1, moment.editionSize)) * 100,
                              )}%`,
                            }}
                            aria-hidden="true"
                          />
                        </div>
                        <div className="punchline-collect-item-footer">
                          <span
                            className={`punchline-collect-remaining ${
                              state === "sold_out" ? "is-sold-out" : ""
                            } ${
                              state !== "sold_out" &&
                              moment.editionSize - collectedCount <=
                                Math.max(1, Math.floor(moment.editionSize * 0.1))
                                ? "is-low"
                                : ""
                            }`}
                            aria-label={formatEditionsRemaining(
                              moment.editionSize,
                              collectedCount,
                            )}
                          >
                            <span className="punchline-remaining-count">
                              {Math.max(0, moment.editionSize - collectedCount)}
                              <span className="punchline-remaining-total">
                                {" "}/ {moment.editionSize}
                              </span>
                            </span>
                            <span className="punchline-remaining-label">
                              {state === "sold_out" ? "sold out" : "editions left"}
                            </span>
                          </span>
                          <div className="punchline-collect-actions">
                            <button
                              type="button"
                              className="punchline-btn-secondary punchline-collect-play"
                              onClick={
                                playingMomentId === moment.id
                                  ? stopClip
                                  : () => playClip(moment, drop.id)
                              }
                              aria-label={
                                playingMomentId === moment.id
                                  ? `Stop preview of ${moment.title}`
                                  : `Preview ${moment.title}`
                              }
                            >
                              {playingMomentId === moment.id ? "■" : "▶"}
                            </button>
                            <CollectButton
                              state={state}
                              editionNumber={null}
                              priceCents={moment.priceCents}
                              busy={collectingId === moment.id}
                              phase={
                                collectingId === moment.id ? paidPhase : null
                              }
                              onCollect={() => collect(drop, moment)}
                            />
                            {state === "owned" && (
                              <MomentShareButton
                                momentId={moment.id}
                                dropId={drop.id}
                                context="collect_module"
                                shareTitle="A moment I collected on Resonate"
                                shareText={momentShareText({
                                  lyricText: moment.lyricText,
                                })}
                                label="Share"
                              />
                            )}
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

/** Phase → label while a paid x402 collect is in flight (#1462). */
const PAID_PHASE_LABEL: Record<string, string> = {
  signing: "Confirm in wallet…",
  settling: "Verifying payment…",
  downloading: "Finishing…",
};

/**
 * The Collect CTA in each of its states. Exported for static-markup tests.
 * Disabled states are honest: visible label + title explain why. Priced moments
 * collect on the live x402 rail (#1462) — the button shows the price.
 */
export function CollectButton({
  state,
  priceCents,
  busy,
  phase,
  onCollect,
}: {
  state: MomentCollectState;
  editionNumber: number | null;
  priceCents?: number;
  busy: boolean;
  phase?: string | null;
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
    case "collectable_paid":
      return (
        <button
          type="button"
          className="punchline-btn-primary"
          onClick={onCollect}
          disabled={busy}
          aria-disabled={busy}
          title="Buy this edition with your Resonate passkey wallet (USDC)."
        >
          {busy
            ? (phase && PAID_PHASE_LABEL[phase]) || "Collecting…"
            : `Collect · ${formatPriceCents(priceCents ?? 0)}`}
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

/**
 * The unlocked set-bonus reveal (#488): the artist's note + the bonus clip,
 * shown only to collectors who completed the set. Exported for tests.
 */
export function PunchlineBonusReveal({
  reward,
  playing,
  onPlay,
  onStop,
}: {
  reward: PunchlineUnlockReward | null;
  playing: boolean;
  onPlay: () => void;
  onStop: () => void;
}) {
  return (
    <div className="punchline-bonus-reveal" role="status">
      <span className="punchline-bonus-reveal-title">
        🎁 Set bonus unlocked
      </span>
      {reward?.message && (
        <p className="punchline-bonus-reveal-message">“{reward.message}”</p>
      )}
      {reward?.clipAssetUri && (
        <button
          type="button"
          className="punchline-btn-secondary"
          onClick={playing ? onStop : onPlay}
        >
          {playing ? "■ Stop" : "▶ Play bonus clip"}
        </button>
      )}
    </div>
  );
}

export default PunchlineCollectModule;
