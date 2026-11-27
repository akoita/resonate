"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { useAuth } from "../auth/AuthProvider";
import { getPublicPlaylistAPI, getRecentListening, getRelease, type RecentPlayItem } from "../../lib/api";
import { catalogArtistPlaybackTracks } from "../../lib/catalogArtistPlayback";
import { resolveCardQueueTracks } from "../../lib/cardQueue";
import {
  formatRecentAge,
  JUMP_BACK_IN_LIMIT,
  mergeJumpBackIn,
  type JumpBackInIcon,
  type JumpBackInItem,
  type JumpBackInPlay,
} from "../../lib/jumpBackIn";
import type { LocalTrack } from "../../lib/localLibrary";
import { usePlayer } from "../../lib/playerContext";
import { publicPlaylistTrackToLocal } from "../../lib/publicPlaylistTracks";
import {
  clearRecent,
  readRecentClearedAt,
  readRecentViews,
  RECENT_VIEWS_CHANGED_EVENT,
  type RecentView,
} from "../../lib/recentViews";
import { queueableTracks } from "../library/trackAvailability";
import { AiDisclosureBadge } from "../content/AiDisclosureBadge";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { useToast } from "../ui/Toast";
import { HomeShelf } from "./HomeShelf";

/*
 * Home's "Jump back in" (#2735): what the signed-in listener played or opened
 * lately, newest first, right after the hero and before the catalog.
 *
 * Compact two-row tray (cover, title, type, when) so the catalog stays close
 * to the top of Home. Plays come from the listener's own consented play
 * history; opened pages from this browser only (`recentViews`). The row is
 * absent for signed-out visitors and for listeners with no history yet.
 */

const JUMP_ITEM_WIDTH = 280;

type PlaysState = { status: "loading" } | { status: "ready"; items: RecentPlayItem[] } | { status: "error" };

async function resolvePlay(play: JumpBackInPlay, token: string | null): Promise<{
  tracks: LocalTrack[];
  startIndex: number;
  options?: { playlistId: string; publicPlaylist: boolean };
}> {
  const startAt = (tracks: LocalTrack[], trackId?: string) =>
    Math.max(0, trackId ? tracks.findIndex((track) => track.id === trackId) : 0);
  if (play.kind === "release") {
    const tracks = catalogArtistPlaybackTracks([await getRelease(play.releaseId)]);
    return { tracks, startIndex: startAt(tracks, play.resumeTrackId) };
  }
  if (play.kind === "playlist") {
    const playlist = await getPublicPlaylistAPI(play.playlistId, token ?? undefined);
    const tracks = queueableTracks(playlist?.tracks ?? []).map(publicPlaylistTrackToLocal);
    return {
      tracks,
      startIndex: startAt(tracks, play.resumeTrackId),
      options: { playlistId: play.playlistId, publicPlaylist: !play.isOwner },
    };
  }
  const tracks = await resolveCardQueueTracks({
    kind: "artistRef",
    title: play.name,
    artistId: play.artistId,
    name: play.name,
  });
  return { tracks, startIndex: 0 };
}

