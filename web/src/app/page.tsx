"use client";

import { useEffect, useState, use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card } from "../components/ui/Card";
import { useAuth } from "../components/auth/AuthProvider";
// import { usePlayer } from "../lib/playerContext";
import { listPublishedReleases, listMyReleases, Release } from "../lib/api";
import { ReleaseHero } from "../components/home/ReleaseHero";
import { FeaturedStems } from "../components/home/FeaturedStems";
import { useWebSockets, ReleaseStatusUpdate } from "../hooks/useWebSockets";
import { useToast } from "../components/ui/Toast";

export default function Home(props: {
  params: Promise<Record<string, string>>;
  searchParams: Promise<Record<string, string>>;
}) {
  const params = use(props.params);
  const searchParams = use(props.searchParams);
  const router = useRouter();
  const moods = ["Focus", "Chill", "Energy", "Night Drive", "Lo-fi"];
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

  const featuredRelease = releases[0];
  const quickAccessReleases = releases.slice(0, 6);
  const newReleases = releases.slice(1, 9);

  return (
    <main className="home-container">
      <div className="mesh-gradient-bg" />

      {/* 1. Master Stage Hero */}
      {featuredRelease && (
        <section className="home-hero-section fade-in-up">
          <ReleaseHero release={featuredRelease} />
        </section>
      )}

      {/* 2. Featured Stems — the hero asset */}
      {!loading && releases.length > 0 && (
        <FeaturedStems releases={releases} />
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

        {loading ? (
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

      {/* 4. Mood Filters / Signal Chips */}
      <section className="home-section chip-section fade-in-up" style={{ animationDelay: '0.3s' }}>
        <div className="home-chips">
          {moods.map((mood) => (
            <button key={mood} className="signal-chip" type="button">
              <span className="signal-pulse" />
              {mood}
            </button>
          ))}
        </div>
      </section>

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

        .signal-chip {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px 24px;
          border-radius: 50px;
          background: var(--studio-surface);
          border: 1px solid var(--studio-border);
          color: var(--color-muted);
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }

        .signal-chip:hover {
          background: var(--studio-surface-raised);
          color: #fff;
          border-color: var(--studio-border-glow);
          transform: translateY(-2px);
        }

        .signal-pulse {
          width: 6px;
          height: 6px;
          background: var(--color-accent);
          border-radius: 50%;
          box-shadow: 0 0 10px var(--color-accent);
          animation: pulse-ring 2s infinite;
        }

        @keyframes pulse-ring {
          0% { transform: scale(1); opacity: 1; }
          100% { transform: scale(2.5); opacity: 0; }
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

