"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { listPublishedReleases, type Release } from "../../../../lib/api";
import { Button } from "../../../../components/ui/Button";
import { Card } from "../../../../components/ui/Card";

function getReleaseYear(release: Release) {
  return release.releaseDate ? new Date(release.releaseDate).getFullYear() : "";
}

export default function CatalogArtistPage() {
  const params = useParams();
  const router = useRouter();
  const artistName = typeof params.name === "string" ? decodeURIComponent(params.name) : "";
  const [catalogState, setCatalogState] = useState<{
    artistName: string;
    releases: Release[];
  }>({ artistName: "", releases: [] });

  useEffect(() => {
    if (!artistName) return;

    let cancelled = false;

    listPublishedReleases(100, artistName)
      .then((items) => {
        if (!cancelled) setCatalogState({ artistName, releases: items });
      })
      .catch(() => {
        if (!cancelled) setCatalogState({ artistName, releases: [] });
      });

    return () => {
      cancelled = true;
    };
  }, [artistName]);

  const loading = catalogState.artistName !== artistName;
  const releases = loading ? [] : catalogState.releases;
  const releaseCount = releases.length;
  const trackCount = releases.reduce((sum, release) => sum + (release.tracks?.length ?? 0), 0);
  const heroArtwork = releases.find((release) => release.artworkUrl)?.artworkUrl;

  return (
    <div className="page-container artist-page">
      <div className="artist-hero glass-panel">
        <Button variant="ghost" className="back-btn" onClick={() => router.back()}>
          ← Back
        </Button>
        <div className="artist-hero-content">
          {heroArtwork ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={heroArtwork} alt="" className="artist-avatar-lg" />
          ) : (
            <div className="artist-avatar-lg placeholder-avatar">
              {artistName?.[0]?.toUpperCase() || "A"}
            </div>
          )}
          <div className="artist-info">
            <div className="flex items-center gap-3 mb-3">
              <span className="artist-label mb-0">Artist</span>
              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-white/10 text-gray-400 border border-white/10">
                CATALOG CREDIT
              </span>
            </div>
            <h1 className="artist-name-lg text-gradient">
              {artistName || "Unknown Artist"}
            </h1>
            <p className="artist-stats">
              {loading
                ? "Loading catalog"
                : `${releaseCount} release${releaseCount !== 1 ? "s" : ""}`}
              {!loading && trackCount > 0
                ? ` • ${trackCount} track${trackCount !== 1 ? "s" : ""}`
                : ""}
            </p>
          </div>
        </div>
      </div>

      {(releases.length > 0 || loading) && (
        <>
          <div className="section-header border-b border-white/10 pb-4 mb-6">
            <div className="flex items-center gap-3">
              <span className="ms-icon" aria-hidden>public</span>
              <div>
                <h2 className="text-xl font-bold">Catalog Releases</h2>
                <p className="text-sm text-gray-400 mt-1">Releases credited to this artist name</p>
              </div>
            </div>
          </div>

          {loading ? (
            <div className="loading-spinner">Loading...</div>
          ) : (
            <div className="releases-grid">
              {releases.map((release) => (
                <Card
                  key={release.id}
                  title={release.title}
                  image={release.artworkUrl || undefined}
                  variant="standard"
                  onClick={() => router.push(`/release/${release.id}`)}
                >
                  <div className="card-meta">
                    <span className="card-type">{release.type}</span>
                    <span className="card-year">{getReleaseYear(release)}</span>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </>
      )}

      {!loading && releases.length === 0 && (
        <div className="empty-state">
          <h3>No catalog releases found</h3>
          <p className="text-sm text-gray-400">
            No public releases currently credit this artist name.
          </p>
        </div>
      )}
    </div>
  );
}
