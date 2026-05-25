"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "../components/auth/AuthProvider";
import {
  createAgentConfig,
  getAgentConfig,
  getReleaseTrackStreamUrl,
  getStemPreviewUrl,
  getSongRecommendations,
  listMyReleases,
  listPublishedReleases,
  recordAgentSignal,
  Release,
  startAgentSession,
  updateAgentConfig,
  type SongRecommendationItem,
  type Track,
} from "../lib/api";
import { artistProfileHref, catalogArtistHref } from "../lib/artistRoutes";
import { type LocalTrack, saveTracksMetadata } from "../lib/localLibrary";
import { usePlayer } from "../lib/playerContext";
import { useWebSockets, ReleaseStatusUpdate } from "../hooks/useWebSockets";
import { useToast } from "../components/ui/Toast";
import { AddToPlaylistModal } from "../components/library/AddToPlaylistModal";
import { listCampaignsSync, getFeaturedCampaignSync, daysUntil, type Campaign } from "../lib/shows";
import AgentSessionPresets from "../components/agent/AgentSessionPresets";

/*
 * Home page — Next-Gen Music Platform (Stitch design applied, 2026-04).
 *
 * Layout (top to bottom):
 *   1. Hero — featured campaign or release, glass card with CTA pair
 *   2. Filter chips — genre/mood quick-filters (client-side filter)
 *   3. Resume Playing — 4 square release cards with hover play overlay
 *   4. Trending Stems — 3 waveform-visualized stem cards
 *   5. Upcoming Live Events — 2 wide 16:9 campaign cards (Shows surface)
 *   6. AI DJ session presets — intent-led mix modes
 *   7. Top Artists — horizontal pill row derived from catalog
 *
 * Source: Stitch project 8644925846196383098 "Next-Gen Music Platform - Home Page".
 * Icons use Material Symbols (loaded in app/layout.tsx).
 */

type FilterId = "all" | "electronic" | "hip-hop" | "afrobeat" | "indie" | "jazz" | "focus" | "hype" | "chill" | "late-night";
type FilterOption = {
  id: FilterId;
  label: string;
  kind: "all" | "genre" | "mood";
  value?: string;
  energy?: "low" | "medium" | "high";
};
type CatalogView = "releases" | "artists" | "stems";

type ArtistSummary = {
  key: string;
  name: string;
  artistId: string | null;
  releaseCount: number;
  stemCount: number;
  latestRelease?: Release;
  latestAt: number;
  genres: Set<string>;
};

type StemSummary = {
  id: string;
  releaseId: string;
  releaseTitle: string;
  title: string;
  type: string;
  artistName: string;
  artworkUrl?: string | null;
  createdAt: string;
};

type HomeRecommendation = {
  key: string;
  trackId?: string;
  title: string;
  artist: string;
  releaseId?: string;
  genre?: string | null;
  moods?: string[];
  score?: number;
  reasons: string[];
  release?: Release;
};

const FILTERS: FilterOption[] = [
  { id: "all", label: "All Trending", kind: "all" },
  { id: "electronic", label: "Electronic", kind: "genre", value: "Electronic", energy: "medium" },
  { id: "hip-hop", label: "Hip-Hop", kind: "genre", value: "Hip Hop", energy: "high" },
  { id: "afrobeat", label: "Afrobeat", kind: "genre", value: "Afrobeat", energy: "high" },
  { id: "indie", label: "Indie", kind: "genre", value: "Indie", energy: "medium" },
  { id: "jazz", label: "Jazz", kind: "genre", value: "Jazz", energy: "low" },
  { id: "focus", label: "Focus", kind: "mood", value: "Focus", energy: "low" },
  { id: "hype", label: "Hype", kind: "mood", value: "Hype", energy: "high" },
  { id: "chill", label: "Chill", kind: "mood", value: "Chill", energy: "low" },
  { id: "late-night", label: "Late Night", kind: "mood", value: "Late Night", energy: "medium" },
];

