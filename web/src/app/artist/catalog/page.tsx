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

const DAY_OPTIONS = [7, 30, 90] as const;

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
      <main className="analytics-container" style={{ padding: "4px 0" }}>
        <header className="analytics-header-section">
          <div className="analytics-title-row">
            <div>
              <p className="artist-analytics-eyebrow" style={{ fontSize: "12px", opacity: 0.5, margin: "0 0 4px" }}>
                Artist Catalog
              </p>
              <h1 style={{ margin: 0 }}>
                {state.status === "ready" ? state.artist.displayName : "Managed Catalog"}
              </h1>
            </div>
            <div className="artist-catalog-actions" style={{ display: "flex", gap: "12px" }}>
              <Link href="/artist/upload" className="wallet-connect-btn" style={{ padding: "8px 20px" }}>
                Upload
              </Link>
              <Link
                href="/artist/analytics"
                className="wallet-connect-btn"
                style={{
                  padding: "8px 20px",
                  background: "rgba(255, 255, 255, 0.03)",
                  border: "1px solid rgba(255, 255, 255, 0.06)",
                  color: "var(--r-on-surface)",
                }}
              >
                Analytics
              </Link>
            </div>
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

      <section className="artist-catalog-controls" aria-label="Catalog controls" style={{ display: "flex", gap: "16px", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", margin: "12px 0 4px" }}>
        <div className="artist-catalog-search" style={{ border: "1px solid rgba(255,255,255,0.06)", borderRadius: "20px", display: "flex", alignItems: "center", gap: "8px", padding: "8px 16px", background: "rgba(255,255,255,0.02)", width: "380px" }}>
          <span className="ms-icon" style={{ opacity: 0.4 }} aria-hidden>search</span>
          <input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search releases, tracks, status..."
            style={{ background: "transparent", border: "none", outline: "none", color: "var(--r-on-surface)", fontSize: "14px", width: "100%" }}
          />
        </div>
        <div className="date-selector-pill-row" aria-label="Catalog view">
          <button
            type="button"
            className={`date-selector-pill ${tab === "releases" ? "active" : ""}`}
            onClick={() => onTabChange("releases")}
          >
            Releases
          </button>
          <button
            type="button"
            className={`date-selector-pill ${tab === "tracks" ? "active" : ""}`}
            onClick={() => onTabChange("tracks")}
          >
            Tracks
          </button>
        </div>
      </section>

      {tab === "releases" ? (
        <div className="premium-table-wrapper">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
            <h2 style={{ margin: 0, fontSize: "18px" }}>Releases</h2>
            <div className="chart-card-header-badge">{filteredReleases.length} shown</div>
          </div>
          <ReleaseInventory releases={filteredReleases} />
        </div>
      ) : (
        <div className="premium-table-wrapper">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
            <h2 style={{ margin: 0, fontSize: "18px" }}>Tracks</h2>
            <div className="chart-card-header-badge">{filteredTracks.length} shown</div>
          </div>
          <TrackInventory rows={filteredTracks} />
        </div>
      )}
    </>
  );
}

function CatalogMetric({ label, value, detail }: { label: string; value: number | string; detail: string }) {
  let icon = "💿";
  if (label.toLowerCase().includes("track")) icon = "🎵";
  else if (label.toLowerCase().includes("rights")) icon = "🛡️";
  else if (label.toLowerCase().includes("latest")) icon = "⏱️";

  return (
    <div className="premium-kpi-card human-context">
      <div className="kpi-header">
        <span className="kpi-label">{label}</span>
        <div className="kpi-icon-glow">{icon}</div>
      </div>
      <div className="kpi-value-mono" style={{ textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }}>
        {typeof value === "number" ? formatNumber(value) : value}
      </div>
      <div className="kpi-subtitle-trend">
        <span>{detail}</span>
      </div>
    </div>
  );
}

function ArtworkThumbnail({ src, title, fallbackChar }: { src?: string | null; title: string; fallbackChar: string }) {
  const [error, setError] = useState(false);

  if (src && !error) {
    return (
      <img
        src={src}
        alt={title}
        onError={() => setError(true)}
        style={{
          width: "36px",
          height: "36px",
          borderRadius: "6px",
          objectFit: "cover",
          border: "1px solid rgba(255, 255, 255, 0.08)",
          boxShadow: "0 4px 10px rgba(0, 0, 0, 0.3)",
          background: "rgba(255, 255, 255, 0.02)",
        }}
      />
    );
  }

  return (
    <div
      style={{
        width: "36px",
        height: "36px",
        borderRadius: "6px",
        background: "linear-gradient(135deg, rgba(255, 255, 255, 0.05) 0%, rgba(255, 255, 255, 0.01) 100%)",
        border: "1px solid rgba(255, 255, 255, 0.08)",
        boxShadow: "0 4px 10px rgba(0, 0, 0, 0.2)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: "14px",
        color: "rgba(255, 255, 255, 0.4)",
      }}
    >
      {fallbackChar}
    </div>
  );
}

