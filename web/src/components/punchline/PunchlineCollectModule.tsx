"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
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
import { DeliveryConsentStep, useConsentWording } from "../consent/DeliveryConsentStep";
import {
  INITIAL_DELIVERY_CONSENT,
  formatHoldDate,
  isDeliveryConsentComplete,
  recordDeliveryChoice,
  type DeliveryConsentState,
} from "../consent/deliveryConsent";
import { PunchlineCollectibleCard } from "./PunchlineCollectibleCard";
import { MomentShareButton } from "./MomentShareButton";
import { DROP_KIND_LABEL, formatPriceCents } from "./punchlineDropHelpers";
import {
  collectedMomentShareMessage,
  dropShareMessage,
} from "../../lib/collectibleShare";
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

/** The viewer's own edition of a moment, for the tailored after-collect share (#1917). */
export type OwnedEdition = {
  collectibleId: string;
  editionNumber: number;
  pricePaidCents: number;
  held: boolean;
};

export function PunchlineCollectModule({ tracks, onSummary }: PunchlineCollectModuleProps) {
  const {
    token,
    login,
    webAuthnKey,
    status: authStatus,
    userId,
    address: authAddress,
    smartAccountAddress,
  } = useAuth();
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
  // momentId → the viewer's edition, so the share links the pride view and
  // names the edition number (#1917).
  const [ownedEditions, setOwnedEditions] = useState<Map<string, OwnedEdition>>(
    new Map(),
  );
  // The moment collected in this visit: its share is offered prominently.
  const [justCollectedId, setJustCollectedId] = useState<string | null>(null);
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
  // #1776: a paid collect asks how the edition is delivered before any payment starts.
  const [consentTarget, setConsentTarget] = useState<{ drop: PunchlineDrop; moment: PunchlineMoment } | null>(null);
  const [delivery, setDelivery] = useState<DeliveryConsentState>(INITIAL_DELIVERY_CONSENT);
  const deliveryRef = useRef<DeliveryConsentState>(INITIAL_DELIVERY_CONSENT);
  const [consentError, setConsentError] = useState<string | null>(null);
  const { wording, error: wordingError } = useConsentWording(consentTarget !== null);
  const wordingRef = useRef(wording);
  useEffect(() => {
    wordingRef.current = wording;
  }, [wording]);
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
      setOwnedEditions(new Map());
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
          setOwnedEditions(
            new Map(
              mine.items.map((item) => [
                item.moment.id,
                {
                  collectibleId: item.id,
                  editionNumber: item.editionNumber,
                  pricePaidCents: item.pricePaidCents,
                  held: item.delivery?.state === "held" || item.status === "pending",
                },
              ]),
            ),
          );
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
      let session = { token, userId, addresses: [userId, authAddress, smartAccountAddress] };
      if (!key || authStatus !== "authenticated" || !token || !userId) {
        const result = await login();
        key = result?.webAuthnKey;
        session = {
          token: result?.token ?? null,
          userId: result?.userId ?? null,
          addresses: [result?.userId ?? null, result?.smartAccountAddress ?? null],
        };
      }
      if (!key || !session.token || !session.userId) {
        throw new Error(
          "Sign in with your Resonate passkey to collect this moment.",
        );
      }
      // Record the delivery choice before the quote and the payment (#1776).
      const activeWording = wordingRef.current;
      if (!activeWording) {
        throw new Error("The delivery terms have not loaded yet. Try again in a moment.");
      }
      try {
        await recordDeliveryChoice(session.token, activeWording, deliveryRef.current, {
          surface: "punchline_collect",
          subjectId: moment.id,
        });
      } catch {
        throw new Error("We could not record your delivery choice, so nothing was charged. Try again.");
      }
      const quote = await fetchPunchlineMomentQuote(moment.id);
      return payMomentWithX402SmartAccount({
        quote,
        token: session.token,
        buyer: { buyerId: session.userId, buyerAddresses: session.addresses },
        webAuthnKey: key,
        chainId: quote.chainId,
        onStatus: (phase) => setPaidPhase(phase),
      });
    },
    [webAuthnKey, authStatus, login, token, userId, authAddress, smartAccountAddress],
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
        setOwnedEditions((prev) =>
          new Map(prev).set(moment.id, {
            collectibleId: result.collectible.id,
            editionNumber: result.collectible.editionNumber,
            pricePaidCents: result.collectible.pricePaidCents,
            held: result.delivery?.state === "held",
          }),
        );
        setJustCollectedId(moment.id);
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
        if (result.delivery?.state === "held") {
          addToast({
            type: "success",
            title: `Edition #${result.collectible.editionNumber} is reserved for you`,
            message: `“${moment.title}” will be delivered on ${formatHoldDate(result.delivery.availableAt)}, when your 14-day withdrawal period ends.`,
          });
          return;
        }
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
        <Link href="/drops" className="punchline-collect-browse-link">
          Browse all Drops →
        </Link>
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
                    <DropShareAction
                      drop={drop}
                      track={track}
                      collectedCount={effectiveCollectedCount}
                    />
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
                          momentKind={moment.momentKind}
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
                              onCollect={() => {
                                if (moment.priceCents > 0 && token) {
                                  setDelivery(INITIAL_DELIVERY_CONSENT);
                                  deliveryRef.current = INITIAL_DELIVERY_CONSENT;
                                  setConsentError(null);
                                  setConsentTarget({ drop, moment });
                                  return;
                                }
                                void collect(drop, moment);
                              }}
                            />
                            {state === "owned" && (
                              <CollectedShareAction
                                drop={drop}
                                moment={moment}
                                track={track}
                                edition={ownedEditions.get(moment.id) ?? null}
                                editionsLeft={Math.max(0, moment.editionSize - collectedCount)}
                                prominent={justCollectedId === moment.id}
                              />
                            )}
                          </div>
                          {consentTarget?.moment.id === moment.id && collectingId !== moment.id && (
                            <div className="punchline-collect-consent" data-testid="punchline-collect-consent">
                              <DeliveryConsentStep
                                wording={wording}
                                error={wordingError}
                                state={delivery}
                                onChange={(next) => {
                                  setDelivery(next);
                                  deliveryRef.current = next;
                                }}
                              />
                              {consentError && (
                                <p role="alert" className="punchline-collect-consent__error">{consentError}</p>
                              )}
                              <div className="punchline-collect-actions">
                                <button
                                  type="button"
                                  className="punchline-btn-primary"
                                  disabled={!wording || !isDeliveryConsentComplete(delivery)}
                                  onClick={() => {
                                    const target = consentTarget;
                                    setConsentTarget(null);
                                    void collect(target.drop, target.moment);
                                  }}
                                >
                                  {`Pay ${formatPriceCents(moment.priceCents)}`}
                                </button>
                                <button
                                  type="button"
                                  className="punchline-btn-secondary"
                                  onClick={() => setConsentTarget(null)}
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          )}
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
 * The tailored after-collect share (#1917): the moment permalink, upgraded to
 * the edition-pride view when the viewer's edition is known, with paid/free
 * honest copy. Exported for static-markup tests.
 */
export function CollectedShareAction({
  drop,
  moment,
  track,
  edition,
  editionsLeft,
  prominent,
}: {
  drop: Pick<PunchlineDrop, "id">;
  moment: PunchlineMoment;
  track: Pick<Track, "title" | "artist">;
  edition: OwnedEdition | null;
  editionsLeft: number;
  prominent: boolean;
}) {
  const input = {
    lyricText: moment.lyricText,
    artistName: track.artist,
    trackTitle: track.title,
    editionNumber: edition?.editionNumber ?? null,
    editionSize: moment.editionSize,
    // Without the edition record, the moment's price is what was paid.
    pricePaidCents: edition?.pricePaidCents ?? moment.priceCents,
    held: edition?.held ?? false,
    editionsLeft,
  };
  const native = collectedMomentShareMessage(input, "native");
  return (
    <MomentShareButton
      momentId={moment.id}
      dropId={drop.id}
      collectibleId={edition?.collectibleId ?? null}
      context="collect_module"
      trigger="after_collect"
      shareTitle={native.title}
      shareText={native.text}
      xText={collectedMomentShareMessage(input, "x").text}
      className={prominent ? "punchline-btn-primary" : undefined}
      label={
        prominent && edition ? `Share edition №${edition.editionNumber}` : "Share"
      }
    />
  );
}

/**
 * "Share this drop" (#1917): invites people to collect, stating the price or
 * that it is free honestly. Links the drop on its release page. Exported for
 * static-markup tests.
 */
export function DropShareAction({
  drop,
  track,
  collectedCount,
}: {
  drop: Pick<PunchlineDrop, "id" | "title" | "moments">;
  track: Pick<Track, "title" | "artist" | "releaseId">;
  collectedCount: (moment: PunchlineMoment) => number;
}) {
  if (!track.releaseId) return null;
  const input = {
    dropTitle: drop.title,
    trackTitle: track.title,
    artistName: track.artist,
    moments: drop.moments.map((moment) => ({
      priceCents: moment.priceCents,
      editionSize: moment.editionSize,
      collectedCount: collectedCount(moment),
    })),
  };
  const native = dropShareMessage(input, "native");
  return (
    <span className="punchline-collect-actions punchline-drop-share">
      <MomentShareButton
        dropId={drop.id}
        releaseId={track.releaseId}
        context="drop_share"
        trigger="drop_page"
        shareTitle={native.title}
        shareText={native.text}
        xText={dropShareMessage(input, "x").text}
        label="Share this drop"
      />
    </span>
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
