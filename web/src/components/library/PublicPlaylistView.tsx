"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "../ui/Button";
import { useToast } from "../ui/Toast";
import { usePlayer } from "../../lib/playerContext";
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
import type { LocalTrack } from "../../lib/localLibrary";

/** Map a resolved public track into the player's LocalTrack shape. */
function toLocalTrack(t: PublicPlaylistTrack): LocalTrack {
  return {
    id: t.id,
    title: t.title,
    artist: t.artist,
    albumArtist: null,
    album: t.album,
    year: null,
    genre: null,
    duration: t.duration,
    createdAt: new Date().toISOString(),
    catalogTrackId: t.catalogTrackId,
    releaseId: t.releaseId,
    remoteUrl: t.streamPath ? `${API_BASE}${t.streamPath}` : undefined,
    remoteArtworkUrl: t.artworkPath ? `${API_BASE}${t.artworkPath}` : undefined,
    source: "remote",
  };
}

interface PublicPlaylistViewProps {
  playlistId: string;
}

export function PublicPlaylistView({ playlistId }: PublicPlaylistViewProps) {
  const router = useRouter();
  const { token } = useAuth();
  const { addToast } = useToast();
  const { playQueue, currentTrack } = usePlayer();

  const [playlist, setPlaylist] = useState<PublicPlaylist | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedPlaylistId, setSavedPlaylistId] = useState<string | null>(null);

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

  const playableTracks = useMemo(
    () => (playlist?.tracks ?? []).filter((t) => t.playable).map(toLocalTrack),
    [playlist]
  );

  const handlePlayAll = useCallback(() => {
    if (playableTracks.length === 0) return;
    void playQueue(playableTracks, 0);
    recordProductAnalyticsFromBrowser("playlist.played", {
      source: "public_playlist_view",
      subjectType: "playlist",
      subjectId: playlistId,
      payload: { playlistId, trackCount: playableTracks.length },
    });
  }, [playableTracks, playQueue, playlistId]);

  const handlePlayTrack = useCallback(
    (track: PublicPlaylistTrack) => {
      if (!track.playable) return;
      const index = playableTracks.findIndex((t) => t.id === track.id);
      void playQueue(playableTracks, index >= 0 ? index : 0);
    },
    [playableTracks, playQueue]
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
      <div className="pl-public-hero glass-panel">
        <div className="pl-public-hero-art">
          {heroArtUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={heroArtUrl} alt={playlist.name} />
          ) : (
            <div className="pl-public-hero-art-fallback">🎶</div>
          )}
        </div>
        <div className="pl-public-hero-body">
          <div className="pl-public-hero-label">
            <span className="pl-visibility-badge">Public playlist</span>
            {playlist.isOwner && <span className="pl-public-owner-tag">You own this</span>}
          </div>
          <h1 className="pl-public-hero-title">{playlist.name}</h1>
          <div className="pl-public-hero-meta">
            {playlist.ownerDisplayName && (
              <>
                <span className="pl-public-curator">by {playlist.ownerDisplayName}</span>
                <span className="pl-public-dot">•</span>
              </>
            )}
            {playlist.trackCount} track{playlist.trackCount !== 1 ? "s" : ""}
            <span className="pl-public-dot">•</span>
            {formatDuration(totalDuration)}
          </div>

          <div className="pl-public-hero-actions">
            <Button variant="primary" onClick={handlePlayAll} disabled={playableTracks.length === 0}>
              ▶ Play
            </Button>

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
          </div>

          {playlist.playableTrackCount < playlist.trackCount && (
            <div className="pl-public-note">
              {playlist.playableTrackCount} of {playlist.trackCount} tracks are available to stream here.
            </div>
          )}
        </div>
      </div>

      <div className="pl-public-tracks">
        {playlist.tracks.length === 0 ? (
          <div className="pl-public-empty-list">This playlist has no tracks yet.</div>
        ) : (
          <div className="library-list">
            {playlist.tracks.map((track, index) => {
              const artUrl = track.artworkPath ? `${API_BASE}${track.artworkPath}` : null;
              const isCurrent = currentTrack?.id === track.id;
              return (
                <div
                  key={`${track.id}-${index}`}
                  className={`library-item pl-public-track ${track.playable ? "" : "is-unplayable"} ${isCurrent ? "playing" : ""}`}
                  onClick={() => handlePlayTrack(track)}
                  role={track.playable ? "button" : undefined}
                  tabIndex={track.playable ? 0 : undefined}
                  onKeyDown={(e) => {
                    if (track.playable && (e.key === "Enter" || e.key === " ")) {
                      e.preventDefault();
                      handlePlayTrack(track);
                    }
                  }}
                  title={track.playable ? "Play" : "Not available to stream"}
                >
                  <div className="pl-public-track-index">{index + 1}</div>
                  <div className="library-item-artwork">
                    {artUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={artUrl} alt={track.title} />
                    ) : (
                      <div className="library-item-artwork-placeholder">🎵</div>
                    )}
                  </div>
                  <div className="library-item-info">
                    <div className="library-item-title">{track.title}</div>
                    <div className="library-item-meta">
                      {track.artist || "Unknown Artist"}
                      {track.album && ` • ${track.album}`}
                      {!track.playable && <span className="pl-public-unplayable-tag">Unavailable</span>}
                    </div>
                  </div>
                  <div className="library-item-duration">{formatDuration(track.duration)}</div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