function ReleaseInventory({ releases }: { releases: Release[] }) {
  if (releases.length === 0) {
    return <p className="analytics-muted" style={{ textAlign: "center", padding: "40px 0", opacity: 0.5 }}>No releases match this search query.</p>;
  }

  return (
    <table className="premium-table">
      <thead>
        <tr>
          <th>Release</th>
          <th>Credit</th>
          <th>Status</th>
          <th style={{ textAlign: "right" }}>Tracks</th>
          <th style={{ textAlign: "right" }}>Resources</th>
          <th>Rights</th>
          <th>Updated</th>
        </tr>
      </thead>
      <tbody>
        {releases.map((release) => (
          <tr key={release.id}>
            <td style={{ fontWeight: 600 }}>
              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                <ArtworkThumbnail src={release.artworkUrl} title={release.title} fallbackChar="💿" />
                <Link href={`/release/${release.id}`} className="artist-catalog-title-link" style={{ color: "var(--r-on-surface)" }}>
                  {release.title}
                </Link>
              </div>
            </td>
            <td>{release.primaryArtist || release.artist?.displayName || "Unknown"}</td>
            <td><StatusPill status={release.status} /></td>
            <td className="premium-table-cell-mono" style={{ textAlign: "right" }}>{formatNumber(release.tracks?.length ?? 0)}</td>
            <td className="premium-table-cell-mono" style={{ textAlign: "right" }}>{formatNumber(releaseResourceCount(release))}</td>
            <td><RightsBadge route={release.rightsRoute} /></td>
            <td className="premium-table-cell-mono">{formatRelativeDate(releaseTime(release))}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TrackInventory({ rows }: { rows: TrackRow[] }) {
  if (rows.length === 0) {
    return <p className="analytics-muted" style={{ textAlign: "center", padding: "40px 0", opacity: 0.5 }}>No tracks match this search query.</p>;
  }

  return (
    <table className="premium-table">
      <thead>
        <tr>
          <th>Track</th>
          <th>Release</th>
          <th>Credit</th>
          <th>Status</th>
          <th style={{ textAlign: "right" }}>Resources</th>
          <th>Rights</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ track, release }) => (
          <tr key={`${release.id}:${track.id}`}>
            <td style={{ fontWeight: 600 }}>
              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                <ArtworkThumbnail src={release.artworkUrl} title={track.title} fallbackChar="🎵" />
                <Link href={`/release/${release.id}`} className="artist-catalog-title-link" style={{ color: "var(--r-on-surface)" }}>
                  {track.title}
                </Link>
              </div>
            </td>
            <td>{release.title}</td>
            <td>{track.artist || release.primaryArtist || release.artist?.displayName || "Unknown"}</td>
            <td><StatusPill status={track.processingStatus || release.status} /></td>
            <td className="premium-table-cell-mono" style={{ textAlign: "right" }}>{formatNumber(track.stems?.length ?? 0)}</td>
            <td><RightsBadge route={track.rightsRoute || release.rightsRoute} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function StatusPill({ status }: { status?: string | null }) {
  const norm = status?.toLowerCase();
  let badgeClass = "pending";
  if (norm === "ready" || norm === "published" || norm === "complete") {
    badgeClass = "active";
  } else if (norm === "failed" || norm === "blocked") {
    badgeClass = "slashed";
  }
  return <span className={`status-capsule-badge ${badgeClass}`} style={{ fontSize: "10px", padding: "2px 8px" }}>{formatStatus(status)}</span>;
}

function RightsBadge({ route }: { route?: string | null }) {
  return <span className="status-capsule-badge inactive" style={{ fontSize: "10px", padding: "2px 8px" }}>{formatRightsRoute(route)}</span>;
}

function LoadingCatalog() {
  return (
    <div className="analytics-skeleton" style={{ padding: "80px", textAlign: "center", opacity: 0.5 }}>
      <span className="aid-spinner" style={{ marginBottom: "16px" }} />
      <div>Loading managed catalog inventory…</div>
    </div>
  );
}

function ErrorCatalog({ message }: { message: string }) {
  return (
    <section className="premium-table-wrapper" style={{ textAlign: "center", padding: "40px" }} role="alert">
      <p style={{ color: "var(--r-error)", fontSize: "12px", fontWeight: 600, textTransform: "uppercase" }}>
        Catalog Unavailable
      </p>
      <h2 style={{ fontSize: "20px", marginTop: "8px" }}>Could not load managed catalog</h2>
      <p style={{ opacity: 0.6, fontSize: "13px", margin: "8px 0" }}>{message}</p>
    </section>
  );
}

function NoArtistCatalog() {
  return (
    <section className="premium-table-wrapper" style={{ textAlign: "center", padding: "40px" }}>
      <p style={{ color: "var(--r-primary-soft)", fontSize: "12px", fontWeight: 600, textTransform: "uppercase" }}>
        No Artist Profile
      </p>
      <h2 style={{ fontSize: "20px", marginTop: "8px" }}>Create an artist profile to manage releases</h2>
      <Link className="wallet-connect-btn" href="/artist/onboarding" style={{ display: "inline-block", marginTop: "16px", padding: "8px 24px" }}>
        Open Artist Onboarding
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
  if (!route) return "Not Routed";
  return route.toLowerCase().split("_").map(capitalize).join(" ");
}

// Fixed formatStatus helper to map ready/published/complete consistently
function formatStatus(status?: string | null) {
  if (!status) return "Unknown";
  const norm = status.toLowerCase();
  if (norm === "ready" || norm === "published" || norm === "complete") return "Active ✓";
  if (norm === "failed" || norm === "blocked") return "Slashed ✕";
  return status.split(/[_\s-]+/).map(capitalize).join(" ");
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
