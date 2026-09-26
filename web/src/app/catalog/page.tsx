"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useSearchParams } from "next/navigation";
import {
  filterPublicPlaylists,
  flattenCatalogStems,
  formatCount,
  getArtistName,
  getCatalogSortTime,
  groupCatalogStemsByTrack,
  summarizeCreditedArtists,
  topCatalogGenres,
  type CatalogArtistSummary,
  type CatalogStemSummary,
} from "../../lib/catalogDisplay";
import {
  listPublicPlaylists,
  listPublishedReleases,
  type PublicPlaylistSummary,
  type Release,
} from "../../lib/api";
import { catalogArtistPlaybackTracks } from "../../lib/catalogArtistPlayback";
import { usePlayer } from "../../lib/playerContext";
import { CatalogArtistCard } from "../../components/catalog/CatalogArtistCard";
import { CatalogPlaylistCard } from "../../components/catalog/CatalogPlaylistCard";
import { CatalogReleaseCard } from "../../components/catalog/CatalogReleaseCard";
import { CatalogStemTrackRow } from "../../components/catalog/CatalogStemTrackRow";
import { useCatalogReleaseActions } from "../../components/catalog/useCatalogReleaseActions";

type CatalogView = "releases" | "artists" | "stems" | "playlists";

const CATALOG_VIEWS: CatalogView[] = ["releases", "artists", "stems", "playlists"];
const RECENT_CATALOG_LIMIT = 200;
const PLAYLIST_DISCOVERY_LIMIT = 60;
const GENRE_CHIP_LIMIT = 8;

