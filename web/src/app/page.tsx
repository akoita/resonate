"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
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
  getReleaseTrackStreamUrl,
  getStemPreviewUrl,
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
  type Track,
  type TrendingTrackItem,
} from "../lib/api";
import { artistProfileHref, catalogArtistHref } from "../lib/artistRoutes";
import {
  filterPublicPlaylists,
  flattenCatalogStems,
  getArtistName,
  getCatalogSortTime,
  getTrackArtistName,
  summarizeCreditedArtists,
  summarizeManagedArtists,
  type CatalogArtistSummary,
  type CatalogStemSummary,
} from "../lib/catalogDisplay";
import { CatalogPlaylistCard } from "../components/catalog/CatalogPlaylistCard";
import { HomeFeedRails } from "../components/home/HomeFeedRails";
import { TopArtistsRail, TrendingNowRail } from "../components/home/PopularityRails";
import { type LocalTrack, saveTracksMetadata } from "../lib/localLibrary";
import { usePlayer } from "../lib/playerContext";
import { useWebSockets, ReleaseStatusUpdate } from "../hooks/useWebSockets";
import { useToast } from "../components/ui/Toast";
import { AddToPlaylistModal } from "../components/library/AddToPlaylistModal";
import {
  campaignDisplayInitial,
  campaignDisplayTitle,
  filterActionableCampaigns,
  listCampaigns,
  listCampaignsSync,
  getFeaturedCampaignSync,
  daysUntil,
  progressRatio,
  type Campaign,
} from "../lib/shows";
import AgentSessionPresets from "../components/agent/AgentSessionPresets";
import { recordProductAnalytics } from "../lib/productAnalytics";

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
type CatalogView = "releases" | "artists" | "stems" | "playlists";

