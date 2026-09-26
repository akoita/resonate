"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "../components/auth/AuthProvider";
import {
  createAgentConfig,
  fetchHomeFeed,
  fetchTopArtists,
  fetchTrendingTracks,
  getAgentConfig,
  getRelease,
  listMyReleases,
  listPublicPlaylists,
  listPublishedReleases,
  recordAgentSignal,
  Release,
  startAgentSession,
  updateAgentConfig,
  type HomeFeedItem,
  type HomeFeedResponse,
  type PublicPlaylistSummary,
  type TopArtistItem,
  type TrendingTrackItem,
} from "../lib/api";
import { artistProfileHref } from "../lib/artistRoutes";
import {
  filterPublicPlaylists,
  flattenCatalogStems,
  formatCount,
  getArtistName,
  getCatalogSortTime,
  groupCatalogStemsByTrack,
  summarizeCreditedArtists,
  summarizeManagedArtists,
  type CatalogArtistSummary,
  type CatalogStemSummary,
} from "../lib/catalogDisplay";
import { catalogArtistPlaybackTracks } from "../lib/catalogArtistPlayback";
import { mapReleaseToLocalTracks } from "../lib/catalogReleaseTracks";
import { CatalogArtistCard } from "../components/catalog/CatalogArtistCard";
import { CatalogPlaylistCard } from "../components/catalog/CatalogPlaylistCard";
import { CatalogReleaseCard } from "../components/catalog/CatalogReleaseCard";
import { CatalogStemTrackRow } from "../components/catalog/CatalogStemTrackRow";
import { AiDisclosureBadge } from "../components/content/AiDisclosureBadge";
import { HomeFeedRails } from "../components/home/HomeFeedRails";
import type { ArtistCoverFallback } from "../components/home/PopularityRails";
import { HomeCampaignVisual } from "../components/home/HomeCampaignVisual";
import { HomeReleaseArtwork } from "../components/home/HomeReleaseArtwork";
import { HomeTuner } from "../components/home/HomeTuner";
import { LiveEventRail } from "../components/home/LiveEventRail";
import { StemLab, selectStemLabEntries } from "../components/home/StemLab";
import { HomeHeroEmpty, HomeHeroMotif, HomeHeroSkeleton } from "../components/home/HomeHeroEmpty";
import { type LocalTrack, saveTracksMetadata } from "../lib/localLibrary";
import { usePlayer } from "../lib/playerContext";
import { useWebSockets, ReleaseStatusUpdate } from "../hooks/useWebSockets";
import { useToast } from "../components/ui/Toast";
import { useCatalogReleaseActions } from "../components/catalog/useCatalogReleaseActions";
import {
  campaignDisplayTitle,
  filterActionableCampaigns,
  listCampaigns,
  daysUntil,
  progressRatio,
  type Campaign,
} from "../lib/shows";
import { recordProductAnalytics } from "../lib/productAnalytics";

