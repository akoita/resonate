"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import AuthGate from "../../../../components/auth/AuthGate";
import { Button } from "../../../../components/ui/Button";
import { TrackActionMenu } from "../../../../components/ui/TrackActionMenu";
import { QueueActionsButton } from "../../../../components/player/QueueActionsButton";
import { usePlayer } from "../../../../lib/playerContext";
import { useQueueActions } from "../../../../lib/useQueueActions";
import { getArtworkUrl, listTracks, type LocalTrack } from "../../../../lib/localLibrary";

const UNKNOWN_ALBUM = "Unknown Album";

function formatDuration(seconds?: number | null) {
  if (!seconds) return "--:--";
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

interface LibraryAlbum {
  name: string;
  tracks: LocalTrack[];
  year?: number | string | null;
  artworkUrl?: string | null;
}

export default function LibraryArtistPage() {
  const params = useParams();
  const router = useRouter();
  const artistName = typeof params.name === "string" ? decodeURIComponent(params.name) : "";
  const [tracks, setTracks] = useState<LocalTrack[]>([]);
  const [artworkUrls, setArtworkUrls] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);

  const { playQueue, currentTrack } = usePlayer();
  const queueActions = useQueueActions();

  useEffect(() => {
    if (!artistName) return;

    let cancelled = false;

    listTracks()
      .then(async (items) => {
        const artistTracks = items.filter(
          (track) => (track.artist || "Unknown Artist") === artistName,
        );

        const artworkResults = await Promise.all(
          artistTracks.map(async (track) => ({
            id: track.id,
            url: track.remoteArtworkUrl || (await getArtworkUrl(track)),
          })),
        );

        if (cancelled) return;
        setTracks(artistTracks);
        setArtworkUrls(
          new Map(
            artworkResults
              .filter((result): result is { id: string; url: string } => Boolean(result.url))
              .map((result) => [result.id, result.url]),
          ),
        );
      })
      .catch(() => {
        if (!cancelled) {
          setTracks([]);
          setArtworkUrls(new Map());
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [artistName]);

  /* Albums were counted but never shown — the page listed every track flat,
   * with no cover, no way into an album and nothing to play. Group them so the
   * discography is the shape of the page. */
  const albums = useMemo<LibraryAlbum[]>(() => {
    const grouped = new Map<string, LibraryAlbum>();

    for (const track of tracks) {
      const name = track.album || UNKNOWN_ALBUM;
      const existing = grouped.get(name);
      const artworkUrl = track.remoteArtworkUrl || artworkUrls.get(track.id) || null;

      if (existing) {
        existing.tracks.push(track);
        existing.year = existing.year ?? track.year;
        existing.artworkUrl = existing.artworkUrl ?? artworkUrl;
      } else {
        grouped.set(name, { name, tracks: [track], year: track.year, artworkUrl });
      }
    }

    return Array.from(grouped.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [tracks, artworkUrls]);

  const heroArtwork = tracks
    .map((track) => track.remoteArtworkUrl || artworkUrls.get(track.id))
    .find(Boolean);

  const albumHref = (albumName: string) =>
    `/library?tab=albums&album=${encodeURIComponent(albumName)}&albumArtist=${encodeURIComponent(artistName)}`;

  const playFrom = (list: LocalTrack[], trackId: string) => {
    const index = list.findIndex((t) => t.id === trackId);
    void playQueue(list, index >= 0 ? index : 0);
  };

  return (
    <AuthGate title="Connect your wallet to view your library.">
      <div className="page-container artist-page">
        <div className="artist-hero glass-panel">
          <Button variant="ghost" className="back-btn" onClick={() => router.back()}>
            ← Back
          </Button>
          <div className="artist-hero-content">
            {heroArtwork ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={heroArtwork} alt={artistName} className="artist-avatar-lg" />
            ) : (
              <div className="artist-avatar-lg placeholder-avatar">
                {artistName?.[0]?.toUpperCase() || "A"}
              </div>
            )}
            <div className="artist-info">
              <div className="flex items-center gap-3 mb-3">
                <span className="artist-label mb-0">Library Artist</span>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-white/10 text-gray-400 border border-white/10">
                  LOCAL LIBRARY
                </span>
              </div>
              <h1 className="artist-name-lg text-gradient">
                {artistName || "Unknown Artist"}
              </h1>
              <p className="artist-stats">
                {loading
                  ? "Loading local library"
                  : `${tracks.length} local track${tracks.length !== 1 ? "s" : ""}`}
                {!loading && albums.length > 0
                  ? ` • ${albums.length} album${albums.length !== 1 ? "s" : ""}`
                  : ""}
              </p>

              {!loading && tracks.length > 0 && (
                <div className="library-artist-actions">
                  <Button variant="primary" onClick={() => void playQueue(tracks, 0)}>
                    ▶ Play all
                  </Button>
                  <QueueActionsButton
                    tracks={tracks}
                    label="Queue artist"
                    nextLabel="Play artist next"
                  />
                </div>
              )}
            </div>
          </div>
        </div>

        {!loading && albums.length > 0 && (
          <section className="local-library-section" style={{ marginTop: "2rem" }}>
            <div className="section-header border-b border-white/10 pb-4 mb-6">
              <div className="flex items-center gap-3">
                <span className="text-xl">💿</span>
                <div>
                  <h2 className="text-xl font-bold">Albums</h2>
                  <p className="text-sm text-gray-400 mt-1">Grouped from your local library</p>
                </div>
              </div>
            </div>

            <div className="library-grid-view">
              {albums.map((album) => (
                <div key={album.name} className="library-card library-card--linked">
                  <Link href={albumHref(album.name)} className="library-card-link">
                    {album.artworkUrl ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img src={album.artworkUrl} alt={album.name} className="library-card-artwork" />
                    ) : (
                      <div className="library-card-icon">💿</div>
                    )}
                    <div className="library-card-title">{album.name}</div>
                    <div className="library-card-meta">{album.year || "Unknown year"}</div>
                    <div className="library-card-count">
                      {album.tracks.length} track{album.tracks.length !== 1 ? "s" : ""}
                    </div>
                  </Link>
                  <div className="library-card-actions">
                    <TrackActionMenu actions={queueActions.actionMenuItems(album.tracks)} />
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="local-library-section" style={{ marginTop: "2rem" }}>
          <div className="section-header border-b border-white/10 pb-4 mb-6">
            <div className="flex items-center gap-3">
              <span className="text-xl">📂</span>
              <div>
                <h2 className="text-xl font-bold">All tracks</h2>
                <p className="text-sm text-gray-400 mt-1">Tracks grouped from local metadata</p>
              </div>
            </div>
          </div>

          {loading ? (
            <div className="loading-spinner">Loading...</div>
          ) : tracks.length > 0 ? (
            <div className="library-list">
              {tracks.map((track) => {
                const artUrl = track.remoteArtworkUrl || artworkUrls.get(track.id);
                const isCurrent = currentTrack?.id === track.id;
                return (
                  <div
                    key={track.id}
                    className={`library-item library-artist-track ${isCurrent ? "playing" : ""}`}
                    role="button"
                    tabIndex={0}
                    title="Play"
                    onClick={() => playFrom(tracks, track.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        playFrom(tracks, track.id);
                      }
                    }}
                    onContextMenu={(e) => e.preventDefault()}
                  >
                    <div className="library-item-artwork">
                      {artUrl ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img src={artUrl} alt={track.title} />
                      ) : (
                        <div className="library-item-artwork-placeholder">🎵</div>
                      )}
                    </div>
                    <div className="library-item-info">
                      <div className="library-item-title">{track.title}</div>
                      <div className="library-item-meta">{track.album || "—"}</div>
                    </div>
                    <div className="library-item-duration">{formatDuration(track.duration)}</div>
                    <div onClick={(e) => e.stopPropagation()}>
                      <TrackActionMenu actions={queueActions.actionMenuItems(track)} />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="empty-state">
              <h3>No local tracks found</h3>
              <p className="text-sm text-gray-400">
                This library artist only exists when tracks in your local library use that artist name.
              </p>
            </div>
          )}
        </section>
      </div>
    </AuthGate>
  );
}