export default function GlobalCatalogPage() {
  const searchParams = useSearchParams();
  const [releases, setReleases] = useState<Release[]>([]);
  const [playlists, setPlaylists] = useState<PublicPlaylistSummary[]>([]);
  const [query, setQuery] = useState(() => searchParams.get("q") || "");
  const [view, setView] = useState<CatalogView>(() => {
    const requestedView = searchParams.get("view");
    return requestedView && CATALOG_VIEWS.includes(requestedView as CatalogView)
      ? requestedView as CatalogView
      : "releases";
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    let cancelled = false;

    Promise.allSettled([
      listPublishedReleases(RECENT_CATALOG_LIMIT),
      listPublicPlaylists(PLAYLIST_DISCOVERY_LIMIT),
    ])
      .then(([releaseResult, playlistResult]) => {
        if (cancelled) return;
        if (releaseResult.status === "fulfilled") {
          setReleases(sortCatalogReleases(releaseResult.value));
        } else {
          setReleases([]);
          // Releases are the catalog's core content; only their failure is fatal.
          setError("Unable to load the catalog.");
        }
        setPlaylists(playlistResult.status === "fulfilled" ? playlistResult.value : []);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const { playQueue } = usePlayer();
  const { releaseActions } = useCatalogReleaseActions();
  const [selectedGenre, setSelectedGenre] = useState<string | null>(null);
  const artists = useMemo(() => summarizeCreditedArtists(releases), [releases]);
  const stems = useMemo(() => flattenCatalogStems(releases), [releases]);
  const stemTrackTotal = useMemo(() => groupCatalogStemsByTrack(stems).length, [stems]);
  const genres = useMemo(() => topCatalogGenres(releases, GENRE_CHIP_LIMIT), [releases]);
  const normalizedQuery = query.trim().toLowerCase();
  const normalizedGenre = selectedGenre?.toLowerCase() ?? null;
  const filteredReleases = useMemo(
    () => filterReleases(releases, normalizedQuery, normalizedGenre),
    [releases, normalizedQuery, normalizedGenre],
  );
  const filteredArtists = useMemo(
    () => filterArtists(artists, normalizedQuery),
    [artists, normalizedQuery],
  );
  const filteredStems = useMemo(
    () => filterStems(stems, normalizedQuery),
    [stems, normalizedQuery],
  );
  const filteredStemTracks = useMemo(
    () => groupCatalogStemsByTrack(filteredStems),
    [filteredStems],
  );
  const filteredPlaylists = useMemo(
    () => filterPublicPlaylists(playlists, normalizedQuery),
    [playlists, normalizedQuery],
  );

  const tabCounts: Record<CatalogView, number> = {
    releases: filteredReleases.length,
    artists: filteredArtists.length,
    stems: filteredStems.length,
    playlists: filteredPlaylists.length,
  };
  const isSearching = normalizedQuery.length > 0;
  const isFiltering = isSearching || (view === "releases" && selectedGenre !== null);
  const resultSummary =
    view === "releases"
      ? `${filteredReleases.length} of ${formatCount(releases.length, "release")}`
      : view === "artists"
        ? `${filteredArtists.length} of ${formatCount(artists.length, "artist")}`
        : view === "stems"
          ? `${filteredStemTracks.length} of ${formatCount(stemTrackTotal, "track")} · ${formatCount(filteredStems.length, "stem")}`
          : `${filteredPlaylists.length} of ${formatCount(playlists.length, "playlist")}`;

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

  const handlePlayRelease = (release: Release) => {
    const tracks = catalogArtistPlaybackTracks([release]);
    if (tracks.length > 0) void playQueue(tracks, 0);
  };

  const clearFilters = () => {
    setQuery("");
    setSelectedGenre(null);
  };

  return (
    <div className="home-ng ng-catalog-page">
      <main className="ng-main">
        <section className="ng-section ng-catalog-hero">
          <div className="ng-catalog-hero__intro">
            <span className="ng-kicker ng-kicker--violet">Global catalog</span>
            <h1 className="ng-section-title">Browse recent catalog</h1>
            <p className="ng-catalog-hero__subtitle">
              Search the latest {RECENT_CATALOG_LIMIT} public releases on
              Resonate, their credited artists and stems, and public playlists
              curated by the community.
            </p>
          </div>
          <label className="ng-catalog-search ng-catalog-search--hero">
            <span className="ms-icon" aria-hidden>search</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search releases, artists, stems, playlists"
              aria-label="Search recent catalog"
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
            </div>

            {view === "releases" && !loading && !error && genres.length > 0 && (
              <div className="ng-cat-genres" role="group" aria-label="Filter releases by genre">
                <button
                  type="button"
                  className={selectedGenre === null ? "ng-cat-genre active" : "ng-cat-genre"}
                  aria-pressed={selectedGenre === null}
                  onClick={() => setSelectedGenre(null)}
                >
                  All
                </button>
                {genres.map((genre) => (
                  <button
                    key={genre}
                    type="button"
                    className={selectedGenre === genre ? "ng-cat-genre active" : "ng-cat-genre"}
                    aria-pressed={selectedGenre === genre}
                    onClick={() => setSelectedGenre(selectedGenre === genre ? null : genre)}
                  >
                    {genre}
                  </button>
                ))}
              </div>
            )}

            <p className="ng-cat-summary" aria-live="polite">
              {loading ? "Loading recent catalog" : isFiltering && !error ? resultSummary : ""}
            </p>

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
                  filteredReleases.length > 0 ? (
                    <div className="ng-cat-grid">
                      {filteredReleases.map((release) => (
                        <CatalogReleaseCard
                          key={release.id}
                          release={release}
                          onPlay={handlePlayRelease}
                          actions={releaseActions(release)}
                        />
                      ))}
                    </div>
                  ) : (
                    <CatalogEmptyState label="releases" isFiltering={isFiltering} onClear={clearFilters} />
                  )
                ) : view === "artists" ? (
                  filteredArtists.length > 0 ? (
                    <div className="ng-cat-grid">
                      {filteredArtists.map((artist) => (
                        <CatalogArtistCard key={artist.key} artist={artist} />
                      ))}
                    </div>
                  ) : (
                    <CatalogEmptyState label="artists" isFiltering={isFiltering} onClear={clearFilters} />
                  )
                ) : view === "stems" ? (
                  filteredStemTracks.length > 0 ? (
                    <div className="ng-cat-stem-list">
                      {filteredStemTracks.map((group) => (
                        <CatalogStemTrackRow key={group.key} group={group} />
                      ))}
                    </div>
                  ) : (
                    <CatalogEmptyState label="stems" isFiltering={isFiltering} onClear={clearFilters} />
                  )
                ) : filteredPlaylists.length > 0 ? (
                  <div className="ng-cat-grid">
                    {filteredPlaylists.map((playlist) => (
                      <CatalogPlaylistCard key={playlist.id} playlist={playlist} />
                    ))}
                  </div>
                ) : (
                  <CatalogEmptyState label="playlists" isFiltering={isFiltering} onClear={clearFilters} />
                )}
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

function CatalogSkeleton({ view }: { view: CatalogView }) {
  if (view === "stems") {
    return (
      <div className="ng-cat-stem-list" aria-hidden>
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="ng-cat-skeleton-row">
            <span className="ng-cat-skeleton__thumb" />
            <span className="ng-cat-skeleton__lines">
              <span className="ng-cat-skeleton__line ng-cat-skeleton__line--lg" />
              <span className="ng-cat-skeleton__line ng-cat-skeleton__line--md" />
            </span>
          </div>
        ))}
      </div>
    );
  }

  const round = view === "artists";
  return (
    <div className="ng-cat-grid" aria-hidden>
      {Array.from({ length: 12 }).map((_, index) => (
        <div
          key={index}
          className={round ? "ng-cat-skeleton-card ng-cat-skeleton-card--round" : "ng-cat-skeleton-card"}
        >
          <span className="ng-cat-skeleton__art" />
          <span className="ng-cat-skeleton__line ng-cat-skeleton__line--lg" />
          <span className="ng-cat-skeleton__line ng-cat-skeleton__line--md" />
        </div>
      ))}
    </div>
  );
}

function CatalogEmptyState({
  label,
  isFiltering,
  onClear,
}: {
  label: string;
  isFiltering: boolean;
  onClear: () => void;
}) {
  return (
    <div className="ng-empty-state">
      <span className="ms-icon" aria-hidden>{isFiltering ? "search_off" : "library_music"}</span>
      <p>
        {isFiltering
          ? `No ${label} match your search.`
          : `No ${label} in the catalog yet.`}
      </p>
      {isFiltering && (
        <button type="button" className="ng-empty-state__action" onClick={onClear}>
          Clear search
        </button>
      )}
    </div>
  );
}

function sortCatalogReleases(releases: Release[]) {
  return [...releases].sort((left, right) => getCatalogSortTime(right) - getCatalogSortTime(left));
}

function filterReleases(releases: Release[], search: string, genre: string | null) {
  if (!search && !genre) return releases;
  return releases.filter((release) =>
    (!genre || release.genre?.trim().toLowerCase() === genre)
    && (!search || [
      release.title,
      getArtistName(release),
      release.genre,
      release.label,
      release.type,
    ].some((value) => value?.toLowerCase().includes(search))),
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
      stem.trackTitle,
      stem.type,
      stem.releaseTitle,
      stem.artistName,
    ].some((value) => value.toLowerCase().includes(search)),
  );
}