/*
 * Home page — "Home v3" (Resonance v3 visual system, 2026-09).
 *
 * Layout (top to bottom) — the listening experience leads and every section
 * below the hero uses the same shelf chrome (HomeShelf + HomeTile):
 *   1. Hero — featured campaign with the campaign rail (user-approved; frozen);
 *      a neutral skeleton while campaigns load and an honest "start a
 *      campaign" empty state when none is open (#1869) — never sample data
 *   2. Tuner — genre/mood filter, energy meter, one-tap vibe session / AI DJ
 *   3. Personalized feed — multi-rail shelves (#1454 WS-7)
 *   4. Trending Now — engagement-ranked tracks (#1451)
 *   5. Top Artists — engagement-ranked round portraits (#1451)
 *   6. Stem Lab — real mixer stems, each channel solos in the release mixer
 *   7. Upcoming Live Events — ticket-style campaign cards with funding progress
 *   8. Drops — collectible moments shelf (#1479)
 *   9. Recently Added — global catalog snapshot browser
 *  10. AI DJ session presets — intent-led mix modes
 *  11. Your studio — Managed Catalog + Your Releases panels
 *
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
type CatalogView = "releases" | "artists" | "stems" | "playlists";

const HOME_RELEASE_SNAPSHOT_LIMIT = 12;
const HOME_ARTIST_SNAPSHOT_LIMIT = 12;
const HOME_STEM_TRACK_SNAPSHOT_LIMIT = 6;
const HOME_PLAYLIST_SNAPSHOT_LIMIT = 12;
/** Snapshot window unit per view; the stems view lists one row per track. */
const CATALOG_SNAPSHOT_UNITS: Record<CatalogView, string> = {
  releases: "release",
  artists: "artist",
  stems: "track",
  playlists: "playlist",
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

/* ---------------------------------------------------------------------------
 * Below-the-fold sections are code-split (#1491).
 *
 * Above the fold — the `ng-hero` block and <HomeFeedRails> — stays statically
 * imported so first paint never waits on an extra chunk. Everything below the
 * fold (Trending Now, Drops, AI DJ presets, Top Artists) loads lazily, and each
 * one ships a `loading` skeleton built from the *same* layout primitives as the
 * real section so deferring the chunk does not collapse the box (no CLS).
 * ------------------------------------------------------------------------- */

/**
 * Shelf skeleton — same DOM/typography as the real `HomeShelf` (header + one
 * scroll-snapped row of tiles at the shelf's item width), so the reserved box
 * matches the loaded section at every breakpoint (no CLS, #1491).
 */
function ShelfSkeleton({
  kickerTone,
  kicker,
  title,
  meta,
  itemWidth,
  count,
  variant,
}: {
  kickerTone: "primary" | "tertiary" | "violet";
  kicker: string;
  title: string;
  meta?: string;
  itemWidth: number;
  count: number;
  variant: "tile" | "round" | "drop";
}) {
  const style = {
    "--shelf-item": `${itemWidth}px`,
    "--shelf-item-phone": `${Math.max(148, Math.round(itemWidth * 0.78))}px`,
  } as CSSProperties;
  return (
    <section className="ng-section ng-shelf ng-shelf--skeleton" aria-hidden style={style}>
      <header className="ng-shelf__header">
        <div className="ng-shelf__heading">
          <span className={`ng-kicker ng-kicker--${kickerTone}`}>{kicker}</span>
          <h3 className="ng-section-title">{title}</h3>
        </div>
        {meta ? (
          <div className="ng-shelf__aside">
            <span className="ng-shelf__meta">{meta}</span>
          </div>
        ) : null}
      </header>
      <div className="ng-shelf__track">
        {Array.from({ length: count }, (_, i) => (
          <div key={i} className="ng-shelf__item">
            {variant === "drop" ? (
              <div className="ng-shelf-skeleton__drop" />
            ) : (
              <article className={`ng-tile ng-tile--${variant === "round" ? "round" : "square"}`}>
                <div className="ng-tile__art" />
                <div className="ng-tile__body">
                  <span className="ng-tile__title">&nbsp;</span>
                  {variant === "tile" ? <p className="ng-tile__subtitle">&nbsp;</p> : null}
                  <p className="ng-tile__meta">&nbsp;</p>
                </div>
              </article>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * Trending Now placeholder: header (with the "Last 7 days" pill) + one row of
 * square tiles at the real 196px item width. The rail is only mounted once its
 * data has resolved (see the call site), so one row is the right reserve.
 */
function TrendingNowRailSkeleton() {
  return (
    <ShelfSkeleton
      kickerTone="tertiary"
      kicker="What listeners play"
      title="Trending Now"
      meta="Last 7 days"
      itemWidth={196}
      count={6}
      variant="tile"
    />
  );
}

/** Top Artists placeholder: header + one row of round portrait tiles (148px). */
function TopArtistsRailSkeleton() {
  return (
    <ShelfSkeleton
      kickerTone="violet"
      kicker="Most listened, last 7 days"
      title="Top Artists"
      itemWidth={148}
      count={8}
      variant="round"
    />
  );
}

/**
 * Drops placeholder: header + one row of 280px collectible-card blanks (square
 * collectible art plus the body/footer strip the real card carries).
 */
function DropsShelfSkeleton() {
  return (
    <ShelfSkeleton
      kickerTone="violet"
      kicker="Own a piece of the hook"
      title="Drops"
      itemWidth={280}
      count={4}
      variant="drop"
    />
  );
}

/**
 * AI DJ presets placeholder: the panel chrome plus the 5-up preset grid whose
 * cards are `min-height: 214px` in the real component, so the reserved box
 * matches the desktop layout (the narrow-viewport 3-up / swipe variants are
 * approximated, since the real breakpoints live in the component's styled-jsx).
 */
function AgentSessionPresetsSkeleton() {
  return (
    <div
      aria-hidden
      style={{
        border: "1px solid rgba(255, 255, 255, 0.08)",
        borderRadius: 20,
        padding: 22,
        background:
          "linear-gradient(135deg, rgba(255, 255, 255, 0.055), rgba(255, 255, 255, 0.018))",
      }}
    >
      <div style={{ height: 130, marginBottom: 22 }} />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
          gap: 12,
        }}
      >
        {[0, 1, 2, 3, 4].map((i) => (
          <div
            key={i}
            style={{
              minHeight: 214,
              borderRadius: 16,
              border: "1px solid rgba(255, 255, 255, 0.08)",
              background: "rgba(8, 8, 15, 0.74)",
            }}
          />
        ))}
      </div>
    </div>
  );
}

// Both rails are named exports of the same module; each dynamic import selects
// its own export. `ssr: false` costs no crawlable content: the rails render
// `null` until the client-side /catalog/trending + /catalog/top-artists fetches
// resolve, so their server output is empty today either way.
const TrendingNowRail = dynamic(
  () => import("../components/home/PopularityRails").then((m) => m.TrendingNowRail),
  { ssr: false, loading: () => <TrendingNowRailSkeleton /> },
);

const TopArtistsRail = dynamic(
  () => import("../components/home/PopularityRails").then((m) => m.TopArtistsRail),
  { ssr: false, loading: () => <TopArtistsRailSkeleton /> },
);

// Client-only by construction: it fetches featured drops on mount and emits
// `punchline.drop_viewed` analytics with the viewer's token, so it never
// contributes server-rendered content.
const DropsShelf = dynamic(
  () => import("../components/home/DropsShelf").then((m) => m.DropsShelf),
  { ssr: false, loading: () => <DropsShelfSkeleton /> },
);

// Kept server-rendered (default `ssr: true`): the presets are static, crawlable
// product copy (intent, tempo, licensing posture) with no client data
// dependency — only the chunk is deferred, not the content.
const AgentSessionPresets = dynamic(
  () => import("../components/agent/AgentSessionPresets"),
  { loading: () => <AgentSessionPresetsSkeleton /> },
);

export default function Home() {
  const router = useRouter();
  const [releases, setReleases] = useState<Release[]>([]);
  const [publicPlaylists, setPublicPlaylists] = useState<PublicPlaylistSummary[]>([]);
  const [myReleases, setMyReleases] = useState<Release[]>([]);
  const [activeFilter, setActiveFilter] = useState<FilterId>("all");
  const [catalogView, setCatalogView] = useState<CatalogView>("releases");
  const [catalogSearch, setCatalogSearch] = useState("");
  // #1454 WS-7: multi-rail personalized feed. null = loading, [] rails = honest empty.
  const [homeFeed, setHomeFeed] = useState<HomeFeedResponse | null>(null);
  const [startingSeed, setStartingSeed] = useState<string | null>(null);
  const [startingVibe, setStartingVibe] = useState<FilterId | null>(null);
  // #1869: null = not loaded yet (hero skeleton); [] = resolved, none open
  // (honest empty hero). Never seeded with sample campaigns.
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null);
  const [activeHeroCampaignId, setActiveHeroCampaignId] = useState("");
  const [heroPaused, setHeroPaused] = useState(false);
  const lastCatalogSearchAnalyticsKeyRef = useRef<string | null>(null);
  const { status, token, userId } = useAuth();
  const { addToast } = useToast();
  const { playQueue } = usePlayer();
  const { releaseActions } = useCatalogReleaseActions();
  const activeFilterConfig = useMemo(
    () => FILTERS.find((filter) => filter.id === activeFilter) ?? FILTERS[0],
    [activeFilter],
  );
  const actionableCampaigns = useMemo(() => filterActionableCampaigns(campaigns ?? []), [campaigns]);

  useWebSockets((data: ReleaseStatusUpdate) => {
    // Keep the "Your Releases" panel live without a manual reload. The backend
    // broadcasts release.status to every client, so only react to releases that
    // belong to this user's panel: patch the status badge immediately for
    // instant feedback, then refetch the authoritative release so resource
    // counts (stems created during processing) reconcile too.
    if (myReleases.some((release) => release.id === data.releaseId)) {
      setMyReleases((prev) =>
        prev.map((release) =>
          release.id === data.releaseId ? { ...release, status: data.status } : release,
        ),
      );

      if (token) {
        getRelease(data.releaseId, token)
          .then((fresh) => {
            if (!fresh) return;
            setMyReleases((prev) =>
              prev.map((release) => (release.id === fresh.id ? fresh : release)),
            );
          })
          .catch(() => undefined);
      }
    }

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
    let cancelled = false;
    listPublicPlaylists(HOME_PLAYLIST_SNAPSHOT_LIMIT)
      .then((items) => {
        if (!cancelled) setPublicPlaylists(items);
      })
      .catch(() => {
        if (!cancelled) setPublicPlaylists([]);
      });
    return () => {
      cancelled = true;
    };
  }, [status]);

  useEffect(() => {
    let cancelled = false;
    listCampaigns()
      .then((items) => {
        if (!cancelled) setCampaigns(items);
      })
      .catch(() => {
        if (!cancelled) setCampaigns([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (status !== "authenticated" || !token) {
      setMyReleases([]);
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
      setHomeFeed(null);
      return;
    }

    let cancelled = false;
    fetchHomeFeed(userId, token)
      .then((feed) => {
        if (cancelled) return;
        setHomeFeed(feed);
        // #1449 WS-2: Home ranking impressions — one served event per rail.
        for (const rail of feed.rails) {
          if (!rail.items.length) continue;
          void recordProductAnalytics(token, "recommendation.served", {
            payload: {
              requestId: feed.requestId,
              railId: rail.id,
              trackIds: rail.items.map((item) => item.id),
              count: rail.items.length,
              source: "home",
            },
          });
        }
      })
      .catch(() => {
        if (!cancelled) setHomeFeed(null);
      });

    return () => {
      cancelled = true;
    };
  }, [status, token, userId]);

  // #1451 WS-4: true engagement-ranked rails from the popularity serving
  // tables. Genre chips re-rank server-side; when the data is below the
  // minimum-audience threshold the rails say so honestly instead of quietly
  // falling back to recency.
  const popularityGenre =
    activeFilterConfig.kind === "genre" ? activeFilterConfig.value : undefined;
  const [trendingTracks, setTrendingTracks] = useState<TrendingTrackItem[] | null>(null);
  const [rankedTopArtists, setRankedTopArtists] = useState<TopArtistItem[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetchTrendingTracks({ window: "7d", genre: popularityGenre, limit: 8 }),
      fetchTopArtists({ window: "7d", genre: popularityGenre, limit: 8 }),
    ])
      .then(([trending, artists]) => {
        if (cancelled) return;
        setTrendingTracks(trending.items ?? []);
        setRankedTopArtists(artists.items ?? []);
      })
      .catch(() => {
        if (cancelled) return;
        setTrendingTracks([]);
        setRankedTopArtists([]);
      });
    return () => {
      cancelled = true;
    };
  }, [popularityGenre]);

  const displayReleases = releases;

  // Client-side filter (genre match on `release.genre`, case-insensitive).
  const filteredReleases = useMemo<Release[]>(() => {
    if (activeFilterConfig.kind === "all") return displayReleases;
    return displayReleases.filter((release) => releaseMatchesFilter(release, activeFilterConfig));
  }, [activeFilterConfig, displayReleases]);

  // Stem Lab: real mixer stems only, from the tuned catalog slice.
  const stemLabEntries = useMemo(
    () => selectStemLabEntries(filteredReleases, 3, renderStemLabArt),
    [filteredReleases],
  );
  const heroCampaigns = useMemo(() => selectHomeHeroCampaigns(actionableCampaigns), [actionableCampaigns]);
  const activeHeroCampaign = useMemo(
    () => heroCampaigns.find((campaign) => campaign.id === activeHeroCampaignId) ?? heroCampaigns[0] ?? null,
    [activeHeroCampaignId, heroCampaigns],
  );
  // Auto-rotate the featured campaign hero through the ranked campaigns so each
  // gets time in the main panel. The rail still selects manually; hover/focus
  // pauses, and prefers-reduced-motion disables it.
  useEffect(() => {
    if (heroCampaigns.length <= 1 || heroPaused) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(() => {
      setActiveHeroCampaignId((currentId) => {
        const index = heroCampaigns.findIndex((campaign) => campaign.id === currentId);
        const next = heroCampaigns[((index < 0 ? 0 : index) + 1) % heroCampaigns.length];
        return next?.id ?? currentId;
      });
    }, 9000);
    return () => window.clearInterval(timer);
  }, [heroCampaigns, heroPaused]);
  const activeHeroCampaignImage = activeHeroCampaign
    ? activeHeroCampaign.heroImage || activeHeroCampaign.cardImage || activeHeroCampaign.visuals[0]?.url
    : undefined;
  const catalogStems = useMemo<CatalogStemSummary[]>(
    () => flattenCatalogStems(displayReleases),
    [displayReleases],
  );
  const catalogArtists = useMemo<CatalogArtistSummary[]>(
    () => summarizeCreditedArtists(displayReleases),
    [displayReleases],
  );
  const normalizedSearch = catalogSearch.trim().toLowerCase();
  const catalogFilteredReleases = useMemo(
    () => filterReleases(displayReleases, normalizedSearch),
    [displayReleases, normalizedSearch],
  );
  const catalogFilteredArtists = useMemo(
    () => filterArtists(catalogArtists, normalizedSearch),
    [catalogArtists, normalizedSearch],
  );
  const catalogFilteredStems = useMemo(
    () => filterStems(catalogStems, normalizedSearch),
    [catalogStems, normalizedSearch],
  );
  const catalogFilteredPlaylists = useMemo(
    () => filterPublicPlaylists(publicPlaylists, normalizedSearch),
    [publicPlaylists, normalizedSearch],
  );
  const catalogFilteredStemTracks = useMemo(
    () => groupCatalogStemsByTrack(catalogFilteredStems),
    [catalogFilteredStems],
  );
  const browseReleases = useMemo(
    () => catalogFilteredReleases.slice(0, HOME_RELEASE_SNAPSHOT_LIMIT),
    [catalogFilteredReleases],
  );
  const browseArtists = useMemo(
    () => catalogFilteredArtists.slice(0, HOME_ARTIST_SNAPSHOT_LIMIT),
    [catalogFilteredArtists],
  );
  const browseStemTracks = useMemo(
    () => catalogFilteredStemTracks.slice(0, HOME_STEM_TRACK_SNAPSHOT_LIMIT),
    [catalogFilteredStemTracks],
  );
  // Analytics keeps counting individual stems shown, not grouped track rows.
  const browseStemCount = browseStemTracks.reduce((total, group) => total + group.stemCount, 0);
  const browsePlaylists = useMemo(
    () => catalogFilteredPlaylists.slice(0, HOME_PLAYLIST_SNAPSHOT_LIMIT),
    [catalogFilteredPlaylists],
  );
  const catalogVisibleCount =
    catalogView === "releases"
      ? browseReleases.length
      : catalogView === "artists"
        ? browseArtists.length
        : catalogView === "stems"
          ? browseStemTracks.length
          : browsePlaylists.length;
  const catalogTotalCount =
    catalogView === "releases"
      ? catalogFilteredReleases.length
      : catalogView === "artists"
        ? catalogFilteredArtists.length
        : catalogView === "stems"
          ? catalogFilteredStemTracks.length
          : catalogFilteredPlaylists.length;
  // #1454 WS-7: feed items adapted to the legacy HomeRecommendation shape so
  // the AI DJ session seeding and vibe-queue building keep working unchanged.
  const feedRecommendations = useMemo<HomeRecommendation[]>(() => {
    if (!homeFeed) return [];
    const releaseById = new Map(displayReleases.map((release) => [release.id, release]));
    return homeFeed.rails.flatMap((rail) =>
      rail.items.map((item) => ({
        key: item.id,
        trackId: item.id,
        title: item.title,
        artist: item.artist ?? "Unknown Artist",
        releaseId: item.releaseId,
        genre: item.genre,
        moods: item.moods,
        reasons: item.reasons,
        release: releaseById.get(item.releaseId),
      })),
    );
  }, [homeFeed, displayReleases]);
  // #1449 WS-2: a served recommendation was acted on (open or play).
  const emitRecommendationClick = useCallback((trackId: string | undefined, railId: string, position: number) => {
    if (!trackId) return;
    void recordProductAnalytics(token, "recommendation.clicked", {
      payload: {
        requestId: homeFeed?.requestId ?? null,
        railId,
        trackId,
        position,
        source: "home",
      },
    });
  }, [token, homeFeed]);
  const managedArtists = summarizeManagedArtists(status === "authenticated" ? myReleases : []).slice(0, 5);
  const recentUploads = (status === "authenticated" ? myReleases : [])
    .slice()
    .sort((a, b) => getCatalogSortTime(b) - getCatalogSortTime(a))
    .slice(0, 4);

  useEffect(() => {
    const query = catalogSearch.trim();
    if (query.length < 2) return;
    const timer = window.setTimeout(() => {
      const analyticsKey = JSON.stringify({
        query,
        catalogView,
        activeFilter,
      });
      if (lastCatalogSearchAnalyticsKeyRef.current === analyticsKey) return;
      lastCatalogSearchAnalyticsKeyRef.current = analyticsKey;
      void recordProductAnalytics(token, "search.submitted", {
        source: "home_catalog",
        subjectType: "catalog",
        payload: {
          surface: "home_catalog",
          queryLength: query.length,
          catalogView,
          activeFilter,
          releaseResultCount: browseReleases.length,
          artistResultCount: browseArtists.length,
          stemResultCount: browseStemCount,
          playlistResultCount: browsePlaylists.length,
        },
      });
    }, 600);
    return () => window.clearTimeout(timer);
  }, [activeFilter, browseArtists.length, browsePlaylists.length, browseReleases.length, browseStemCount, catalogSearch, catalogView, token]);

  const recordCatalogSearchResultClick = (
    resultType: "release" | "artist" | "track" | "playlist",
    subjectId: string,
    resultRank: number,
  ) => {
    if (!catalogSearch.trim()) return;
    void recordProductAnalytics(token, "search.result_clicked", {
      source: "home_catalog",
      subjectType: resultType,
      subjectId,
      payload: {
        surface: "home_catalog",
        resultType,
        resultRank,
        catalogView,
      },
    });
  };

  // #1451 WS-4: Top Artists come from the engagement serving table only —
  // no recency fallback. `null` = still loading (hide the rail), `[]` = the
  // catalog is below the minimum-audience threshold (honest empty state).
  const topArtists = rankedTopArtists;
  // Most artists have no portrait yet; their newest credited release cover
  // stands in so the Top Artists shelf shows real art instead of initials.
  // Keyed by credited-artist id — the id the popularity tables rank by.
  const artistCoverFallbacks = useMemo(() => {
    const covers: Record<string, ArtistCoverFallback> = {};
    for (const artist of catalogArtists) {
      const release = artist.latestRelease;
      if (!artist.artistId || !release?.artworkMimeType) continue;
      covers[artist.artistId] = {
        releaseId: release.id,
        mimeType: release.artworkMimeType,
        artworkRevision: release.artworkRevision,
      };
    }
    return covers;
  }, [catalogArtists]);

  const handleStartRecommendedSession = async (recommendation: HomeRecommendation) => {
    const seedGenre = recommendation.moods?.[0] || recommendation.genre || recommendation.reasons[0]?.replace(/^(genre|mood|cohort):/, "") || "Discovery";
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
      const queue = buildVibeQueue(feedRecommendations, filteredReleases);
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

  const handlePlayCatalogRelease = (release: Release) => {
    const tracks = catalogArtistPlaybackTracks([release]);
    if (tracks.length > 0) void playQueue(tracks, 0);
  };

  return (
    <div className="home-ng">
      <main className="ng-main ng-main--v3">
        {/* 1. HERO ————————————————————————————————————————————————— */}
        <section className="ng-section ng-section--tight">
          {campaigns === null ? (
            <HomeHeroSkeleton />
          ) : !activeHeroCampaign ? (
            <HomeHeroEmpty />
          ) : (
            <div
              className={`ng-hero ${activeHeroCampaignImage ? "ng-hero--campaign-image" : ""}`}
              onMouseEnter={() => setHeroPaused(true)}
              onMouseLeave={() => setHeroPaused(false)}
              onFocusCapture={() => setHeroPaused(true)}
              onBlurCapture={() => setHeroPaused(false)}
            >
              {activeHeroCampaignImage ? (
                <HomeCampaignVisual
                  src={activeHeroCampaignImage}
                  sizes="(max-width: 767px) calc(100vw - 32px), (max-width: 1023px) calc(100vw - 48px), calc(100vw - 320px)"
                  className="ng-hero__campaign-image"
                  preload={activeHeroCampaignId === ""}
                />
              ) : null}
              <HomeHeroMotif />
              <div className="ng-hero__card">
                <span className="ng-kicker ng-kicker--primary">Featured Campaign</span>
                <h2 className="ng-hero__title">
                  {campaignDisplayTitle(activeHeroCampaign)}
                </h2>
                <p className="ng-hero__body">
                  {activeHeroCampaign.tagline} Lock funds in a smart contract to
                  bring this show to life — refunded automatically if the
                  threshold isn&apos;t met.
                </p>
                <div className="ng-hero__actions">
                  <Link
                    href={`/shows/${activeHeroCampaign.id}`}
                    className="ng-btn ng-btn--primary"
                  >
                    <span className="ms-icon" data-fill="1" aria-hidden>rocket_launch</span>
                    Back This Show
                  </Link>
                  <Link href="/shows" className="ng-btn ng-btn--glass">
                    All Campaigns
                  </Link>
                </div>
              </div>
              {heroCampaigns.length > 1 ? (
                <div className="ng-hero__campaign-rail" aria-label="Featured campaigns">
                  {heroCampaigns.map((campaign, index) => {
                    const image = campaign.cardImage || campaign.heroImage || campaign.visuals[0]?.url;
                    const selected = campaign.id === activeHeroCampaign.id;
                    return (
                      <button
                        key={campaign.id}
                        type="button"
                        className={`ng-hero__campaign-tab ${selected ? "ng-hero__campaign-tab--active" : ""}`}
                        onClick={() => setActiveHeroCampaignId(campaign.id)}
                        aria-pressed={selected}
                      >
                        {image ? (
                          <HomeCampaignVisual
                            src={image}
                            sizes="(max-width: 767px) calc(100vw - 72px), (max-width: 1023px) calc(50vw - 48px), 380px"
                            className="ng-hero__campaign-tab-image"
                          />
                        ) : null}
                        <span className="ng-hero__campaign-index">{String(index + 1).padStart(2, "0")}</span>
                        <span className="ng-hero__campaign-copy">
                          <strong>{campaignDisplayTitle(campaign)}</strong>
                          <span>{campaign.city} · {Math.round(progressRatio(campaign) * 100)}% funded</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
          )}
        </section>

        {/* 2. TUNER — genre/mood filter + vibe session ——————————— */}
        <HomeTuner
          filters={FILTERS}
          activeId={activeFilter}
          onSelect={(id) => {
            const next = FILTERS.find((filter) => filter.id === id);
            if (next) setActiveFilter(next.id);
          }}
          matchCount={filteredReleases.length}
          starting={startingVibe === activeFilter}
          onStartSession={() => void handleStartVibeSession(activeFilterConfig)}
        />

        {/* 3. PERSONALIZED FEED — multi-rail (#1454 WS-7) ————————— */}
        <HomeFeedRails
          feed={homeFeed}
          startingSeed={startingSeed}
          onOpen={(item, railId, position) => emitRecommendationClick(item.id, railId, position)}
          onStartSession={(item, railId, position) => {
            emitRecommendationClick(item.id, railId, position);
            void handleStartRecommendedSession(feedItemToRecommendation(item, displayReleases));
          }}
        />

        {/* 4. TRENDING NOW — engagement-ranked tracks (#1451) ————— */}
        {/* The rail itself renders null while `items === null`, so gating the
            lazy mount on resolved data is behaviour-identical — it just keeps
            the loading skeleton from reserving a box the rail would not fill
            yet (#1491). */}
        {trendingTracks !== null && (
          <TrendingNowRail items={trendingTracks} genreLabel={popularityGenre} />
        )}

        {/* 5. TOP ARTISTS — engagement-ranked (#1451) ——————————— */}
        {topArtists !== null && (
          <TopArtistsRail
            items={topArtists}
            genreLabel={popularityGenre}
            coverFallbacks={artistCoverFallbacks}
          />
        )}

        {/* 6. STEM LAB — real stems, one-tap solo in the mixer ———— */}
        <StemLab entries={stemLabEntries} />

        {/* 7. UPCOMING LIVE EVENTS — ticket-style campaign cards ——— */}
        <LiveEventRail campaigns={actionableCampaigns} />

        {/* 8. DROPS — collectible moments shelf (#1479) ——————————— */}
        <DropsShelf token={token} />

        {/* 9. CATALOG BROWSER — "Recently Added" snapshot ——————————— */}
        <section className="ng-section">
          <div className="ng-catalog-shell ng-glass">
            <header className="ng-catalog-header">
              <div>
                <span className="ng-kicker ng-kicker--violet">Global catalog snapshot</span>
                <h3 className="ng-section-title">Recently Added</h3>
              </div>
              <div className="ng-catalog-actions">
                <label className="ng-catalog-search">
                  <span className="ms-icon" aria-hidden>search</span>
                  <input
                    value={catalogSearch}
                    onChange={(event) => setCatalogSearch(event.target.value)}
                    placeholder="Search this snapshot"
                    aria-label="Search catalog snapshot"
                  />
                  {catalogSearch && (
                    <button
                      type="button"
                      className="ng-catalog-search__clear"
                      onClick={() => setCatalogSearch("")}
                      aria-label="Clear search"
                    >
                      <span className="ms-icon" aria-hidden>close</span>
                    </button>
                  )}
                </label>
                <Link href="/catalog" className="ng-section-link">
                  Open catalog
                  <span className="ms-icon" aria-hidden style={{ fontSize: 14 }}>arrow_forward</span>
                </Link>
              </div>
            </header>

            <div className="ng-segmented" role="tablist" aria-label="Catalog view">
              {(["releases", "artists", "stems", "playlists"] as const).map((view) => (
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

            {catalogVisibleCount < catalogTotalCount && (
              <p className="ng-cat-summary" aria-live="polite">
                Showing {catalogVisibleCount} of {formatCount(catalogTotalCount, CATALOG_SNAPSHOT_UNITS[catalogView])}
              </p>
            )}

            {catalogView === "releases" && (
              browseReleases.length > 0 ? (
                <div className="ng-cat-grid">
                  {browseReleases.map((release, index) => (
                    <CatalogReleaseCard
                      key={release.id}
                      release={release}
                      onSelect={() => recordCatalogSearchResultClick("release", release.id, index + 1)}
                      onPlay={handlePlayCatalogRelease}
                      actions={releaseActions(release)}
                    />
                  ))}
                </div>
              ) : (
                <div className="ng-empty-state">
                  <span className="ms-icon" aria-hidden>album</span>
                  <p>{normalizedSearch ? "No releases match your search." : "No releases in the global catalog."}</p>
                </div>
              )
            )}

            {catalogView === "artists" && (
              browseArtists.length > 0 ? (
                <div className="ng-cat-grid">
                  {browseArtists.map((artist, index) => (
                    <CatalogArtistCard
                      key={artist.key}
                      artist={artist}
                      onSelect={() => recordCatalogSearchResultClick("artist", artist.artistId ?? artist.key, index + 1)}
                    />
                  ))}
                </div>
              ) : (
                <div className="ng-empty-state">
                  <span className="ms-icon" aria-hidden>person_search</span>
                  <p>{normalizedSearch ? "No artists match your search." : "No artists in the global catalog."}</p>
                </div>
              )
            )}

            {catalogView === "stems" && (
              browseStemTracks.length > 0 ? (
                <div className="ng-cat-stem-list">
                  {browseStemTracks.map((group, index) => (
                    <CatalogStemTrackRow
                      key={group.key}
                      group={group}
                      onSelect={() => recordCatalogSearchResultClick("track", group.trackId, index + 1)}
                    />
                  ))}
                </div>
              ) : (
                <div className="ng-empty-state">
                  <span className="ms-icon" aria-hidden>graphic_eq</span>
                  <p>{normalizedSearch ? "No stems match your search." : "No stems are exposed in this catalog slice yet."}</p>
                </div>
              )
            )}

            {catalogView === "playlists" && (
              browsePlaylists.length > 0 ? (
                <div className="ng-cat-grid">
                  {browsePlaylists.map((playlist, index) => (
                    <CatalogPlaylistCard
                      key={playlist.id}
                      playlist={playlist}
                      onSelect={() => recordCatalogSearchResultClick("playlist", playlist.id, index + 1)}
                    />
                  ))}
                </div>
              ) : (
                <div className="ng-empty-state">
                  <span className="ms-icon" aria-hidden>queue_music</span>
                  <p>{normalizedSearch ? "No playlists match your search." : "No public playlists in the global catalog yet."}</p>
                </div>
              )
            )}

            <div className="ng-catalog-footer">
              <Link href="/catalog" className="ng-btn ng-btn--secondary">
                Browse catalog
                <span className="ms-icon" aria-hidden>arrow_forward</span>
              </Link>
            </div>
          </div>
        </section>

        {/* 10. AI DJ SESSION PRESETS ———————————————————————————— */}
        <section className="ng-section ng-section--presets">
          <AgentSessionPresets compact />
        </section>

        {/* 11. YOUR STUDIO — upload operations ——————————————————— */}
        <section className="ng-section ng-studio">
          <header className="ng-shelf__header">
            <div className="ng-shelf__heading">
              <span className="ng-kicker ng-kicker--primary">For artists</span>
              <h3 className="ng-section-title">Your studio</h3>
            </div>
          </header>
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
                  <h3 className="ng-section-title">Your Releases</h3>
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
                          <AiDisclosureBadge disclosure={release.aiDisclosure} />
                          <small>{getReleaseResourceCount(release)} resources · {formatRelativeTime(getCatalogSortTime(release))}</small>
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
      </main>
    </div>
  );
}

function ReleaseThumb({ release, small = false }: { release: Release; small?: boolean }) {
  return (
    <span className={small ? "ng-release-thumb ng-release-thumb--small" : "ng-release-thumb"}>
      {release.artworkUrl ? (
        <HomeReleaseArtwork
          releaseId={release.id}
          mimeType={release.artworkMimeType ?? ""}
          artworkRevision={release.artworkRevision}
          alt=""
          sizes={small ? "(max-width: 767px) 46px, 48px" : "(max-width: 767px) 56px, 72px"}
        />
      ) : (
        <span aria-hidden>{(release.title?.[0] ?? "?").toUpperCase()}</span>
      )}
    </span>
  );
}

function selectHomeHeroCampaigns(campaigns: Campaign[]): Campaign[] {
  return campaigns
    .slice()
    .sort((a, b) => scoreHomeHeroCampaign(b) - scoreHomeHeroCampaign(a))
    .slice(0, 4);
}

function scoreHomeHeroCampaign(campaign: Campaign): number {
  const days = daysUntil(campaign.deadline);
  const hasVisual = Boolean(campaign.heroImage || campaign.cardImage);
  const urgencyScore = days > 0 ? Math.max(0, 28 - Math.min(days, 28)) : 0;

  return (
    (campaign.featured ? 100 : 0)
    + (hasVisual ? 36 : 0)
    + (campaign.status === "active" ? 24 : 0)
    + (campaign.status === "funded" || campaign.status === "booked" ? 16 : 0)
    + Math.round(progressRatio(campaign) * 28)
    + Math.min(campaign.backerCount, 24)
    + urgencyScore
  );
}

function getReleaseResourceCount(release: Release) {
  const stemCount = release.tracks?.reduce(
    (sum, track) => sum + (track.stems?.length ?? 0),
    0,
  ) ?? 0;
  return Math.max(1, 1 + stemCount);
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

function filterArtists(artists: CatalogArtistSummary[], query: string) {
  if (!query) return artists;
  return artists.filter((artist) =>
    [
      artist.name,
      artist.latestRelease?.title,
      ...Array.from(artist.genres),
    ].some((value) => value?.toLowerCase().includes(query)),
  );
}

function filterStems(stems: CatalogStemSummary[], query: string) {
  if (!query) return stems;
  return stems.filter((stem) =>
    [
      stem.title,
      stem.trackTitle,
      stem.type,
      stem.releaseTitle,
      stem.artistName,
    ].some((value) => value.toLowerCase().includes(query)),
  );
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

/**
 * #1454 WS-7: adapt a Home feed item to the legacy HomeRecommendation shape
 * consumed by AI DJ session seeding. No catalog fallback — the multi-rail
 * feed's honest empty state replaced the old "first 4 releases" filler.
 */
function feedItemToRecommendation(item: HomeFeedItem, releases: Release[]): HomeRecommendation {
  const release = releases.find((candidate) => candidate.id === item.releaseId);
  return {
    key: item.id,
    trackId: item.id,
    title: item.title,
    artist: item.artist ?? (release ? getArtistName(release) : "Unknown Artist"),
    releaseId: item.releaseId,
    genre: item.genre ?? release?.genre,
    moods: item.moods,
    reasons: item.reasons,
    release,
  };
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

/** Stem Lab artwork: optimized release art, or the title monogram. */
function renderStemLabArt(release: Release) {
  return release.artworkUrl ? (
    <HomeReleaseArtwork
      releaseId={release.id}
      mimeType={release.artworkMimeType ?? ""}
      artworkRevision={release.artworkRevision}
      alt=""
      sizes="88px"
    />
  ) : (
    <span className="ng-monogram" aria-hidden>
      {(release.title?.[0] ?? "?").toUpperCase()}
    </span>
  );
}
