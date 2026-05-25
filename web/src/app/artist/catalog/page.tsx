"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import AuthGate from "../../../components/auth/AuthGate";
import { useAuth } from "../../../components/auth/AuthProvider";
import { getArtistMe, listMyReleases, type ArtistProfile, type Release, type Track } from "../../../lib/api";

type LoadState =
  | { status: "loading" }
  | { status: "ready"; artist: ArtistProfile; releases: Release[] }
  | { status: "no-artist" }
  | { status: "error"; message: string };

type CatalogTab = "releases" | "tracks";

type TrackRow = {
  track: Track;
  release: Release;
};

export default function ArtistCatalogPage() {
  const { token } = useAuth();
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<CatalogTab>("releases");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!token) return;
      setState({ status: "loading" });
      try {
        const artist = await getArtistMe(token);
        if (cancelled) return;
        if (!artist) {
          setState({ status: "no-artist" });
          return;
        }

        const releases = await listMyReleases(token);
        if (!cancelled) {
          setState({ status: "ready", artist, releases: sortReleases(releases) });
        }
      } catch (error) {
        if (!cancelled) {
          setState({
            status: "error",
            message: error instanceof Error ? error.message : "Unable to load catalog.",
          });
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <AuthGate title="Connect your wallet to view artist catalog.">
      <main className="artist-catalog-page">
        <header className="artist-catalog-header">
          <div>
            <p className="artist-analytics-eyebrow">Artist Catalog</p>
            <h1>{state.status === "ready" ? state.artist.displayName : "Managed Catalog"}</h1>
          </div>
          <div className="artist-catalog-actions">
            <Link href="/artist/upload" className="analytics-primary-action">
              Upload
            </Link>
            <Link href="/artist/analytics" className="analytics-primary-action">
              Analytics
            </Link>
          </div>
        </header>

        {state.status === "loading" ? <LoadingCatalog /> : null}
        {state.status === "error" ? <ErrorCatalog message={state.message} /> : null}
        {state.status === "no-artist" ? <NoArtistCatalog /> : null}
        {state.status === "ready" ? (
          <ReadyCatalog
            releases={state.releases}
            query={query}
            onQueryChange={setQuery}
            tab={tab}
            onTabChange={setTab}
          />
        ) : null}
      </main>
    </AuthGate>
  );
}

function ReadyCatalog({
  releases,
  query,
  onQueryChange,
  tab,
  onTabChange,
}: {
  releases: Release[];
  query: string;
  onQueryChange: (query: string) => void;
  tab: CatalogTab;
  onTabChange: (tab: CatalogTab) => void;
}) {
  const tracks = useMemo(() => flattenTracks(releases), [releases]);
  const filteredReleases = useMemo(() => filterReleases(releases, query), [releases, query]);
  const filteredTracks = useMemo(() => filterTracks(tracks, query), [tracks, query]);
  const readyCount = releases.filter((release) => release.status === "ready" || release.status === "published").length;
  const stemCount = tracks.reduce((total, row) => total + (row.track.stems?.length ?? 0), 0);

  return (
    <>
      <section className="artist-catalog-summary" aria-label="Managed catalog summary">
        <CatalogMetric label="Releases" value={releases.length} detail={`${readyCount} ready`} />
        <CatalogMetric label="Tracks" value={tracks.length} detail={`${stemCount} resources`} />
        <CatalogMetric label="Rights ready" value={countMarketplaceReady(releases)} detail="marketplace route" />
        <CatalogMetric label="Latest" value={formatRelativeDate(latestReleaseTime(releases))} detail="catalog update" />
      </section>

      <section className="artist-catalog-controls" aria-label="Catalog controls">
        <div className="artist-catalog-search">
          <span className="ms-icon" aria-hidden>search</span>
          <input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search releases, tracks, artists, status"
          />
        </div>
        <div className="analytics-window-switch" aria-label="Catalog view">
          <button type="button" className={tab === "releases" ? "active" : ""} onClick={() => onTabChange("releases")}>
            Releases
          </button>
          <button type="button" className={tab === "tracks" ? "active" : ""} onClick={() => onTabChange("tracks")}>
            Tracks
          </button>
        </div>
      </section>

      {tab === "releases" ? (
        <section className="analytics-panel">
          <div className="analytics-panel-heading">
            <h2>Releases</h2>
            <span>{filteredReleases.length} shown</span>
          </div>
          <ReleaseInventory releases={filteredReleases} />
        </section>
      ) : (
        <section className="analytics-panel">
          <div className="analytics-panel-heading">
            <h2>Tracks</h2>
            <span>{filteredTracks.length} shown</span>
          </div>
          <TrackInventory rows={filteredTracks} />
        </section>
      )}
    </>
  );
}

function CatalogMetric({ label, value, detail }: { label: string; value: number | string; detail: string }) {
  return (
    <article className="analytics-kpi-card">
      <div className="analytics-kpi-label">{label}</div>
      <div className="analytics-kpi-value">{typeof value === "number" ? formatNumber(value) : value}</div>
      <div className="analytics-kpi-detail">{detail}</div>
    </article>
  );
}

