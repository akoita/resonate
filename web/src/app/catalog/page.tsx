"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
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

const CATALOG_VIEWS: CatalogView[] = ["releases", "artists", "stems"];

export default function GlobalCatalogPage() {
  const [releases, setReleases] = useState<Release[]>([]);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<CatalogView>("releases");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

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

  const tabCounts: Record<CatalogView, number> = {
    releases: filteredReleases.length,
    artists: filteredArtists.length,
    stems: filteredStems.length,
  };
  const totalCounts: Record<CatalogView, number> = {
    releases: releases.length,
    artists: artists.length,
    stems: stems.length,
  };
  const currentCount = tabCounts[view];
  const isSearching = normalizedQuery.length > 0;

  const handleTabKeyDown = (event: KeyboardEvent, index: number) => {
    const lastIndex = CATALOG_VIEWS.length - 1;
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") nextIndex = index === lastIndex ? 0 : index + 1;
    else if (event.key === "ArrowLeft") nextIndex = index === 0 ? lastIndex : index - 1;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = lastIndex;
    if (nextIndex === null) return;
    event.preventDefault();
    setView(CATALOG_VIEWS[nextIndex]);
    tabRefs.current[nextIndex]?.focus();
  };

  return (
    <div className="home-ng ng-catalog-page">
      <main className="ng-main">
        <section className="ng-section ng-catalog-hero">
          <div className="ng-catalog-hero__intro">
            <span className="ng-kicker ng-kicker--violet">Global catalog</span>
            <h1 className="ng-section-title">Browse the catalog</h1>
            <p className="ng-catalog-hero__subtitle">
              Every published release, artist, and stem on Resonate — search the
              full library and dive into anything that catches your ear.
            </p>
          </div>
          <label className="ng-catalog-search ng-catalog-search--hero">
            <span className="ms-icon" aria-hidden>search</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search releases, artists, stems"
              aria-label="Search global catalog"
            />
            {query && (
              <button
                type="button"
                className="ng-catalog-search__clear"
                onClick={() => setQuery("")}
                aria-label="Clear search"
              >
                <span className="ms-icon" aria-hidden>close</span>
              </button>
            )}
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
                {CATALOG_VIEWS.map((tab, index) => (
                  <button
                    key={tab}
                    ref={(node) => {
                      tabRefs.current[index] = node;
                    }}
                    type="button"
                    role="tab"
                    id={`catalog-tab-${tab}`}
                    aria-selected={view === tab}
                    aria-controls={`catalog-panel-${tab}`}
                    tabIndex={view === tab ? 0 : -1}
                    className={view === tab ? "ng-segmented__item active" : "ng-segmented__item"}
                    onClick={() => setView(tab)}
                    onKeyDown={(event) => handleTabKeyDown(event, index)}
                  >
                    {tab}
                    {!loading && <span className="ng-segmented__count">{tabCounts[tab]}</span>}
                  </button>
                ))}
              </div>
              <div className="ng-catalog-window" aria-live="polite">
                {loading
                  ? "Loading catalog"
                  : isSearching
                    ? `${currentCount} of ${totalCounts[view]} ${view}`
                    : `${currentCount} ${currentCount === 1 ? singularize(view) : view}`}
              </div>
            </div>

            {error && (
              <div className="ng-empty-state">
                <span className="ms-icon" aria-hidden>error</span>
                <p>{error}</p>
              </div>
            )}

            {!error && (
              <div
                role="tabpanel"
                id={`catalog-panel-${view}`}
                aria-labelledby={`catalog-tab-${view}`}
              >
                {loading ? (
                  <CatalogSkeleton view={view} />
                ) : view === "releases" ? (
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
                      <CatalogEmptyState label="releases" isSearching={isSearching} onClear={() => setQuery("")} />
                    )}
                  </div>
                ) : view === "artists" ? (
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
                      <CatalogEmptyState label="artists" isSearching={isSearching} onClear={() => setQuery("")} />
                    )}
                  </div>
                ) : (
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
                      <CatalogEmptyState label="stems" isSearching={isSearching} onClear={() => setQuery("")} />
                    )}
                  </div>
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

function CatalogSkeleton({ view }: { view: CatalogView }) {
  if (view === "releases") {
    return (
      <div className="ng-resource-grid ng-resource-grid--catalog" aria-hidden>
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="ng-skeleton-card">
            <span className="ng-skeleton-card__thumb" />
            <span className="ng-skeleton-card__lines">
              <span className="ng-skeleton-line ng-skeleton-line--lg" />
              <span className="ng-skeleton-line ng-skeleton-line--md" />
              <span className="ng-skeleton-line ng-skeleton-line--sm" />
            </span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="ng-stem-browser ng-catalog-results" aria-hidden>
      {Array.from({ length: 6 }).map((_, index) => (
        <div key={index} className="ng-skeleton-row" />
      ))}
    </div>
  );
}

function CatalogEmptyState({
  label,
  isSearching,
  onClear,
}: {
  label: string;
  isSearching: boolean;
  onClear: () => void;
}) {
  return (
    <div className="ng-empty-state">
      <span className="ms-icon" aria-hidden>{isSearching ? "search_off" : "library_music"}</span>
      <p>
        {isSearching
          ? `No ${label} match your search.`
          : `No ${label} in the catalog yet.`}
      </p>
      {isSearching && (
        <button type="button" className="ng-empty-state__action" onClick={onClear}>
          Clear search
        </button>
      )}
    </div>
  );
}

function singularize(view: CatalogView) {
  return view === "releases" ? "release" : view === "artists" ? "artist" : "stem";
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
