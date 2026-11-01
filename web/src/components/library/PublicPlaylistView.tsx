"use client";

import { useCallback, useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "../ui/Button";
import { useToast } from "../ui/Toast";
import { usePlayer } from "../../lib/playerContext";
import { useQueueActions } from "../../lib/useQueueActions";
import { QueueActionsButton } from "../player/QueueActionsButton";
import { ContextMenu } from "../ui/ContextMenu";
import { PlayIcon } from "../ui/MenuIcons";
import { PlaylistHero, PlaylistMetaDot, PlaylistTrackRow, RowMenuButton, menuPositionFor } from "./PlaylistLayout";
import { useAuth } from "../auth/AuthProvider";
import { formatDuration } from "../../lib/metadataExtractor";
import { recordProductAnalyticsFromBrowser } from "../../lib/productAnalytics";
import {
  API_BASE,
  getPublicPlaylistAPI,
  savePlaylistAPI,
  removeSavedPlaylistAPI,
  listSavedPlaylistsAPI,
  type PublicPlaylistView as PublicPlaylist,
  type PublicPlaylistTrack,
} from "../../lib/api";
import { publicPlaylistTrackToLocal as toLocalTrack } from "../../lib/publicPlaylistTracks";
import {
  TrackUnavailableNote,
  isPlayableEntry,
  queueableTracks,
  resolveAvailability,
} from "./trackAvailability";

interface PublicPlaylistViewProps {
  playlistId: string;
}

/**
 * One row of a public playlist (#1793).
 *
 * Presentational on purpose: it takes everything it needs, so the rule it
 * enforces — an entry that cannot be streamed still gets a row, says why in
 * words, and is genuinely inert rather than merely dimmed — can be asserted
 * without a browser.
 */
export function PublicPlaylistTrackRow({
  track,
  index,
  isCurrent,
  onPlay,
  actions,
  onContextMenu,
}: {
  track: PublicPlaylistTrack;
  index: number;
  isCurrent: boolean;
  onPlay: () => void;
  actions?: ReactNode;
  /** Right-click: the same menu as the row's "⋯" button. */
  onContextMenu?: (event: ReactMouseEvent<HTMLDivElement>) => void;
}) {
  const availability = resolveAvailability(track);
  const playable = availability.playable;
  const artUrl = track.artworkPath ? `${API_BASE}${track.artworkPath}` : null;

  return (
    <PlaylistTrackRow
      index={index}
      title={track.title}
      meta={
        <>
          {track.artist || "Unknown Artist"}
          {track.album && ` • ${track.album}`}
          <TrackUnavailableNote availability={availability} />
        </>
      }
      duration={track.duration}
      artUrl={artUrl}
      isCurrent={isCurrent}
      playable={playable}
      menu={playable ? actions : null}
      onClick={playable ? onPlay : undefined}
      onContextMenu={onContextMenu}
      role={playable ? "button" : undefined}
      aria-disabled={playable ? undefined : true}
      tabIndex={playable ? 0 : undefined}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (playable && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onPlay();
        }
      }}
      tooltip={playable ? "Play" : availability.reason ?? "Not available to stream"}
    />
  );
}