function ReleaseInventory({ releases }: { releases: Release[] }) {
  if (releases.length === 0) {
    return <p className="analytics-muted">No releases match this view.</p>;
  }

  return (
    <div className="analytics-table-wrap">
      <table className="analytics-table">
        <thead>
          <tr>
            <th>Release</th>
            <th>Credit</th>
            <th>Status</th>
            <th>Tracks</th>
            <th>Resources</th>
            <th>Rights</th>
            <th>Updated</th>
          </tr>
        </thead>
        <tbody>
          {releases.map((release) => (
            <tr key={release.id} className="analytics-row-tight">
              <td>
                <Link href={`/release/${release.id}`} className="artist-catalog-title-link">
                  {release.title}
                </Link>
              </td>
              <td>{release.primaryArtist || release.artist?.displayName || "Unknown"}</td>
              <td><StatusPill status={release.status} /></td>
              <td>{formatNumber(release.tracks?.length ?? 0)}</td>
              <td>{formatNumber(releaseResourceCount(release))}</td>
              <td>{formatRightsRoute(release.rightsRoute)}</td>
              <td>{formatRelativeDate(releaseTime(release))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TrackInventory({ rows }: { rows: TrackRow[] }) {
  if (rows.length === 0) {
    return <p className="analytics-muted">No tracks match this view.</p>;
  }

  return (
    <div className="analytics-table-wrap">
      <table className="analytics-table">
        <thead>
          <tr>
            <th>Track</th>
            <th>Release</th>
            <th>Credit</th>
            <th>Status</th>
            <th>Resources</th>
            <th>Rights</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ track, release }) => (
            <tr key={`${release.id}:${track.id}`} className="analytics-row-tight">
              <td>
                <Link href={`/release/${release.id}`} className="artist-catalog-title-link">
                  {track.title}
                </Link>
              </td>
              <td>{release.title}</td>
              <td>{track.artist || release.primaryArtist || release.artist?.displayName || "Unknown"}</td>
              <td><StatusPill status={track.processingStatus || release.status} /></td>
              <td>{formatNumber(track.stems?.length ?? 0)}</td>
              <td>{formatRightsRoute(track.rightsRoute || release.rightsRoute)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatusPill({ status }: { status?: string | null }) {
  return <span className={`artist-catalog-status ${statusClass(status)}`}>{formatStatus(status)}</span>;
}

function LoadingCatalog() {
  return (
    <section className="analytics-panel analytics-state-panel" aria-live="polite">
      <div className="analytics-skeleton analytics-skeleton-title" />
      <div className="analytics-skeleton-grid">
        <div className="analytics-skeleton" />
        <div className="analytics-skeleton" />
        <div className="analytics-skeleton" />
      </div>
    </section>
  );
}

function ErrorCatalog({ message }: { message: string }) {
  return (
    <section className="analytics-panel analytics-state-panel" role="alert">
      <p className="analytics-state-kicker">Catalog unavailable</p>
      <h2>Could not load managed catalog</h2>
      <p>{message}</p>
    </section>
  );
}

function NoArtistCatalog() {
  return (
    <section className="analytics-panel analytics-state-panel">
      <p className="analytics-state-kicker">No artist profile</p>
      <h2>Create an artist profile to manage releases</h2>
      <Link className="analytics-primary-action" href="/artist/onboarding">
        Open artist onboarding
      </Link>
    </section>
  );
}

function sortReleases(releases: Release[]) {
  return [...releases].sort((left, right) => releaseTime(right) - releaseTime(left));
}

function flattenTracks(releases: Release[]): TrackRow[] {
  return releases.flatMap((release) => (release.tracks ?? []).map((track) => ({ release, track })));
}

function filterReleases(releases: Release[], query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return releases;
  return releases.filter((release) =>
    [
      release.title,
      release.primaryArtist,
      release.artist?.displayName,
      release.status,
      release.genre,
      release.rightsRoute,
    ].some((value) => value?.toLowerCase().includes(normalized)),
  );
}

function filterTracks(rows: TrackRow[], query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return rows;
  return rows.filter(({ track, release }) =>
    [
      track.title,
      track.artist,
      track.processingStatus,
      track.rightsRoute,
      release.title,
      release.primaryArtist,
      release.artist?.displayName,
      release.status,
      release.genre,
    ].some((value) => value?.toLowerCase().includes(normalized)),
  );
}

function releaseResourceCount(release: Release) {
  return (release.tracks ?? []).reduce((total, track) => total + 1 + (track.stems?.length ?? 0), 0);
}

function countMarketplaceReady(releases: Release[]) {
  return releases.filter((release) => release.rightsRoute === "STANDARD_ESCROW" || release.rightsRoute === "TRUSTED_FAST_PATH").length;
}

function latestReleaseTime(releases: Release[]) {
  return releases.reduce((latest, release) => Math.max(latest, releaseTime(release)), 0);
}

function releaseTime(release: Release) {
  return Date.parse(release.createdAt || release.releaseDate || "") || 0;
}

function formatRightsRoute(route?: string | null) {
  if (!route) return "Not routed";
  return route.toLowerCase().split("_").map(capitalize).join(" ");
}

function formatStatus(status?: string | null) {
  if (!status) return "Unknown";
  return status.toLowerCase().split(/[_\s-]+/).map(capitalize).join(" ");
}

function statusClass(status?: string | null) {
  const normalized = status?.toLowerCase();
  if (normalized === "ready" || normalized === "published" || normalized === "complete") return "ready";
  if (normalized === "failed" || normalized === "blocked") return "blocked";
  return "pending";
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatRelativeDate(timestamp: number) {
  if (!timestamp) return "None";
  const diffMs = Date.now() - timestamp;
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diffMs < hour) return `${Math.max(1, Math.floor(diffMs / minute))}m ago`;
  if (diffMs < day) return `${Math.floor(diffMs / hour)}h ago`;
  return `${Math.floor(diffMs / day)}d ago`;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en", { maximumFractionDigits: 0 }).format(value);
}
