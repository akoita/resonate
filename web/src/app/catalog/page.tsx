"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { artistProfileHref, catalogArtistHref } from "../../lib/artistRoutes";
import {
  flattenCatalogStems,
  getArtistName,
  getCatalogSortTime,
  summarizeCreditedArtists,
  type CatalogArtistSummary,
  type CatalogStemSummary,
} from "../../lib/catalogDisplay";
import { listPublishedReleases, type Release } from "../../lib/api";

type CatalogView = "releases" | "artists" | "stems";

export default function GlobalCatalogPage() {
  const [releases, setReleases] = useState<Release[]>([]);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<CatalogView>("releases");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    listPublishedReleases(200)
      .then((items) => {
        if (!cancelled) setReleases(sortCatalogReleases(items));
      })
      .catch(() => {
        if (!cancelled) {
          setReleases([]);
          setError("Unable to load the catalog.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const artists = useMemo(() => summarizeCreditedArtists(releases), [releases]);
  const stems = useMemo(() => flattenCatalogStems(releases), [releases]);
  const normalizedQuery = query.trim().toLowerCase();
  const filteredReleases = useMemo(
    () => filterReleases(releases, normalizedQuery),
    [releases, normalizedQuery],
  );
  const filteredArtists = useMemo(
    () => filterArtists(artists, normalizedQuery),
    [artists, normalizedQuery],
  );
  const filteredStems = useMemo(
    () => filterStems(stems, normalizedQuery),
    [stems, normalizedQuery],
  );
  const currentCount =
    view === "releases" ? filteredReleases.length : view === "artists" ? filteredArtists.length : filteredStems.length;

  return (
    <div className="home-ng ng-catalog-page">
      <main className="ng-main">
        <section className="ng-section ng-catalog-hero">
          <div>
            <span className="ng-kicker ng-kicker--violet">Global catalog</span>
            <h1 className="ng-section-title">Browse Catalog</h1>
          </div>
          <label className="ng-catalog-search">
            <span className="ms-icon" aria-hidden>search</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search releases, artists, stems"
              aria-label="Search global catalog"
            />
          </label>
        </section>

        <section className="ng-section">
          <div className="ng-catalog-shell ng-glass">
            <div className="ng-catalog-stats" aria-label="Catalog totals">
              <div>
                <strong>{releases.length}</strong>
                <span>Releases</span>
              </div>
              <div>
                <strong>{artists.length}</strong>
                <span>Artists</span>
              </div>
              <div>
                <strong>{stems.length}</strong>
                <span>Stems</span>
              </div>
            </div>

            <div className="ng-catalog-toolbar">
              <div className="ng-segmented" role="tablist" aria-label="Catalog view">
                {(["releases", "artists", "stems"] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    role="tab"
                    aria-selected={view === tab}
                    className={view === tab ? "ng-segmented__item active" : "ng-segmented__item"}
                    onClick={() => setView(tab)}
                  >
                    {tab}
                  </button>
                ))}
              </div>
              <div className="ng-catalog-window" aria-live="polite">
                {loading ? "Loading catalog" : `${currentCount} ${view}`}
              </div>
            </div>

            {error && (
              <div className="ng-empty-state">
                <span className="ms-icon" aria-hidden>error</span>
                <p>{error}</p>
              </div>
            )}

            {!error && view === "releases" && (
              <div className="ng-resource-grid ng-resource-grid--catalog">
                {filteredReleases.length > 0 ? (
                  filteredReleases.map((release) => (
                    <Link key={release.id} href={`/release/${release.id}`} className="ng-resource-card ng-resource-card__link">
                      <ReleaseThumb release={release} />
                      <div className="ng-resource-card__body">
                        <h4>{release.title}</h4>
                        <p>{getArtistName(release)}</p>
                        <div className="ng-resource-card__meta">
                          <span>{release.type || "Release"}</span>
                          <span>{release.genre || "Uncategorized"}</span>
                          <span>{formatRelativeTime(getCatalogSortTime(release))}</span>
                        </div>
                      </div>
                    </Link>
                  ))
                ) : (
                  <CatalogEmptyState loading={loading} label="releases" />
                )}
              </div>
            )}

            {!error && view === "artists" && (
              <div className="ng-artist-browser ng-catalog-results">
                {filteredArtists.length > 0 ? (
                  filteredArtists.map((artist) => (
                    <Link
                      key={artist.key}
                      href={artist.artistId ? artistProfileHref(artist.artistId) : catalogArtistHref(artist.name)}
                      className="ng-artist-row"
                    >
                      <span className="ng-artist-row__avatar" aria-hidden>
                        {artist.name[0]?.toUpperCase() ?? "?"}
                      </span>
                      <span className="ng-artist-row__main">
                        <strong>{artist.name}</strong>
                        <small>{artist.latestRelease?.title ?? "No recent release"}</small>
                      </span>
                      <span className="ng-artist-row__metric">
                        {artist.releaseCount}
                        <small>releases</small>
                      </span>
                      <span className="ng-artist-row__metric">
                        {artist.stemCount}
                        <small>stems</small>
                      </span>
                    </Link>
                  ))
                ) : (
                  <CatalogEmptyState loading={loading} label="artists" />
                )}
              </div>
            )}

            {!error && view === "stems" && (
              <div className="ng-stem-browser ng-catalog-results">
                {filteredStems.length > 0 ? (
                  filteredStems.map((stem) => (
                    <Link key={stem.id} href={`/release/${stem.releaseId}?mixer=true`} className="ng-stem-row">
                      <span className="ng-stem-row__icon" aria-hidden>
                        <span className="ms-icon">graphic_eq</span>
                      </span>
                      <span className="ng-stem-row__main">
                        <strong>{stem.title}</strong>
                        <small>{stem.releaseTitle} · {stem.artistName}</small>
                      </span>
                      <span className="ng-stem-row__type">{stem.type}</span>
                    </Link>
                  ))
                ) : (
                  <CatalogEmptyState loading={loading} label="stems" />
                )}
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

function ReleaseThumb({ release }: { release: Release }) {
  return (
    <span className="ng-release-thumb">
      {release.artworkUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={release.artworkUrl} alt="" />
      ) : (
        <span aria-hidden>{(release.title?.[0] ?? "?").toUpperCase()}</span>
      )}
    </span>
  );
}

function CatalogEmptyState({ loading, label }: { loading: boolean; label: string }) {
  return (
    <div className="ng-empty-state">
      <span className="ms-icon" aria-hidden>{loading ? "hourglass_top" : "search_off"}</span>
      <p>{loading ? "Loading catalog." : `No ${label} match this search.`}</p>
    </div>
  );
}

function sortCatalogReleases(releases: Release[]) {
  return [...releases].sort((left, right) => getCatalogSortTime(right) - getCatalogSortTime(left));
}

function filterReleases(releases: Release[], search: string) {
  if (!search) return releases;
  return releases.filter((release) =>
    [
      release.title,
      getArtistName(release),
      release.genre,
      release.label,
      release.type,
    ].some((value) => value?.toLowerCase().includes(search)),
  );
}

function filterArtists(artists: CatalogArtistSummary[], search: string) {
  if (!search) return artists;
  return artists.filter((artist) =>
    [
      artist.name,
      artist.latestRelease?.title,
      ...Array.from(artist.genres),
    ].some((value) => value?.toLowerCase().includes(search)),
  );
}

function filterStems(stems: CatalogStemSummary[], search: string) {
  if (!search) return stems;
  return stems.filter((stem) =>
    [
      stem.title,
      stem.type,
      stem.releaseTitle,
      stem.artistName,
    ].some((value) => value.toLowerCase().includes(search)),
  );
}

function formatRelativeTime(time: number) {
  if (!time) return "Unknown";
  const diffMs = Date.now() - time;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diffMs < hour) return `${Math.max(1, Math.round(diffMs / minute))}m ago`;
  if (diffMs < day) return `${Math.round(diffMs / hour)}h ago`;
  if (diffMs < 30 * day) return `${Math.round(diffMs / day)}d ago`;
  return new Date(time).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