export function JumpBackInSkeleton() {
  return (
    <section
      className="ng-section ng-shelf ng-shelf--skeleton ng-jump"
      aria-hidden
      style={{ "--shelf-item": `${JUMP_ITEM_WIDTH}px`, "--shelf-item-phone": "240px" } as CSSProperties}
    >
      <header className="ng-shelf__header">
        <div className="ng-shelf__heading">
          <span className="ng-kicker ng-kicker--primary">Pick up where you left off</span>
          <h3 className="ng-section-title">Jump back in</h3>
        </div>
      </header>
      <div className="ng-shelf__track">
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="ng-shelf__item">
            <div className="ng-jump-card ng-jump-card--skeleton">
              <span className="ng-jump-card__art" />
              <span className="ng-jump-card__text">
                <span className="ng-jump-card__title">&nbsp;</span>
                <span className="ng-jump-card__meta">&nbsp;</span>
              </span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/** Literal ligature names, so the icon font subset guard can see each one. */
function KindIcon({ icon }: { icon: JumpBackInIcon }) {
  switch (icon) {
    case "album":
      return <span className="ms-icon" aria-hidden>album</span>;
    case "tune":
      return <span className="ms-icon" aria-hidden>tune</span>;
    case "mic":
      return <span className="ms-icon" aria-hidden>mic</span>;
    case "queue_music":
      return <span className="ms-icon" aria-hidden>queue_music</span>;
    case "rocket_launch":
      return <span className="ms-icon" aria-hidden>rocket_launch</span>;
    case "graphic_eq":
      return <span className="ms-icon" aria-hidden>graphic_eq</span>;
    case "library_music":
      return <span className="ms-icon" aria-hidden>library_music</span>;
  }
}

function JumpBackInArt({ item }: { item: JumpBackInItem }) {
  if (item.covers.length >= 4 && item.kind === "playlist") {
    return (
      <span className="ng-jump-card__mosaic">
        {item.covers.slice(0, 4).map((url, index) => (
          // eslint-disable-next-line @next/next/no-img-element -- catalog covers come from many hosts
          <img key={`${url}-${index}`} src={url} alt="" loading="lazy" decoding="async" />
        ))}
      </span>
    );
  }
  if (item.covers[0]) {
    // eslint-disable-next-line @next/next/no-img-element -- catalog covers come from many hosts
    return <img src={item.covers[0]} alt="" loading="lazy" decoding="async" />;
  }
  return (
    <span className="ng-jump-card__monogram" aria-hidden>
      <KindIcon icon={item.icon} />
    </span>
  );
}

export function JumpBackInCard({
  item,
  now,
  busy,
  onPlay,
}: {
  item: JumpBackInItem;
  now: number;
  busy: boolean;
  onPlay?: (item: JumpBackInItem) => void;
}) {
  const resumable = item.last === "played" && item.play && "resumeTrackId" in item.play && item.play.resumeTrackId;
  const verb = item.last === "played" ? "Played" : "Opened";
  const playLabel = `${resumable ? "Resume" : "Play"} ${item.title}`;
  return (
    <article className={`ng-jump-card ng-jump-card--${item.kind}`} data-testid="jump-back-in-card">
      <Link href={item.href} className="ng-jump-card__link" aria-label={`Open ${item.title}, ${item.badge}`}>
        <span className={`ng-jump-card__art${item.kind === "artist" ? " ng-jump-card__art--round" : ""}`}>
          <JumpBackInArt item={item} />
        </span>
        <span className="ng-jump-card__text">
          <span className="ng-jump-card__title">{item.title}</span>
          <span className="ng-jump-card__meta">
            <span className="ng-jump-card__type">
              <KindIcon icon={item.icon} />
              {item.badge}
            </span>
            {item.subtitle ? <span className="ng-jump-card__subtitle">{item.subtitle}</span> : null}
          </span>
          <span className="ng-jump-card__age">
            {verb} {formatRecentAge(item.at, now)}
            {item.aiDisclosure ? (
              <AiDisclosureBadge disclosure={item.aiDisclosure} aiOnly compact className="ng-jump-card__ai" />
            ) : null}
          </span>
        </span>
      </Link>
      {item.play && onPlay ? (
        <button
          type="button"
          className="ng-jump-card__play"
          aria-label={playLabel}
          title={resumable ? "Resume where you left off" : "Play"}
          onClick={() => onPlay(item)}
          disabled={busy}
        >
          <span className="ms-icon" data-fill="1" aria-hidden>
            {busy ? "hourglass_top" : "play_arrow"}
          </span>
        </button>
      ) : null}
    </article>
  );
}

export function JumpBackIn() {
  const { status, sessionChecked, token, userId } = useAuth();
  const { playQueue } = usePlayer();
  const { addToast } = useToast();
  const signedIn = status === "authenticated" && Boolean(token) && Boolean(userId);
  const [plays, setPlays] = useState<PlaysState>({ status: "loading" });
  const [views, setViews] = useState<RecentView[]>([]);
  const [clearedAt, setClearedAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    if (!sessionChecked || !signedIn || !token) return;
    let cancelled = false;
    getRecentListening(token, { limit: JUMP_BACK_IN_LIMIT })
      .then((recent) => {
        if (!cancelled) setPlays({ status: "ready", items: recent.items });
      })
      .catch(() => {
        // Views alone still fill the row; a failed read is not worth an error card on Home.
        if (!cancelled) setPlays({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [sessionChecked, signedIn, token]);

  const refreshLocal = useCallback(() => {
    setViews(readRecentViews(userId));
    setClearedAt(readRecentClearedAt(userId));
    setNow(Date.now());
  }, [userId]);

  useEffect(() => {
    if (!signedIn) return;
    refreshLocal();
    const onStorage = (event: StorageEvent) => {
      if (!event.key || event.key.startsWith("resonate.recentViews")) refreshLocal();
    };
    window.addEventListener(RECENT_VIEWS_CHANGED_EVENT, refreshLocal);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(RECENT_VIEWS_CHANGED_EVENT, refreshLocal);
      window.removeEventListener("storage", onStorage);
    };
  }, [signedIn, refreshLocal]);

  const handlePlay = useCallback(
    async (item: JumpBackInItem) => {
      if (!item.play) return;
      setBusyKey(item.key);
      try {
        const { tracks, startIndex, options } = await resolvePlay(item.play, token);
        if (tracks.length === 0) {
          addToast({ type: "info", title: "Nothing to play", message: `${item.title} has no playable tracks right now.` });
          return;
        }
        await playQueue(tracks, startIndex, options);
      } catch {
        addToast({ type: "error", title: "Couldn't start playback", message: `Try opening ${item.title} instead.` });
      } finally {
        setBusyKey(null);
      }
    },
    [addToast, playQueue, token],
  );

  if (!signedIn) {
    // Before the session is restored, a stored session keeps the row's space
    // so a returning listener's Home does not jump (CSS: html[data-session]).
    return sessionChecked ? null : (
      <div className="ng-jump-pending">
        <JumpBackInSkeleton />
      </div>
    );
  }
  if (plays.status === "loading") return <JumpBackInSkeleton />;

  const items = mergeJumpBackIn(plays.status === "ready" ? plays.items : [], views, { clearedAt });
  if (items.length === 0) return null;

  return (
    <>
      <HomeShelf
        kicker="Pick up where you left off"
        kickerTone="primary"
        title="Jump back in"
        itemWidth={JUMP_ITEM_WIDTH}
        testId="jump-back-in"
        className="ng-jump"
        meta={
          <button type="button" className="ng-jump__clear" onClick={() => setConfirmClear(true)}>
            Clear
          </button>
        }
        action={{ href: "/listening", label: "Your listening" }}
      >
        {items.map((item) => (
          <JumpBackInCard
            key={item.key}
            item={item}
            now={now}
            busy={busyKey === item.key}
            onPlay={handlePlay}
          />
        ))}
      </HomeShelf>
      <ConfirmDialog
        isOpen={confirmClear}
        title="Clear Jump back in?"
        message="This empties the row on this device. Your play history and Your listening stay as they are; to forget plays everywhere, reset taste memory in Settings."
        confirmLabel="Clear"
        onConfirm={async () => {
          clearRecent(userId);
          setConfirmClear(false);
        }}
        onCancel={() => setConfirmClear(false)}
      />
    </>
  );
}