const HOME_PLAYLIST_SNAPSHOT_LIMIT = 12;

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
  const [publicPlaylists, setPublicPlaylists] = useState<PublicPlaylistSummary[]>([]);
  const [myReleases, setMyReleases] = useState<Release[]>([]);
  const [activeFilter, setActiveFilter] = useState<FilterId>("all");
  const [catalogView, setCatalogView] = useState<CatalogView>("releases");
  const [catalogSearch, setCatalogSearch] = useState("");
  // #1454 WS-7: multi-rail personalized feed. null = loading, [] rails = honest empty.
  const [homeFeed, setHomeFeed] = useState<HomeFeedResponse | null>(null);
  const [startingSeed, setStartingSeed] = useState<string | null>(null);
  const [startingVibe, setStartingVibe] = useState<FilterId | null>(null);
  const [tracksToAddToPlaylist, setTracksToAddToPlaylist] = useState<LocalTrack[] | null>(null);
  const [savingReleaseId, setSavingReleaseId] = useState<string | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>(() => listCampaignsSync());
  const [activeHeroCampaignId, setActiveHeroCampaignId] = useState("");
  // "Upcoming Live Events" shows 2 of N campaigns. With no priority signal, the
  // window rotates so every campaign gets fair main-page visibility over time.
  const [eventRowOffset, setEventRowOffset] = useState(0);
  const [eventRowPaused, setEventRowPaused] = useState(false);
  const [heroPaused, setHeroPaused] = useState(false);
  const lastCatalogSearchAnalyticsKeyRef = useRef<string | null>(null);
  const { status, token, userId } = useAuth();
  const { addToast } = useToast();
  const { playQueue } = usePlayer();
  const activeFilterConfig = useMemo(
    () => FILTERS.find((filter) => filter.id === activeFilter) ?? FILTERS[0],
    [activeFilter],
  );
  const actionableCampaigns = useMemo(() => filterActionableCampaigns(campaigns), [campaigns]);

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
        if (!cancelled && items.length > 0) setCampaigns(items);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  // Fairly rotate the 2-card "Upcoming Live Events" window across actionable
  // campaigns so none stay hidden when there is no priority signal. Pauses
  // while hovered and honors prefers-reduced-motion.
  useEffect(() => {
    if (actionableCampaigns.length <= 2 || eventRowPaused) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(() => {
      setEventRowOffset((offset) => (offset + 1) % actionableCampaigns.length);
    }, 8000);
    return () => window.clearInterval(timer);
  }, [actionableCampaigns.length, eventRowPaused]);

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

  // Row data derivation.
  const resumeRow = filteredReleases.slice(0, 4);
  const stemRow = filteredReleases.slice(0, 3);
  const heroCampaigns = useMemo(() => selectHomeHeroCampaigns(actionableCampaigns), [actionableCampaigns]);
  const activeHeroCampaign = useMemo(
    () => heroCampaigns.find((campaign) => campaign.id === activeHeroCampaignId) ?? heroCampaigns[0] ?? getFeaturedCampaignSync(),
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
  const eventRow: Campaign[] = useMemo(() => {
    if (actionableCampaigns.length <= 2) return actionableCampaigns.slice(0, 2);
    const start = eventRowOffset % actionableCampaigns.length;
    return [actionableCampaigns[start], actionableCampaigns[(start + 1) % actionableCampaigns.length]];
  }, [actionableCampaigns, eventRowOffset]);
  const activeHeroCampaignImage = activeHeroCampaign.heroImage || activeHeroCampaign.cardImage || activeHeroCampaign.visuals[0]?.url;
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
  const browseReleases = useMemo(() => catalogFilteredReleases.slice(0, 18), [catalogFilteredReleases]);
  const browseArtists = useMemo(() => catalogFilteredArtists.slice(0, 12), [catalogFilteredArtists]);
  const browseStems = useMemo(() => catalogFilteredStems.slice(0, 12), [catalogFilteredStems]);
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
          ? browseStems.length
          : browsePlaylists.length;
  const catalogTotalCount =
    catalogView === "releases"
      ? catalogFilteredReleases.length
      : catalogView === "artists"
        ? catalogFilteredArtists.length
        : catalogView === "stems"
          ? catalogFilteredStems.length
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
          stemResultCount: browseStems.length,
          playlistResultCount: browsePlaylists.length,
        },
      });
    }, 600);
    return () => window.clearTimeout(timer);
  }, [activeFilter, browseArtists.length, browsePlaylists.length, browseReleases.length, browseStems.length, catalogSearch, catalogView, token]);

  const recordCatalogSearchResultClick = (
    resultType: "release" | "artist" | "stem" | "playlist",
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
          <div
            className={`ng-hero ${activeHeroCampaignImage ? "ng-hero--campaign-image" : ""}`}
            style={activeHeroCampaignImage ? { "--ng-hero-image": `url(${activeHeroCampaignImage})` } as CSSProperties : undefined}
            onMouseEnter={() => setHeroPaused(true)}
            onMouseLeave={() => setHeroPaused(false)}
            onFocusCapture={() => setHeroPaused(true)}
            onBlurCapture={() => setHeroPaused(false)}
          >
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
                      style={image ? { "--ng-hero-thumb": `url(${image})` } as CSSProperties : undefined}
                      onClick={() => setActiveHeroCampaignId(campaign.id)}
                      aria-pressed={selected}
                    >
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

        {/* 3. CATALOG BROWSER ——————————————————————————————————— */}
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
              <div>
                <strong>{publicPlaylists.length}</strong>
                <span>Playlists</span>
              </div>
            </div>

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

            <div className="ng-catalog-window" aria-live="polite">
              {catalogTotalCount === 0
                ? `No ${catalogView} yet`
                : catalogVisibleCount < catalogTotalCount
                  ? `Showing ${catalogVisibleCount} of ${catalogTotalCount} ${catalogView} · newest first`
                  : `${catalogTotalCount} ${catalogView} · newest first`}
            </div>

            {catalogView === "releases" && (
              <div className="ng-resource-grid ng-resource-grid--releases">
                {browseReleases.length > 0 ? (
                  browseReleases.map((release, index) => (
                    <article
                      key={release.id}
                      className="ng-resource-card"
                    >
                      <Link
                        href={`/release/${release.id}`}
                        className="ng-resource-card__link"
                        onClick={() => recordCatalogSearchResultClick("release", release.id, index + 1)}
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
                  browseArtists.map((artist, index) => {
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
                        onClick={() => recordCatalogSearchResultClick("artist", artist.artistId ?? artist.key, index + 1)}
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
                  browseStems.map((stem, index) => (
                    <Link
                      key={stem.id}
                      href={`/release/${stem.releaseId}?mixer=true`}
                      className="ng-stem-row"
                      onClick={() => recordCatalogSearchResultClick("stem", stem.id, index + 1)}
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

            {catalogView === "playlists" && (
              <div className="ng-resource-grid ng-resource-grid--releases">
                {browsePlaylists.length > 0 ? (
                  browsePlaylists.map((playlist, index) => (
                    <CatalogPlaylistCard
                      key={playlist.id}
                      playlist={playlist}
                      onSelect={() => recordCatalogSearchResultClick("playlist", playlist.id, index + 1)}
                    />
                  ))
                ) : (
                  <div className="ng-empty-state">
                    <span className="ms-icon" aria-hidden>queue_music</span>
                    <p>No public playlists in the global catalog yet.</p>
                  </div>
                )}
              </div>
            )}

            <div className="ng-catalog-footer">
              <Link href="/catalog" className="ng-btn ng-btn--secondary">
                Browse catalog
                <span className="ms-icon" aria-hidden>arrow_forward</span>
              </Link>
            </div>
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

        {/* 5b. TRENDING NOW — engagement-ranked tracks (#1451) ————— */}
        <TrendingNowRail items={trendingTracks} genreLabel={popularityGenre} />

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
            <div
              className="ng-grid-2"
              onMouseEnter={() => setEventRowPaused(true)}
              onMouseLeave={() => setEventRowPaused(false)}
              onFocusCapture={() => setEventRowPaused(true)}
              onBlurCapture={() => setEventRowPaused(false)}
            >
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

        {/* 9. TOP ARTISTS — engagement-ranked (#1451) ——————————— */}
        <TopArtistsRail items={topArtists} genreLabel={popularityGenre} />
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
  const artistName = getArtistName(release);
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
  const title = campaignDisplayTitle(campaign);
  const initial = campaignDisplayInitial(campaign);
  const badge = variant === "live"
    ? `Ends in ${days}d`
    : new Date(campaign.targetDate).toLocaleDateString("en-GB", { month: "short", day: "numeric" });
  const visualImage = campaign.cardImage || campaign.heroImage || campaign.visuals[0]?.url;
  const hasImage = Boolean(visualImage);

  return (
    <Link href={`/shows/${campaign.id}`} className="ng-event-card">
      <div
        className={`ng-event-card__art ${hasImage ? "ng-event-card__art--image" : ""}`}
        style={hasImage ? { "--ng-event-image": `url(${visualImage})` } as CSSProperties : undefined}
        aria-hidden
      >
        {!hasImage ? (
          <span className="ng-monogram" style={{ fontSize: 72 }}>
            {initial}
          </span>
        ) : null}
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
            {title}
          </h4>
          <p className="ng-event-card__sub">
            {campaign.venue ? `${campaign.venue}` : `${campaign.backerCount} backers`}
          </p>
        </div>
      </div>
    </Link>
  );
}