export function PublicPlaylistView({ playlistId }: PublicPlaylistViewProps) {
  const router = useRouter();
  const { token } = useAuth();
  const { addToast } = useToast();
  const { playQueue, currentTrack } = usePlayer();
  const queueActions = useQueueActions();

  const [playlist, setPlaylist] = useState<PublicPlaylist | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedPlaylistId, setSavedPlaylistId] = useState<string | null>(null);
  /** The open row menu: from the "⋯" button (with its element) or a right-click. */
  const [rowMenu, setRowMenu] = useState<{ x: number; y: number; index: number; opener: HTMLElement | null } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setNotFound(false);
    try {
      const result = await getPublicPlaylistAPI(playlistId, token ?? undefined);
      setPlaylist(result);
      // Resolve the saved-record id so it can be removed without a page reload.
      if (token && result.isSaved && !result.isOwner) {
        const saved = await listSavedPlaylistsAPI(token).catch(() => []);
        setSavedPlaylistId(saved.find((s) => s.id === playlistId)?.savedPlaylistId ?? null);
      } else {
        setSavedPlaylistId(null);
      }
    } catch {
      setNotFound(true);
      setPlaylist(null);
    } finally {
      setLoading(false);
    }
  }, [playlistId, token]);

  useEffect(() => {
    void load();
  }, [load]);

  // Only the queue is filtered. The rendered list below keeps every entry —
  // an unavailable track a listener saved must not quietly disappear (#1793).
  const playableTracks = useMemo(
    () => queueableTracks(playlist?.tracks ?? []).map(toLocalTrack),
    [playlist]
  );

  const handlePlayAll = useCallback(() => {
    if (playableTracks.length === 0) return;
    void playQueue(playableTracks, 0, { playlistId, publicPlaylist: true, sourceTrackIds: playlist?.tracks.map(t => t.id) });
    recordProductAnalyticsFromBrowser("playlist.played", {
      source: "public_playlist_view",
      subjectType: "playlist",
      subjectId: playlistId,
      payload: { playlistId, trackCount: playableTracks.length },
    });
  }, [playableTracks, playQueue, playlistId, playlist]);

  const handlePlayTrack = useCallback(
    (track: PublicPlaylistTrack) => {
      if (!isPlayableEntry(track)) return;
      const index = playableTracks.findIndex((t) => t.id === track.id);
      void playQueue(playableTracks, index >= 0 ? index : 0, { playlistId, publicPlaylist: true, sourceTrackIds: playlist?.tracks.map(t => t.id) });
    },
    [playableTracks, playQueue, playlistId, playlist]
  );

  const handleCopyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      addToast({ type: "success", title: "Link copied", message: "Share it anywhere." });
      recordProductAnalyticsFromBrowser("playlist.shared", {
        source: "public_playlist_view",
        subjectType: "playlist",
        subjectId: playlistId,
        payload: { playlistId, channel: "copy_link" },
      });
    } catch {
      addToast({ type: "error", title: "Couldn't copy", message: "Copy the link from the address bar." });
    }
  }, [addToast, playlistId]);

  const handleSave = useCallback(async () => {
    if (!token) {
      addToast({ type: "info", title: "Sign in to save", message: "Connect your account to add this to your library." });
      router.push("/");
      return;
    }
    setSaving(true);
    try {
      const saved = await savePlaylistAPI(token, playlistId);
      setSavedPlaylistId(saved.savedPlaylistId);
      setPlaylist((prev) => (prev ? { ...prev, isSaved: true } : prev));
      addToast({ type: "success", title: "Added to library", message: `“${saved.name}” is now in your library.` });
      recordProductAnalyticsFromBrowser("playlist.saved", {
        source: "public_playlist_view",
        subjectType: "playlist",
        subjectId: playlistId,
        payload: { playlistId },
      });
    } catch {
      addToast({ type: "error", title: "Couldn't save", message: "Please try again." });
    } finally {
      setSaving(false);
    }
  }, [addToast, playlistId, router, token]);

  const handleRemove = useCallback(async () => {
    if (!token || !savedPlaylistId) return;
    setSaving(true);
    try {
      await removeSavedPlaylistAPI(savedPlaylistId, token);
      setSavedPlaylistId(null);
      setPlaylist((prev) => (prev ? { ...prev, isSaved: false } : prev));
      addToast({ type: "success", title: "Removed", message: "Removed from your library." });
      recordProductAnalyticsFromBrowser("playlist.removed_from_library", {
        source: "public_playlist_view",
        subjectType: "playlist",
        subjectId: playlistId,
        payload: { playlistId },
      });
    } catch {
      addToast({ type: "error", title: "Couldn't remove", message: "Please try again." });
    } finally {
      setSaving(false);
    }
  }, [addToast, playlistId, savedPlaylistId, token]);

  if (loading) {
    return (
      <div className="pl-public-shell">
        <div className="pl-public-skeleton" aria-busy="true" aria-label="Loading playlist" />
      </div>
    );
  }

  if (notFound || !playlist) {
    return (
      <div className="pl-public-shell">
        <div className="pl-public-empty glass-panel">
          <div className="pl-public-empty-icon">🔒</div>
          <h1 className="pl-public-empty-title">This playlist isn’t available</h1>
          <p className="pl-public-empty-sub">
            It may be private, or the link may be incorrect.
          </p>
          <Link href="/library?tab=playlists" className="ui-btn ui-btn-primary">
            Go to your library
          </Link>
        </div>
      </div>
    );
  }

  const totalDuration = playlist.tracks.reduce((acc, t) => acc + (t.duration || 0), 0);
  const heroArt = playlist.tracks.find((t) => t.artworkPath)?.artworkPath;
  const heroArtUrl = heroArt ? `${API_BASE}${heroArt}` : null;

  return (
    <div className="pl-public-shell">
      <PlaylistHero
        artUrl={heroArtUrl}
        name={playlist.name}
        label={
          <>
            <span className="pl-visibility-badge">Public playlist</span>
            {playlist.isOwner && <span className="pl-hero-owner-tag">You own this</span>}
          </>
        }
        meta={
          <>
            {playlist.ownerDisplayName && (
              <>
                <span className="pl-hero-curator">by {playlist.ownerDisplayName}</span>
                <PlaylistMetaDot />
              </>
            )}
            {playlist.trackCount} track{playlist.trackCount !== 1 ? "s" : ""}
            <PlaylistMetaDot />
            {formatDuration(totalDuration)}
          </>
        }
        actions={
          <>
            <Button variant="primary" onClick={handlePlayAll} disabled={playableTracks.length === 0}>
              <PlayIcon /> Play
            </Button>
            <QueueActionsButton
              tracks={playableTracks}
              label="Add to queue"
              nextLabel="Play playlist next"
              disabled={playableTracks.length === 0}
            />

            {playlist.isOwner ? (
              <Link href="/library?tab=playlists" className="ui-btn ui-btn-ghost">
                Manage in library
              </Link>
            ) : playlist.isSaved ? (
              <Button variant="ghost" onClick={handleRemove} disabled={saving || !savedPlaylistId}>
                ✓ In your library
              </Button>
            ) : (
              <Button variant="ghost" onClick={handleSave} disabled={saving}>
                + Add to library
              </Button>
            )}

            <button type="button" className="ui-btn ui-btn-ghost" onClick={handleCopyLink}>
              Copy link
            </button>
          </>
        }
        notes={
          <>
            {playlist.playableTrackCount < playlist.trackCount && (
              <div className="pl-public-note">
                {playlist.playableTrackCount} of {playlist.trackCount} tracks are available to stream here.
              </div>
            )}
            {(playlist.privateTrackCount ?? 0) > 0 && (
              <div className="pl-public-note">
                {playlist.privateTrackCount === 1
                  ? "1 personal file from the owner's device is not shown."
                  : `${playlist.privateTrackCount} personal files from the owner's device are not shown.`}
              </div>
            )}
            {playlist.isOwner && playlist.visibility === "public" && playlist.tracks.some((track) => !track.catalogTrackId && !track.streamPath) && (
              <div className="pl-public-note">
                Files from your own devices stay private. Other listeners see only the Resonate tracks in this playlist.
              </div>
            )}
          </>
        }
      />

      <div className="pl-public-tracks">
        {playlist.tracks.length === 0 ? (
          <div className="pl-public-empty-list">This playlist has no tracks yet.</div>
        ) : (
          <div className="library-list">
            {playlist.tracks.map((track, index) => (
              <PublicPlaylistTrackRow
                key={`${track.id}-${index}`}
                track={track}
                index={index}
                isCurrent={currentTrack?.id === track.id}
                onPlay={() => handlePlayTrack(track)}
                onContextMenu={(event) => {
                  if (!isPlayableEntry(track)) return;
                  event.preventDefault();
                  setRowMenu({ x: event.clientX, y: event.clientY, index, opener: null });
                }}
                actions={
                  <RowMenuButton
                    label={`More options for ${track.title}`}
                    expanded={rowMenu?.index === index && rowMenu.opener !== null}
                    onOpen={(button) => setRowMenu({ ...menuPositionFor(button), index, opener: button })}
                    onClose={() => setRowMenu(null)}
                  />
                }
              />
            ))}
          </div>
        )}
      </div>

      {rowMenu && playlist.tracks[rowMenu.index] && (
        <ContextMenu
          x={rowMenu.x}
          y={rowMenu.y}
          items={queueActions.contextMenuItems(toLocalTrack(playlist.tracks[rowMenu.index]))}
          onClose={() => setRowMenu(null)}
          openerRef={rowMenu.opener ? { current: rowMenu.opener } : undefined}
          ariaLabel={`Options for ${playlist.tracks[rowMenu.index].title}`}
        />
      )}
    </div>
  );
}