export default function Home() {
  const router = useRouter();
  const [releases, setReleases] = useState<Release[]>([]);
  const [myReleases, setMyReleases] = useState<Release[]>([]);
  const [activeFilter, setActiveFilter] = useState<FilterId>("all");
  const [catalogView, setCatalogView] = useState<CatalogView>("releases");
  const [catalogSearch, setCatalogSearch] = useState("");
  const [songRecommendations, setSongRecommendations] = useState<SongRecommendationItem[]>([]);
  const [startingSeed, setStartingSeed] = useState<string | null>(null);
  const [startingVibe, setStartingVibe] = useState<FilterId | null>(null);
  const [tracksToAddToPlaylist, setTracksToAddToPlaylist] = useState<LocalTrack[] | null>(null);
  const [savingReleaseId, setSavingReleaseId] = useState<string | null>(null);
  const { status, token, userId } = useAuth();
  const { addToast } = useToast();
  const { playQueue } = usePlayer();
  const activeFilterConfig = useMemo(
    () => FILTERS.find((filter) => filter.id === activeFilter) ?? FILTERS[0],
    [activeFilter],
  );

  useWebSockets((data: ReleaseStatusUpdate) => {
    if (data.status === "ready") {
      addToast({
        type: "success",
        title: "Release Ready",
        message: `"${data.title}" is now available in your studio!`,
        onClick: () => router.push(`/release/${data.releaseId}`),
      });
    }
  });

  useEffect(() => {
    listPublishedReleases(48)
      .then(setReleases)
      .catch(() => setReleases([]));
  }, [status]);

  useEffect(() => {
    if (status !== "authenticated" || !token) {
      setSongRecommendations([]);
      return;
    }

    let cancelled = false;
    listMyReleases(token)
      .then((items) => {
        if (!cancelled) setMyReleases(items);
      })
      .catch(() => {
        if (!cancelled) setMyReleases([]);
      });

    return () => {
      cancelled = true;
    };
  }, [status, token]);

  useEffect(() => {
    if (status !== "authenticated" || !token || !userId) {
      setSongRecommendations([]);
      return;
    }

    let cancelled = false;
    getSongRecommendations(userId, token, 6, recommendationPreferencesForFilter(activeFilterConfig))
      .then((result) => {
        if (!cancelled) setSongRecommendations(result.items ?? []);
      })
      .catch(() => {
        if (!cancelled) setSongRecommendations([]);
      });

    return () => {
      cancelled = true;
    };
  }, [activeFilterConfig, status, token, userId]);

  const displayReleases = releases;

  // Client-side filter (genre match on `release.genre`, case-insensitive).
  const filteredReleases = useMemo<Release[]>(() => {
    if (activeFilterConfig.kind === "all") return displayReleases;
    return displayReleases.filter((release) => releaseMatchesFilter(release, activeFilterConfig));
  }, [activeFilterConfig, displayReleases]);

  // Row data derivation.
  const resumeRow = filteredReleases.slice(0, 4);
  const stemRow = filteredReleases.slice(0, 3);
  const campaigns = listCampaignsSync();
  const featuredCampaign = getFeaturedCampaignSync();
  const eventRow: Campaign[] = campaigns.slice(0, 2);
  const catalogStems = useMemo<StemSummary[]>(
    () => flattenStems(displayReleases),
    [displayReleases],
  );
  const catalogArtists = useMemo<ArtistSummary[]>(
    () => summarizeCreditedArtists(displayReleases),
    [displayReleases],
  );
  const normalizedSearch = catalogSearch.trim().toLowerCase();
  const browseReleases = useMemo(
    () => filterReleases(displayReleases, normalizedSearch).slice(0, 18),
    [displayReleases, normalizedSearch],
  );
  const browseArtists = useMemo(
    () => filterArtists(catalogArtists, normalizedSearch).slice(0, 12),
    [catalogArtists, normalizedSearch],
  );
  const browseStems = useMemo(
    () => filterStems(catalogStems, normalizedSearch).slice(0, 12),
    [catalogStems, normalizedSearch],
  );
  const recommendedForYou = useMemo(
    () => buildHomeRecommendations(songRecommendations, displayReleases).slice(0, 4),
    [songRecommendations, displayReleases],
  );
  const managedArtists = summarizeManagedArtists(status === "authenticated" ? myReleases : []).slice(0, 5);
  const recentUploads = (status === "authenticated" ? myReleases : [])
    .slice()
    .sort((a, b) => getReleaseTime(b) - getReleaseTime(a))
    .slice(0, 4);

  // Derive top artists from the catalog (de-dup by primary artist name).
  const topArtists = useMemo(() => {
    return catalogArtists.slice(0, 8).map((a) => ({
      name: a.name,
      artistId: a.artistId,
    }));
  }, [catalogArtists]);

  const handleStartRecommendedSession = async (recommendation: HomeRecommendation) => {
    const seedGenre = recommendation.moods?.[0] || recommendation.genre || recommendation.reasons[0]?.replace(/^(genre|mood):/, "") || "Discovery";
    const seedKey = recommendation.trackId || recommendation.releaseId || recommendation.key;
    if (status !== "authenticated" || !token) {
      addToast({
        type: "info",
        title: "Connect wallet",
        message: "Open AI DJ to start a personalized session.",
      });
      router.push("/agent");
      return;
    }

    setStartingSeed(seedKey);
    try {
      const existing = await getAgentConfig(token);
      const vibes = [seedGenre].filter(Boolean);
      if (existing) {
        await updateAgentConfig(token, { vibes, sessionMode: "curate" });
      } else {
        await createAgentConfig(token, {
          name: "Home DJ",
          vibes,
          monthlyCapUsd: 10,
        });
      }
      const result = await startAgentSession(token);
      if (result.status === "started") {
        addToast({
          type: "success",
          title: "Session started",
          message: `${recommendation.title} seeded your AI DJ.`,
        });
      } else {
        addToast({
          type: "info",
          title: "AI DJ ready",
          message: "Open the dashboard to finish session setup.",
        });
      }
      router.push("/agent");
    } catch (error) {
      addToast({
        type: "error",
        title: "Session start failed",
        message: error instanceof Error ? error.message : "Unable to start AI DJ.",
      });
    } finally {
      setStartingSeed(null);
    }
  };

  const handleStartVibeSession = async (filter: FilterOption) => {
    if (filter.kind === "all") return;
    const vibe = filter.value || filter.label;
    if (status !== "authenticated" || !token) {
      addToast({
        type: "info",
        title: "Connect wallet",
        message: `Open AI DJ to start a ${filter.label} vibe session.`,
      });
      router.push("/agent");
      return;
    }

    setStartingVibe(filter.id);
    try {
      const queue = buildVibeQueue(recommendedForYou, filteredReleases);
      if (queue.length > 0) {
        await saveTracksMetadata(queue, "remote");
        await playQueue(queue, 0);
      }

      const existing = await getAgentConfig(token);
      if (existing) {
        await updateAgentConfig(token, { vibes: [vibe], sessionMode: "curate" });
      } else {
        await createAgentConfig(token, {
          name: `${filter.label} DJ`,
          vibes: [vibe],
          monthlyCapUsd: 10,
        });
      }

      const result = await startAgentSession(token);
      const firstTrack = queue[0]?.catalogTrackId || queue[0]?.id;
      if (firstTrack) {
        await recordAgentSignal(token, {
          trackId: firstTrack,
          action: "accept",
          sessionId: result.sessionId,
          metadata: {
            source: "home_vibe_session",
            vibe,
            filterKind: filter.kind,
            autoQueuedTracks: queue.length,
          },
        }).catch(() => undefined);
      }

      addToast({
        type: "success",
        title: `${filter.label} session started`,
        message: queue.length > 0
          ? `${queue.length} matching track${queue.length > 1 ? "s" : ""} queued.`
          : "AI DJ is ready with your vibe.",
      });
      router.push("/agent");
    } catch (error) {
      addToast({
        type: "error",
        title: "Vibe session failed",
        message: error instanceof Error ? error.message : "Unable to start this vibe session.",
      });
    } finally {
      setStartingVibe(null);
    }
  };

  const getReleaseActionTracks = (release: Release) => mapReleaseToLocalTracks(release);

  const handleAddReleaseToPlaylist = (release: Release) => {
    const tracks = getReleaseActionTracks(release);
    if (tracks.length === 0) {
      addToast({
        type: "info",
        title: "No tracks yet",
        message: `${release.title} does not have playable tracks in the catalog yet.`,
      });
      return;
    }
    setTracksToAddToPlaylist(tracks);
  };

  const handleSaveReleaseToLibrary = async (release: Release) => {
    const tracks = getReleaseActionTracks(release);
    if (tracks.length === 0) {
      addToast({
        type: "info",
        title: "No tracks yet",
        message: `${release.title} does not have playable tracks in the catalog yet.`,
      });
      return;
    }

    setSavingReleaseId(release.id);
    try {
      await saveTracksMetadata(tracks, "remote");
      addToast({
        type: "success",
        title: "Saved to Library",
        message: `Saved ${tracks.length} track${tracks.length > 1 ? "s" : ""} from ${release.title}.`,
      });
    } catch (error) {
      console.error("Failed to save catalog release to library:", error);
      addToast({
        type: "error",
        title: "Save failed",
        message: "Could not save this release to your library.",
      });
    } finally {
      setSavingReleaseId(null);
    }
  };

  return (
    <div className="home-ng">
      <main className="ng-main">
        {/* 1. HERO ————————————————————————————————————————————————— */}
        <section className="ng-section ng-section--tight">
          <div className="ng-hero">
            <svg
              className="ng-hero__motif"
              viewBox="0 0 600 600"
              aria-hidden
              focusable="false"
            >
              <g fill="none" stroke="currentColor" strokeWidth="1">
                <circle cx="300" cy="300" r="60" opacity="0.55" />
                <circle cx="300" cy="300" r="120" opacity="0.40" />
                <circle cx="300" cy="300" r="190" opacity="0.26" />
                <circle cx="300" cy="300" r="270" opacity="0.16" />
                <circle cx="300" cy="300" r="360" opacity="0.08" />
              </g>
              <circle
                className="ng-hero__motif-ping"
                cx="300"
                cy="300"
                r="60"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
              />
              <circle cx="300" cy="300" r="6" fill="currentColor" opacity="0.9" />
            </svg>
            <div className="ng-hero__card">
              <span className="ng-kicker ng-kicker--primary">Featured Campaign</span>
              <h2 className="ng-hero__title">
                {featuredCampaign.artistName} in {featuredCampaign.city}
              </h2>
              <p className="ng-hero__body">
                {featuredCampaign.tagline} Lock funds in a smart contract to
                bring this show to life — refunded automatically if the
                threshold isn&apos;t met.
              </p>
              <div className="ng-hero__actions">
                <Link
                  href={`/shows/${featuredCampaign.id}`}
                  className="ng-btn ng-btn--primary"
                >
                  <span className="ms-icon" data-fill="1" aria-hidden>play_arrow</span>
                  Listen Now
                </Link>
                <Link href="/shows" className="ng-btn ng-btn--glass">
                  View Campaign
                </Link>
              </div>
            </div>
          </div>
        </section>

        {/* 2. FILTER CHIPS ———————————————————————————————————————— */}
        <div className="ng-chips" role="tablist" aria-label="Filter trending">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              role="tab"
              aria-selected={activeFilter === f.id}
              onClick={() => setActiveFilter(f.id)}
              className={`ng-chip ${activeFilter === f.id ? "ng-chip--active" : ""}`}
            >
              {f.label}
            </button>
          ))}
        </div>
        {activeFilterConfig.kind !== "all" && (
          <div className="ng-vibe-session-strip ng-glass">
            <div>
              <span className="ng-kicker ng-kicker--tertiary">Vibe session</span>
              <strong>{activeFilterConfig.label}</strong>
              <p>
                {filteredReleases.length} catalog match{filteredReleases.length === 1 ? "" : "es"} ready for this {activeFilterConfig.kind}.
              </p>
            </div>
            <button
              type="button"
              className="ng-btn ng-btn--primary"
              onClick={() => void handleStartVibeSession(activeFilterConfig)}
              disabled={startingVibe === activeFilterConfig.id}
            >
              <span className="ms-icon" data-fill="1" aria-hidden>
                {startingVibe === activeFilterConfig.id ? "hourglass_top" : "play_arrow"}
              </span>
              {startingVibe === activeFilterConfig.id ? "Starting" : "Start Vibe Session"}
            </button>
          </div>
        )}

        {/* 3. RECOMMENDED FOR YOU ——————————————————————————————— */}
        {recommendedForYou.length > 0 && (
          <section className="ng-section">
            <header className="ng-section-header">
              <div>
                <span className="ng-kicker ng-kicker--violet">Personalized picks</span>
                <h3 className="ng-section-title">Recommended for You</h3>
              </div>
              <Link href="/agent" className="ng-section-link">
                Open AI DJ
                <span className="ms-icon" aria-hidden style={{ fontSize: 14 }}>arrow_forward</span>
              </Link>
            </header>
            <div className="ng-recommendation-grid">
              {recommendedForYou.map((item) => {
                const seedKey = item.trackId || item.releaseId || item.key;
                return (
                  <article key={item.key} className="ng-recommendation-card ng-glass">
                    <Link
                      href={item.releaseId ? `/release/${item.releaseId}` : "/agent"}
                      className="ng-recommendation-card__art"
                      aria-label={`Open ${item.title}`}
                    >
                      {item.release?.artworkUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={item.release.artworkUrl} alt="" />
                      ) : (
                        <span className="ng-monogram" aria-hidden>
                          {(item.title[0] ?? "?").toUpperCase()}
                        </span>
                      )}
                      <span className="ng-recommendation-card__score">
                        {Math.round(item.score ?? 0)}
                      </span>
                    </Link>
                    <div className="ng-recommendation-card__body">
                      <h4>{item.title}</h4>
                      <p>{item.artist}</p>
                      <div className="ng-recommendation-card__meta">
                        <span>{item.genre || "Discovery"}</span>
                        <span>{formatRecommendationReason(item.reasons)}</span>
                      </div>
                      <button
                        type="button"
                        className="ng-recommendation-card__action"
                        onClick={() => void handleStartRecommendedSession(item)}
                        disabled={startingSeed === seedKey}
                      >
                        <span className="ms-icon" data-fill="1" aria-hidden>
                          {startingSeed === seedKey ? "hourglass_top" : "play_arrow"}
                        </span>
                        {startingSeed === seedKey ? "Starting" : "Start session"}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        )}

        {/* 3. CATALOG BROWSER ——————————————————————————————————— */}
        <section className="ng-section">
          <div className="ng-catalog-shell ng-glass">
            <header className="ng-catalog-header">
              <div>
                <span className="ng-kicker ng-kicker--violet">Global catalog</span>
                <h3 className="ng-section-title">Browse Everything</h3>
              </div>
              <label className="ng-catalog-search">
                <span className="ms-icon" aria-hidden>search</span>
                <input
                  value={catalogSearch}
                  onChange={(event) => setCatalogSearch(event.target.value)}
                  placeholder="Search releases, artists, stems"
                  aria-label="Search catalog"
                />
              </label>
            </header>

            <div className="ng-catalog-stats" aria-label="Catalog totals">
              <div>
                <strong>{displayReleases.length}</strong>
                <span>Releases</span>
              </div>
              <div>
                <strong>{catalogArtists.length}</strong>
                <span>Artists</span>
              </div>
              <div>
                <strong>{catalogStems.length}</strong>
                <span>Stems</span>
              </div>
            </div>

            <div className="ng-segmented" role="tablist" aria-label="Catalog view">
              {(["releases", "artists", "stems"] as const).map((view) => (
                <button
                  key={view}
                  type="button"
                  role="tab"
                  aria-selected={catalogView === view}
                  className={catalogView === view ? "ng-segmented__item active" : "ng-segmented__item"}
                  onClick={() => setCatalogView(view)}
                >
                  {view}
                </button>
              ))}
            </div>

            {catalogView === "releases" && (
              <div className="ng-resource-grid ng-resource-grid--releases">
                {browseReleases.length > 0 ? (
                  browseReleases.map((release) => (
                    <article
                      key={release.id}
                      className="ng-resource-card"
                    >
                      <Link
                        href={`/release/${release.id}`}
                        className="ng-resource-card__link"
                      >
                        <ReleaseThumb release={release} />
                        <div className="ng-resource-card__body">
                          <h4>{release.title}</h4>
                          <p>{getArtistName(release)}</p>
                          <div className="ng-resource-card__meta">
                            <span>{release.type || "Release"}</span>
                            <span>{release.genre || "Uncategorized"}</span>
                          </div>
                        </div>
                      </Link>
                      <div className="ng-resource-card__actions">
                        <button
                          type="button"
                          className="ng-resource-card__action"
                          onClick={() => handleAddReleaseToPlaylist(release)}
                          disabled={!release.tracks?.length}
                          aria-label={`Add ${release.title} to playlist`}
                          title="Add to playlist"
                        >
                          <span className="ms-icon" aria-hidden>playlist_add</span>
                        </button>
                        <button
                          type="button"
                          className="ng-resource-card__action"
                          onClick={() => void handleSaveReleaseToLibrary(release)}
                          disabled={!release.tracks?.length || savingReleaseId === release.id}
                          aria-label={`Save ${release.title} to library`}
                          title="Save to library"
                        >
                          <span className="ms-icon" data-fill={savingReleaseId === release.id ? "1" : undefined} aria-hidden>
                            {savingReleaseId === release.id ? "progress_activity" : "library_add"}
                          </span>
                        </button>
                      </div>
                    </article>
                  ))
                ) : (
                  <div className="ng-empty-state">
                    <span className="ms-icon" aria-hidden>album</span>
                    <p>No releases in the global catalog.</p>
                  </div>
                )}
              </div>
            )}

            {catalogView === "artists" && (
              <div className="ng-artist-browser">
                {browseArtists.length > 0 ? (
                  browseArtists.map((artist) => {
                    const rowContent = (
                      <>
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
                      </>
                    );

                    return (
                      <Link
                        key={artist.key}
                        href={artist.artistId ? artistProfileHref(artist.artistId) : catalogArtistHref(artist.name)}
                        className="ng-artist-row"
                      >
                        {rowContent}
                      </Link>
                    );
                  })
                ) : (
                  <div className="ng-empty-state">
                    <span className="ms-icon" aria-hidden>person_search</span>
                    <p>No artists in the global catalog.</p>
                  </div>
                )}
              </div>
            )}

            {catalogView === "stems" && (
              <div className="ng-stem-browser">
                {browseStems.length > 0 ? (
                  browseStems.map((stem) => (
                    <Link
                      key={stem.id}
                      href={`/release/${stem.releaseId}?mixer=true`}
                      className="ng-stem-row"
                    >
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
                  <div className="ng-empty-state">
                    <span className="ms-icon" aria-hidden>graphic_eq</span>
                    <p>No stems are exposed in this catalog slice yet.</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>

        {/* 4. UPLOAD OPERATIONS ——————————————————————————————— */}
        <section className="ng-section">
          <div className="ng-ops-grid">
            <article className="ng-ops-panel ng-glass">
              <header className="ng-ops-panel__header">
                <div>
                  <span className="ng-kicker ng-kicker--tertiary">Managed artists</span>
                  <h3 className="ng-section-title">Managed Catalog</h3>
                </div>
                <Link href="/artist/catalog" className="ng-icon-link" aria-label="Open managed catalog">
                  <span className="ms-icon" aria-hidden>table_rows</span>
                </Link>
              </header>
              <div className="ng-uploader-list">
                {managedArtists.length > 0 ? managedArtists.map((artist) => (
                  artist.artistId ? (
                    <Link
                      key={artist.key}
                      href={artistProfileHref(artist.artistId)}
                      className="ng-uploader-row"
                    >
                      <span className="ng-uploader-row__avatar" aria-hidden>
                        {artist.name[0]?.toUpperCase() ?? "?"}
                      </span>
                      <span className="ng-uploader-row__main">
                        <strong>{artist.name}</strong>
                        <small>{formatRelativeTime(artist.latestAt)}</small>
                      </span>
                      <span className="ng-uploader-row__count">
                        {artist.releaseCount}
                        <small>releases</small>
                      </span>
                    </Link>
                  ) : (
                    <div key={artist.key} className="ng-uploader-row">
                    <span className="ng-uploader-row__avatar" aria-hidden>
                      {artist.name[0]?.toUpperCase() ?? "?"}
                    </span>
                    <span className="ng-uploader-row__main">
                      <strong>{artist.name}</strong>
                      <small>{formatRelativeTime(artist.latestAt)}</small>
                    </span>
                    <span className="ng-uploader-row__count">
                      {artist.releaseCount}
                      <small>releases</small>
                    </span>
                    </div>
                  )
                )) : (
                  <div className="ng-empty-state">
                    <span className="ms-icon" aria-hidden>person_add</span>
                    <p>No managed artist catalog yet.</p>
                  </div>
                )}
              </div>
            </article>

            <article className="ng-ops-panel ng-glass">
              <header className="ng-ops-panel__header">
                <div>
                  <span className="ng-kicker ng-kicker--primary">Release queue</span>
                  <h3 className="ng-section-title">Latest Releases</h3>
                </div>
                <Link href="/artist/catalog" className="ng-icon-link" aria-label="Open full release inventory">
                  <span className="ms-icon" aria-hidden>table_rows</span>
                </Link>
              </header>

              {status === "authenticated" ? (
                recentUploads.length > 0 ? (
                  <div className="ng-upload-list">
                    {recentUploads.map((release) => (
                      <Link
                        key={release.id}
                        href={`/release/${release.id}`}
                        className="ng-upload-row"
                      >
                        <ReleaseThumb release={release} small />
                        <span className="ng-upload-row__main">
                          <strong>{release.title}</strong>
                          <small>{getReleaseResourceCount(release)} resources · {formatRelativeTime(getReleaseTime(release))}</small>
                        </span>
                        <span className={`ng-status-pill ${getStatusClass(release.status)}`}>
                          {formatStatus(release.status)}
                        </span>
                      </Link>
                    ))}
                  </div>
                ) : (
                  <div className="ng-empty-state">
                    <span className="ms-icon" aria-hidden>upload_file</span>
                    <p>No releases yet.</p>
                    <Link href="/artist/upload" className="ng-btn ng-btn--primary">
                      Upload release
                    </Link>
                  </div>
                )
              ) : (
                <div className="ng-empty-state">
                  <span className="ms-icon" aria-hidden>lock</span>
                  <p>Connect a wallet to manage artist profiles and releases.</p>
                </div>
              )}
            </article>
          </div>
        </section>

        {/* 5. RESUME PLAYING ———————————————————————————————————— */}
        {resumeRow.length > 0 && (
          <section className="ng-section">
            <header className="ng-section-header">
              <div>
                <span className="ng-kicker ng-kicker--violet">Continue your journey</span>
                <h3 className="ng-section-title">Resume Playing</h3>
              </div>
              <Link href="/library" className="ng-section-link">
                View history
                <span className="ms-icon" aria-hidden style={{ fontSize: 14 }}>arrow_forward</span>
              </Link>
            </header>
            <div className="ng-grid-4">
              {resumeRow.map((r) => (
                <Link
                  key={r.id}
                  href={`/release/${r.id}`}
                  className="ng-play-card ng-glass"
                  style={{ borderRadius: 20 }}
                >
                  <div className="ng-play-card__art">
                    {r.artworkUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={r.artworkUrl} alt={r.title} />
                    ) : (
                      <span className="ng-monogram" aria-hidden>
                        {(r.title?.[0] ?? "?").toUpperCase()}
                      </span>
                    )}
                    <div className="ng-play-card__overlay">
                      <span className="ms-icon" data-fill="1" aria-hidden>play_circle</span>
                    </div>
                  </div>
                  <h4 className="ng-play-card__title">{r.title}</h4>
                  <p className="ng-play-card__artist">
                    Artist: {r.primaryArtist || r.artist?.displayName || "Unknown"}
                  </p>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* 6. TRENDING STEMS ———————————————————————————————————— */}
        {stemRow.length > 0 && (
          <section className="ng-section">
            <header className="ng-section-header">
              <div>
                <span className="ng-kicker ng-kicker--tertiary">Granular breakdowns</span>
                <h3 className="ng-section-title">Trending Stems</h3>
              </div>
            </header>
            <div className="ng-grid-3">
              {stemRow.map((r, i) => (
                <StemCard key={`${r.id}-stem`} release={r} variantIndex={i} />
              ))}
            </div>
          </section>
        )}

        {/* 7. UPCOMING LIVE EVENTS ————————————————————————————— */}
        {eventRow.length > 0 && (
          <section className="ng-section">
            <header className="ng-section-header">
              <div>
                <span className="ng-kicker ng-kicker--tertiary">Real-time performance</span>
                <h3 className="ng-section-title">Upcoming Live Events</h3>
              </div>
              <Link href="/shows" className="ng-section-link">
                Browse all
                <span className="ms-icon" aria-hidden style={{ fontSize: 14 }}>arrow_forward</span>
              </Link>
            </header>
            <div className="ng-grid-2">
              {eventRow.map((c, idx) => (
                <EventCard key={c.id} campaign={c} variant={idx === 0 ? "live" : "upcoming"} />
              ))}
            </div>
          </section>
        )}

        {/* 8. AI DJ SESSION PRESETS ————————————————————————————— */}
        <section className="ng-section ng-section--presets">
          <AgentSessionPresets compact />
        </section>

        {/* 9. TOP ARTISTS —————————————————————————————————————— */}
        {topArtists.length > 0 && (
          <section className="ng-section">
            <header className="ng-section-header">
              <div>
                <span className="ng-kicker ng-kicker--violet">Pioneer network</span>
                <h3 className="ng-section-title">Top Artists</h3>
              </div>
            </header>
            <div className="ng-artist-pills">
              {topArtists.map((a) => {
                const pillContent = (
                  <>
                    <span className="ng-artist-pill__avatar" aria-hidden>
                      {a.name[0]?.toUpperCase() ?? "?"}
                    </span>
                    <span>{a.name}</span>
                  </>
                );

                return (
                  <Link
                    key={a.name}
                    href={a.artistId ? artistProfileHref(a.artistId) : catalogArtistHref(a.name)}
                    className="ng-artist-pill"
                  >
                    {pillContent}
                  </Link>
                );
              })}
            </div>
          </section>
        )}
      </main>
      <AddToPlaylistModal
        tracks={tracksToAddToPlaylist}
        onClose={() => setTracksToAddToPlaylist(null)}
      />
    </div>
  );
}

function ReleaseThumb({ release, small = false }: { release: Release; small?: boolean }) {
  return (
    <span className={small ? "ng-release-thumb ng-release-thumb--small" : "ng-release-thumb"}>
      {release.artworkUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={release.artworkUrl} alt="" />
      ) : (
        <span aria-hidden>{(release.title?.[0] ?? "?").toUpperCase()}</span>
      )}
    </span>
  );
}

function getArtistName(release: Release) {
  return release.primaryArtist || release.artist?.displayName || "Unknown Artist";
}

function getArtistProfileName(release: Release) {
  return release.artist?.displayName || release.primaryArtist || "Unknown Artist";
}

function normalizeArtistName(value?: string | null) {
  return (value || "").trim().toLowerCase();
}

function normalizeArtistCreditValue(value?: string | null) {
  return (value || "")
    .trim()
    .toLowerCase()
    .replace(/^[\s._-]*\d+[\s._-]+/, "")
    .replace(/[\s._-]+/g, " ");
}

function getReleaseCreditProfileId(release: Release) {
  const primaryArtist = normalizeArtistName(release.primaryArtist);
  const profileName = normalizeArtistName(release.artist?.displayName);
  if (!release.artist?.id) return null;
  return !primaryArtist || primaryArtist === profileName ? release.artist.id : null;
}

function getTrackArtistName(track: Track, release: Release) {
  const trackArtist = track.artist?.trim();
  const releaseArtist = getArtistName(release);
  if (!trackArtist) return releaseArtist;

  if (normalizeArtistCreditValue(trackArtist) === normalizeArtistCreditValue(track.title)) {
    return releaseArtist;
  }

  return trackArtist;
}

function getReleaseTime(release: Release) {
  const raw = release.releaseDate || release.createdAt;
  const time = raw ? new Date(raw).getTime() : 0;
  return Number.isFinite(time) ? time : 0;
}

function getReleaseResourceCount(release: Release) {
  const stemCount = release.tracks?.reduce(
    (sum, track) => sum + (track.stems?.length ?? 0),
    0,
  ) ?? 0;
  return Math.max(1, 1 + stemCount);
}

function getTrackDuration(track: Track) {
  return track.stems?.[0]?.durationSeconds ?? null;
}

function isMixerStem(type?: string | null) {
  const normalized = type?.trim().toLowerCase();
  return !!normalized && normalized !== "original" && normalized !== "master";
}

function mapReleaseToLocalTracks(release: Release): LocalTrack[] {
  return (release.tracks ?? []).map((track) => ({
    id: track.id,
    title: track.title,
    artist: getTrackArtistName(track, release),
    albumArtist: null,
    album: release.title,
    year: release.releaseDate ? new Date(release.releaseDate).getFullYear() : null,
    genre: release.genre || null,
    duration: getTrackDuration(track),
    createdAt: track.createdAt ? new Date(track.createdAt).toISOString() : release.createdAt,
    catalogTrackId: track.id,
    artistId: release.artist?.id || release.artistId,
    releaseId: release.id,
    remoteUrl: getReleaseTrackStreamUrl(release.id, track.id),
    remoteArtworkUrl: release.artworkUrl || undefined,
    source: "remote",
    stems: track.stems?.map((stem) => ({
      id: stem.id,
      type: stem.type,
      uri: isMixerStem(stem.type) ? getStemPreviewUrl(stem.id) : stem.uri,
      durationSeconds: stem.durationSeconds,
      isEncrypted: isMixerStem(stem.type) ? false : stem.isEncrypted,
      encryptionMetadata: isMixerStem(stem.type) ? null : stem.encryptionMetadata,
    })),
  }));
}

function flattenStems(releases: Release[]): StemSummary[] {
  return releases.flatMap((release) =>
    (release.tracks ?? []).flatMap((track) =>
      (track.stems ?? []).map((stem) => ({
        id: stem.id,
        releaseId: release.id,
        releaseTitle: release.title,
        title: stem.title || track.title,
        type: stem.type || "stem",
        artistName: stem.artist || getTrackArtistName(track, release),
        artworkUrl: stem.artworkUrl || release.artworkUrl,
        createdAt: track.createdAt || release.createdAt,
      })),
    ),
  );
}

function summarizeCreditedArtists(releases: Release[]): ArtistSummary[] {
  const byArtist = new Map<string, ArtistSummary>();

  for (const release of releases) {
    const name = getArtistName(release);
    const key = normalizeArtistName(name) || release.id;
    const artistId = getReleaseCreditProfileId(release);
    const stemCount = release.tracks?.reduce(
      (sum, track) => sum + (track.stems?.length ?? 0),
      0,
    ) ?? 0;
    const latestAt = getReleaseTime(release);
    const existing = byArtist.get(key);

    if (!existing) {
      byArtist.set(key, {
        key,
        name,
        artistId,
        releaseCount: 1,
        stemCount,
        latestRelease: release,
        latestAt,
        genres: new Set(release.genre ? [release.genre] : []),
      });
      continue;
    }

    existing.releaseCount += 1;
    existing.stemCount += stemCount;
    if (release.genre) existing.genres.add(release.genre);
    if (!existing.artistId && artistId) existing.artistId = artistId;
    if (latestAt > existing.latestAt) {
      existing.latestAt = latestAt;
      existing.latestRelease = release;
    }
  }

  return Array.from(byArtist.values()).sort((a, b) => b.latestAt - a.latestAt);
}

function summarizeManagedArtists(releases: Release[]): ArtistSummary[] {
  const byArtist = new Map<string, ArtistSummary>();

  for (const release of releases) {
    const name = getArtistProfileName(release);
    const artistId = release.artist?.id || release.artistId || null;
    const key = artistId || normalizeArtistName(name) || release.id;
    const stemCount = release.tracks?.reduce(
      (sum, track) => sum + (track.stems?.length ?? 0),
      0,
    ) ?? 0;
    const latestAt = getReleaseTime(release);
    const existing = byArtist.get(key);

    if (!existing) {
      byArtist.set(key, {
        key,
        name,
        artistId,
        releaseCount: 1,
        stemCount,
        latestRelease: release,
        latestAt,
        genres: new Set(release.genre ? [release.genre] : []),
      });
      continue;
    }

    existing.releaseCount += 1;
    existing.stemCount += stemCount;
    if (release.genre) existing.genres.add(release.genre);
    if (!existing.artistId && artistId) existing.artistId = artistId;
    if (latestAt > existing.latestAt) {
      existing.latestAt = latestAt;
      existing.latestRelease = release;
    }
  }

  return Array.from(byArtist.values()).sort((a, b) => b.latestAt - a.latestAt);
}

function filterReleases(releases: Release[], query: string) {
  if (!query) return releases;
  return releases.filter((release) =>
    [
      release.title,
      getArtistName(release),
      release.genre,
      release.label,
      release.type,
    ].some((value) => value?.toLowerCase().includes(query)),
  );
}

function filterArtists(artists: ArtistSummary[], query: string) {
  if (!query) return artists;
  return artists.filter((artist) =>
    [
      artist.name,
      artist.latestRelease?.title,
      ...Array.from(artist.genres),
    ].some((value) => value?.toLowerCase().includes(query)),
  );
}

function filterStems(stems: StemSummary[], query: string) {
  if (!query) return stems;
  return stems.filter((stem) =>
    [
      stem.title,
      stem.type,
      stem.releaseTitle,
      stem.artistName,
    ].some((value) => value.toLowerCase().includes(query)),
  );
}

function recommendationPreferencesForFilter(filter: FilterOption) {
  if (filter.kind === "genre" && filter.value) {
    return { genres: [filter.value], energy: filter.energy };
  }
  if (filter.kind === "mood" && filter.value) {
    return { mood: filter.value, energy: filter.energy };
  }
  return undefined;
}

function releaseMatchesFilter(release: Release, filter: FilterOption) {
  const value = filter.value?.toLowerCase();
  if (!value) return true;
  if (filter.kind === "genre") {
    return (release.genre ?? "").toLowerCase().replace(/[\s/]/g, "-").includes(filter.id);
  }
  if (filter.kind === "mood") {
    return (release.moods ?? []).some((mood) => mood.toLowerCase() === value)
      || release.title.toLowerCase().includes(value)
      || (release.genre ?? "").toLowerCase().includes(value);
  }
  return true;
}

function mapRecommendationToLocalTrack(item: HomeRecommendation): LocalTrack | null {
  const release = item.release;
  if (!release) return null;
  const tracks = mapReleaseToLocalTracks(release);
  return tracks.find((track) => track.catalogTrackId === item.trackId || track.id === item.trackId) ?? tracks[0] ?? null;
}

function buildVibeQueue(recommendations: HomeRecommendation[], releases: Release[]) {
  const byId = new Map<string, LocalTrack>();
  for (const recommendation of recommendations) {
    const track = mapRecommendationToLocalTrack(recommendation);
    if (track) byId.set(track.id, track);
  }
  for (const release of releases) {
    for (const track of mapReleaseToLocalTracks(release)) {
      if (byId.size >= 12) break;
      byId.set(track.id, track);
    }
  }
  return Array.from(byId.values()).slice(0, 12);
}

function buildHomeRecommendations(
  items: SongRecommendationItem[],
  releases: Release[],
): HomeRecommendation[] {
  const releaseById = new Map(releases.map((release) => [release.id, release]));
  const releaseByTrackId = new Map<string, Release>();
  for (const release of releases) {
    for (const track of release.tracks ?? []) {
      releaseByTrackId.set(track.id, release);
    }
  }

  const mapped = items.map((item) => {
    const release = (item.releaseId ? releaseById.get(item.releaseId) : undefined)
      ?? releaseByTrackId.get(item.id);
    return {
      key: item.id,
      trackId: item.id,
      title: item.title,
      artist: item.artist || (release ? getArtistName(release) : "Unknown Artist"),
      releaseId: item.releaseId || release?.id,
      genre: item.genre ?? release?.genre,
      moods: item.moods ?? release?.moods ?? [],
      score: item.score,
      reasons: item.reasons ?? [],
      release,
    };
  });

  if (mapped.length > 0) {
    return mapped;
  }

  return releases.slice(0, 4).map((release) => ({
    key: release.id,
    title: release.title,
    artist: getArtistName(release),
    releaseId: release.id,
    genre: release.genre,
    moods: release.moods ?? [],
    score: release.genre ? 35 : 20,
    reasons: release.genre ? [`genre:${release.genre}`] : ["catalog_seed"],
    release,
  }));
}

function formatRecommendationReason(reasons: string[]) {
  const first = reasons.find(Boolean);
  if (!first) return "Catalog signal";
  if (first.startsWith("genre:")) return "Taste match";
  if (first.startsWith("mood:")) return "Mood match";
  return first.replace(/_/g, " ");
}

function formatStatus(status?: string | null) {
  if (!status) return "Draft";
  return status
    .toLowerCase()
    .split(/[_\s-]+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getStatusClass(status?: string | null) {
  return (status || "draft").toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
}

function formatRelativeTime(time: number) {
  if (!time) return "Recently active";
  const diffMs = Date.now() - time;
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(time).toLocaleDateString("en-GB", {
    month: "short",
    day: "numeric",
  });
}

/* ----------- Trending-stem card (deterministic waveform) --------- */

const STEM_TONES = ["primary", "tertiary", "secondary"] as const;
const STEM_TAGS = ["Drums", "Vocals", "Synth"] as const;
type StemTag = (typeof STEM_TAGS)[number];
const STEM_ACCENTS: Record<(typeof STEM_TONES)[number], string> = {
  primary: "var(--ds-primary-container)",
  tertiary: "var(--ds-tertiary)",
  secondary: "var(--ds-primary)",
};

// Maps the cosmetic card tag to a real mixer stem type from
// MIXER_STEM_TYPES (release/[id]/page.tsx:60). Tags that don't match
// any mixer channel (e.g. "Synth") return null so we fall back to
// "mixer-on, all stems audible" instead of soloing-to-silence.
const STEM_TAG_TO_MIXER: Record<StemTag, string | null> = {
  Drums: "drums",
  Vocals: "vocals",
  Synth: null,
};

function buildMixerHref(releaseId: string, tag: StemTag): string {
  const stem = STEM_TAG_TO_MIXER[tag];
  return stem
    ? `/release/${releaseId}?mixer=true&stem=${stem}`
    : `/release/${releaseId}?mixer=true`;
}

// Each stem sounds different, so its waveform should *look* different.
// Drums = sparse 4-on-the-floor kicks with ghost notes between.
// Vocals = smooth sinusoidal phrasing (rises and falls of a melody).
// Synth = staircase / saw-style oscillation (electronic, geometric).
const STEM_BAR_COUNT: Record<StemTag, number> = {
  Drums: 14,
  Vocals: 28,
  Synth: 18,
};

function shapeStemBars(tag: StemTag, base: number[]): number[] {
  if (tag === "Drums") {
    return base.map((v, i) => {
      const onBeat = i % 4 === 0;
      const offBeat = i % 4 === 2;
      if (onBeat) return 86 + (v % 14);
      if (offBeat) return 32 + (v % 22);
      return 14 + (v % 18);
    });
  }
  if (tag === "Vocals") {
    return base.map((v, i) => {
      const t = base.length > 1 ? i / (base.length - 1) : 0;
      const phrase = Math.sin(t * Math.PI * 2) * 0.4 + 0.6;
      const env = phrase * 70 + 18;
      const jitter = (v % 10) - 5;
      return Math.max(15, Math.min(95, env + jitter));
    });
  }
  // Synth — three-phase staircase (peak / mid / valley) with light drift.
  const heights = [85, 50, 28];
  return base.map((v, i) => {
    const phase = i % heights.length;
    const drift = (v % 12) - 6;
    return Math.max(20, Math.min(95, heights[phase] + drift));
  });
}

const STEM_ICONS: Record<StemTag, React.ReactNode> = {
  // Kick-drum: concentric circles read as a "drumhead" without leaning
  // on emoji or a skeuomorphic kit illustration.
  Drums: (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden>
      <circle cx="12" cy="12" r="9" opacity="0.35" />
      <circle cx="12" cy="12" r="6" opacity="0.65" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ),
  Vocals: (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 11v1a7 7 0 0 0 14 0v-1" />
      <line x1="12" y1="19" x2="12" y2="23" />
    </svg>
  ),
  // Oscilloscope envelope — reads as "synth signal" via shape alone.
  Synth: (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 12h3l2-7 4 14 2-7 2 4h5" />
    </svg>
  ),
};

function StemCard({ release, variantIndex }: { release: Release; variantIndex: number }) {
  const tone = STEM_TONES[variantIndex % STEM_TONES.length];
  const tag = STEM_TAGS[variantIndex % STEM_TAGS.length];
  const stemKey = tag.toLowerCase();
  const mixerHref = buildMixerHref(release.id, tag);
  const artistName = release.primaryArtist || release.artist?.displayName || "Unknown";
  // Deterministic bars seeded by release id so rerenders don't jitter,
  // shaped per-stem so each card has its own rhythmic fingerprint.
  const bars = useMemo(() => {
    const count = STEM_BAR_COUNT[tag];
    const base = pseudoRandomBars(release.id, count);
    return shapeStemBars(tag, base);
  }, [release.id, tag]);
  const peakIdx = bars.indexOf(Math.max(...bars));

  return (
    <article
      className="ng-stem-card"
      data-tone={tone}
      data-stem={stemKey}
      style={{ "--stem-tone": STEM_ACCENTS[tone] } as CSSProperties}
    >
      <Link
        href={mixerHref}
        className="ng-stem-card__art"
        aria-label={`Open ${release.title} in the mixer`}
      >
        {release.artworkUrl ? (
          <span
            className="ng-stem-card__image"
            style={{ backgroundImage: `url(${JSON.stringify(release.artworkUrl)})` }}
            aria-hidden
          />
        ) : (
          <span className="ng-monogram" aria-hidden>
            {(release.title?.[0] ?? "?").toUpperCase()}
          </span>
        )}
        <span className="ng-stem-card__shade" aria-hidden />
        <span className="ng-stem-card__motif" aria-hidden />
        <span className="ng-stem-card__tag">
          <span className="ng-stem-card__tag-icon" aria-hidden>{STEM_ICONS[tag]}</span>
          {tag}
        </span>
        <span className="ng-stem-card__play" aria-hidden>
          <span className="ms-icon" data-fill="1">play_arrow</span>
        </span>
        <span className="ng-stem-waveform" aria-hidden>
          {bars.map((h, i) => (
            <span
              key={i}
              className="ng-stem-waveform__bar"
              data-peak={i === peakIdx ? "true" : undefined}
              style={
                {
                  height: `${h}%`,
                  "--bar-opacity": `${20 + ((h * 70) / 100)}%`,
                  "--bar-index": i,
                } as CSSProperties
              }
            />
          ))}
        </span>
      </Link>
      <div className="ng-stem-card__body">
        <h5 className="ng-stem-card__title">{release.title}</h5>
        <p className="ng-stem-card__from">From: {artistName}</p>
        <div className="ng-stem-card__meta">
          <span>Stem layer</span>
          <span>Ready for mixer</span>
        </div>
        <div className="ng-stem-card__actions">
          <Link
            href={mixerHref}
            className="ng-stem-card__action ng-stem-card__action--flex"
            style={{ textAlign: "center" }}
          >
            Open Mixer
          </Link>
          <Link
            href={mixerHref}
            className="ng-stem-card__action ng-stem-card__action--icon"
            aria-label={
              STEM_TAG_TO_MIXER[tag]
                ? `Solo ${tag.toLowerCase()} in the mixer`
                : "Open in mixer"
            }
          >
            <span className="ms-icon" aria-hidden style={{ fontSize: 16 }}>graphic_eq</span>
          </Link>
        </div>
      </div>
    </article>
  );
}

function pseudoRandomBars(seed: string, count: number): number[] {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    hash = (hash * 1103515245 + 12345) | 0;
    const abs = Math.abs(hash);
    out.push(10 + (abs % 90));
  }
  return out;
}

/* ----------- Event card (campaign) ------------------------------- */

function EventCard({ campaign, variant }: { campaign: Campaign; variant: "live" | "upcoming" }) {
  const days = daysUntil(campaign.deadline);
  const badge = variant === "live"
    ? `Ends in ${days}d`
    : new Date(campaign.targetDate).toLocaleDateString("en-GB", { month: "short", day: "numeric" });

  return (
    <Link href={`/shows/${campaign.id}`} className="ng-event-card">
      <div className="ng-event-card__art" aria-hidden>
        <span className="ng-monogram" style={{ fontSize: 72 }}>
          {(campaign.artistName[0] ?? "?").toUpperCase()}
        </span>
      </div>
      <span
        className={`ng-event-card__badge ${
          variant === "live" ? "ng-event-card__badge--live" : "ng-event-card__badge--date"
        }`}
      >
        {badge}
      </span>
      <div className="ng-event-card__overlay">
        <div>
          <h4 className="ng-event-card__title">
            {campaign.artistName} in {campaign.city}
          </h4>
          <p className="ng-event-card__sub">
            {campaign.venue ? `${campaign.venue}` : `${campaign.backerCount} backers`}
          </p>
        </div>
      </div>
    </Link>
  );
}
