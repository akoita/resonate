"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import AuthGate from "../../../../components/auth/AuthGate";
import { Button } from "../../../../components/ui/Button";
import { getArtworkUrl, listTracks, type LocalTrack } from "../../../../lib/localLibrary";

function formatDuration(seconds?: number | null) {
  if (!seconds) return "--:--";
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

export default function LibraryArtistPage() {
  const params = useParams();
  const router = useRouter();
  const artistName = typeof params.name === "string" ? decodeURIComponent(params.name) : "";
  const [tracks, setTracks] = useState<LocalTrack[]>([]);
  const [artworkUrls, setArtworkUrls] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);

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

  const albums = useMemo(() => {
    const names = new Set(
      tracks
        .map((track) => track.album)
        .filter((album): album is string => Boolean(album)),
    );
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [tracks]);

  const heroArtwork = tracks
    .map((track) => track.remoteArtworkUrl || artworkUrls.get(track.id))
    .find(Boolean);

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
            </div>
          </div>
        </div>

        <div className="local-library-section" style={{ marginTop: "2rem" }}>
          <div className="section-header border-b border-white/10 pb-4 mb-6">
            <div className="flex items-center gap-3">
              <span className="text-xl">📂</span>
              <div>
                <h2 className="text-xl font-bold">Your Library</h2>
                <p className="text-sm text-gray-400 mt-1">Tracks grouped from local metadata</p>
              </div>
            </div>
          </div>

          {loading ? (
            <div className="loading-spinner">Loading...</div>
          ) : tracks.length > 0 ? (
            <div className="library-list">
              {tracks.map((track) => (
                <div key={track.id} className="library-item" style={{ gridTemplateColumns: "auto 1fr auto" }}>
                  <div className="library-item-title">{track.title}</div>
                  <div className="library-item-album">{track.album || "—"}</div>
                  <div className="library-item-duration">{formatDuration(track.duration)}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <h3>No local tracks found</h3>
              <p className="text-sm text-gray-400">
                This library artist only exists when tracks in your local library use that artist name.
              </p>
            </div>
          )}
        </div>
      </div>
    </AuthGate>
  );
}
