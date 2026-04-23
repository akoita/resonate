"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card } from "../components/ui/Card";
import { useAuth } from "../components/auth/AuthProvider";
// import { usePlayer } from "../lib/playerContext";
import { listPublishedReleases, listMyReleases, Release } from "../lib/api";
import { HeroCarousel } from "../components/home/HeroCarousel";
import { FeaturedStems } from "../components/home/FeaturedStems";
import { useWebSockets, ReleaseStatusUpdate } from "../hooks/useWebSockets";
import { useToast } from "../components/ui/Toast";
import { CampaignHero } from "../components/shows/CampaignHero";
import { CampaignCard } from "../components/shows/CampaignCard";
import {
  getFeaturedCampaignSync,
  listCampaignsSync,
} from "../lib/shows";
import { FALLBACK_RELEASES } from "../lib/fallbackReleases";

export default function Home() {
  const router = useRouter();
  const [releases, setReleases] = useState<Release[]>([]);
  const [myReleases, setMyReleases] = useState<Release[]>([]);
  const [loading, setLoading] = useState(true);
  const { token, status } = useAuth();
  const { addToast } = useToast();

  // WebSocket status updates
  useWebSockets((data: ReleaseStatusUpdate) => {
    // Notify user when status changes
    if (data.status === 'ready') {
      addToast({
        type: 'success',
        title: 'Release Ready',
        message: `"${data.title}" is now available in your studio!`,
        onClick: () => router.push(`/release/${data.releaseId}`)
      });
    } else if (data.status === 'processing') {
      addToast({
        type: 'info',
        title: 'Processing Started',
        message: `We're preparing "${data.title}"...`,
      });
    }

    setMyReleases((prev) =>
      prev.map((r) =>
        r.id === data.releaseId ? { ...r, status: data.status.toUpperCase() } : r
      )
    );
  });

  useEffect(() => {
    listPublishedReleases(12)
      .then(setReleases)
      .catch(() => setReleases([]))
      .finally(() => setLoading(false));

    if (token && status === "authenticated") {
      listMyReleases(token)
        .then(setMyReleases)
        .catch(() => setMyReleases([]));
    }
  }, [token, status]);


  // When the catalog API is empty (fresh staging, backend blip) the home
  // would otherwise render a half-built skeleton forever. Fall back to a
  // small curated set so the page always looks finished per
  // speedrun_sr007/04_mvp_scope.md (line 71-76).
  const displayReleases = useMemo<Release[]>(
    () => (!loading && releases.length === 0 ? FALLBACK_RELEASES : releases),
    [releases, loading],
  );

  const quickAccessReleases = displayReleases.slice(0, 6);
  const newReleases = displayReleases.slice(1, 9);

  const featuredCampaign = getFeaturedCampaignSync();
  const allCampaigns = listCampaignsSync();

  return (
    <main className="home-container">
      <div className="mesh-gradient-bg" />

      {/* 1. Resonate Shows — fan-funded booking wedge (primary CTA). */}
      <section className="shows-surface shows-home-hero fade-in-up">
        <CampaignHero campaign={featuredCampaign} />
      </section>

      {/* 2. Active campaigns grid — three cards on the same amber surface. */}
      <section className="shows-surface shows-home-section fade-in-up" style={{ animationDelay: '0.1s' }}>
        <header className="shows-home-section__header">
          <span className="shows-home-section__kicker">Active campaigns</span>
          <h2 className="shows-home-section__title">Fans bring the show.</h2>
          <p className="shows-home-section__sub">
            Pick an artist and a city. If enough fans commit, the show gets
            booked. If not, every pledge is refunded automatically — enforced
            by code, not a company.
          </p>
        </header>
        <div className="campaign-grid">
          {allCampaigns.map((c) => (
            <CampaignCard key={c.id} campaign={c} />
          ))}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <Link href="/shows" className="view-all-link">
            Browse all campaigns →
          </Link>
        </div>
      </section>

      {/* 3. Discover new music — demoted release carousel (secondary). */}
      {displayReleases.length > 0 && (
        <HeroCarousel
          releases={displayReleases.slice(0, 3)}
          autoAdvanceMs={12000}
          variant="secondary"
        />
      )}

      {/* 4. Featured Stems — the hero asset */}
      {displayReleases.length > 0 && (
        <FeaturedStems releases={displayReleases} />
      )}

      {/* 3. Quick Access (Spotify Style but Glass) */}
      <section className="home-section fade-in-up" style={{ animationDelay: '0.1s' }}>
        <div className="section-header">
          <h2 className="home-section-title text-gradient">Good Evening</h2>
        </div>
        <div className="quick-access-grid">
          {quickAccessReleases.map((release) => (
            <Card
              key={`quick-${release.id}`}
              variant="compact"
              title={release.title}
              image={release.artworkUrl || undefined}
              onClick={() => router.push(`/release/${release.id}`)}
            />
          ))}
        </div>
      </section>

      {/* 3. New Releases Section (Tidal Style Bold List/Grid) */}
      <section className="home-section fade-in-up" style={{ animationDelay: '0.2s' }}>
        <div className="section-header">
          <h2 className="home-section-title">Latest Masterings</h2>
          <Link href="/library" className="view-all-link">View all</Link>
        </div>

        {loading && releases.length === 0 ? (
          <div className="loading-shimmer-container">
            <div className="shimmer-card" />
            <div className="shimmer-card" />
            <div className="shimmer-card" />
          </div>
        ) : (
          <div className="release-card-grid">
            {newReleases.map((release, idx) => (
              <Card
                key={release.id}
                variant={idx === 0 ? "featured" : "standard"}
                title={release.title}
                image={release.artworkUrl || undefined}
                onClick={() => router.push(`/release/${release.id}`)}
              >
                <div className="track-card-meta">
                  <div className="artist-stack">
                    <span
                      className="primary-artist clickable"
                      onClick={(e) => {
                        e.stopPropagation();
                        // Prefer artist ID, fallback to name
                        const id = release.artist?.id || release.artistId;
                        const name = release.primaryArtist;
                        const target = id || name;
                        if (target) router.push(`/artist/${encodeURIComponent(target)}`);
                      }}
                    >
                      {release.primaryArtist || "Unknown Artist"}
                    </span>
                    <span className="release-year">{release.releaseDate ? new Date(release.releaseDate).getFullYear() : '2026'}</span>
                  </div>
                  <span className="track-badge">{release.type}</span>
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* Mood-filter "signal chips" were removed here: they rendered as
       * visually-tappable mood buttons (Focus / Chill / Energy / Night
       * Drive / Lo-fi) but had no onClick, no filter wiring, and no
       * tracked plan to implement. If we ever want real mood-based
       * catalog filtering, it should land as a designed feature with
       * actual backend filter params + state, not as placeholder UI. */}

      {status === "authenticated" && myReleases.length > 0 && (
        <section className="home-section">
          <div className="section-header">
            <h2 className="home-section-title">Your Studio Vault</h2>
          </div>
          <div className="release-card-grid">
            {myReleases.map((release) => (
              <Card
                key={release.id}
                title={release.title}
                image={release.artworkUrl || undefined}
                onClick={() => router.push(`/release/${release.id}`)}
              >
                <div className="track-card-meta">
                  <div className="artist-stack">
                    <span className={`status-badge status-${release.status.toLowerCase()}`}>
                      {release.status}
                    </span>
                    <span className="release-year">{new Date(release.createdAt).toLocaleDateString()}</span>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </section>
      )}

      <style jsx>{`
        .home-container {
          max-width: 1800px;
          margin: 0 auto;
          display: flex;
          flex-direction: column;
          gap: 80px;
          padding: 0 60px;
        }

        /* Phone: the 60px desktop gutters eat 120px of a 412px viewport
         * (29%), pushing every home section into ~260px of usable
         * width. Drop to 0 on phone so sections span the full
         * app-content gutter (which already adds 16px each side). */
        @media (max-width: 767px) {
          .home-container {
            gap: 32px;
            padding: 0;
          }
        }

        .home-hero-section {
          animation-delay: 0.1s;
        }

        .section-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-end;
          margin-bottom: 24px;
        }

        .home-section-title {
          font-size: 32px;
          font-weight: 800;
          letter-spacing: -0.03em;
        }

        .view-all-link {
          font-size: 13px;
          font-weight: 700;
          color: var(--color-muted);
          text-transform: uppercase;
          letter-spacing: 0.12em;
          transition: color 0.2s;
        }

        .view-all-link:hover {
          color: #fff;
        }

        .quick-access-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
          gap: 20px;
          animation-delay: 0.2s;
        }

        .release-card-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
          gap: 40px;
          animation-delay: 0.3s;
        }

        .artist-stack {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .primary-artist {
          font-size: 14px;
          font-weight: 600;
          color: #fff;
        }

        .release-year {
          font-size: 12px;
          color: var(--color-muted);
        }

        .loading-shimmer-container {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 32px;
        }

        .shimmer-card {
          width: 100%;
          aspect-ratio: 1/1;
          background: var(--studio-surface);
          border-radius: 20px;
          position: relative;
          overflow: hidden;
        }

        .shimmer-card::after {
          content: "";
          position: absolute;
          inset: 0;
          background: linear-gradient(90deg, transparent, rgba(255,255,255,0.03), transparent);
          animation: shimmer 1.5s infinite;
        }
      `}</style>
    </main>
  );
}

