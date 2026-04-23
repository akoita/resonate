"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "../components/auth/AuthProvider";
import { listPublishedReleases, Release } from "../lib/api";
import { useWebSockets, ReleaseStatusUpdate } from "../hooks/useWebSockets";
import { useToast } from "../components/ui/Toast";
import { listCampaignsSync, getFeaturedCampaignSync, daysUntil, type Campaign } from "../lib/shows";
import { FALLBACK_RELEASES } from "../lib/fallbackReleases";

/*
 * Home page — Next-Gen Music Platform (Stitch design applied, 2026-04).
 *
 * Layout (top to bottom):
 *   1. Hero — featured campaign or release, glass card with CTA pair
 *   2. Filter chips — genre/mood quick-filters (client-side filter)
 *   3. Resume Playing — 4 square release cards with hover play overlay
 *   4. Trending Stems — 3 waveform-visualized stem cards
 *   5. Upcoming Live Events — 2 wide 16:9 campaign cards (Shows surface)
 *   6. Agentic Mixes — 5 circular AI-DJ mix presets
 *   7. Top Artists — horizontal pill row derived from catalog
 *
 * Source: Stitch project 8644925846196383098 "Next-Gen Music Platform - Home Page".
 * Icons use Material Symbols (loaded in app/layout.tsx).
 */

type FilterOption = "all" | "electronic" | "hip-hop" | "afrobeat" | "indie" | "jazz";

const FILTERS: { id: FilterOption; label: string }[] = [
  { id: "all", label: "All Trending" },
  { id: "electronic", label: "Electronic" },
  { id: "hip-hop", label: "Hip-Hop" },
  { id: "afrobeat", label: "Afrobeat" },
  { id: "indie", label: "Indie" },
  { id: "jazz", label: "Jazz" },
];

const AGENT_MIXES = [
  { id: "focus", title: "Focus: Neural Flow", bpm: "124", tint: "from-violet-500 to-indigo-600" },
  { id: "hype", title: "Hype: Pulse Raid", bpm: "145", tint: "from-fuchsia-500 to-rose-500" },
  { id: "chill", title: "Chill: Liquid Sky", bpm: "90", tint: "from-cyan-500 to-violet-500" },
  { id: "dark", title: "Dark: Abyss Shift", bpm: "130", tint: "from-red-900 to-black" },
  { id: "zen", title: "Zen: Static Calm", bpm: "60", tint: "from-amber-500 to-violet-800" },
];

export default function Home() {
  const router = useRouter();
  const [releases, setReleases] = useState<Release[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState<FilterOption>("all");
  const { status } = useAuth();
  const { addToast } = useToast();

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
    listPublishedReleases(12)
      .then(setReleases)
      .catch(() => setReleases([]))
      .finally(() => setLoading(false));
  }, [status]);

  // Prevent shimmer-forever: fall back to curated mock releases when the
  // catalog API is empty (fresh staging, backend blip).
  const displayReleases = useMemo<Release[]>(
    () => (!loading && releases.length === 0 ? FALLBACK_RELEASES : releases),
    [releases, loading],
  );

  // Client-side filter (genre match on `release.genre`, case-insensitive).
  const filteredReleases = useMemo<Release[]>(() => {
    if (activeFilter === "all") return displayReleases;
    return displayReleases.filter(
      (r) => (r.genre ?? "").toLowerCase().replace(/[\s/]/g, "-").includes(activeFilter),
    );
  }, [displayReleases, activeFilter]);

  // Row data derivation.
  const resumeRow = filteredReleases.slice(0, 4);
  const stemRow = filteredReleases.slice(0, 3);
  const campaigns = listCampaignsSync();
  const featuredCampaign = getFeaturedCampaignSync();
  const eventRow: Campaign[] = campaigns.slice(0, 2);

  // Derive top artists from the catalog (de-dup by primary artist name).
  const topArtists = useMemo(() => {
    const seen = new Set<string>();
    const out: { name: string; artistId?: string }[] = [];
    for (const r of displayReleases) {
      const name = r.primaryArtist || r.artist?.displayName;
      if (!name || seen.has(name)) continue;
      seen.add(name);
      out.push({ name, artistId: r.artist?.id || r.artistId });
      if (out.length >= 8) break;
    }
    return out;
  }, [displayReleases]);

  return (
    <div className="home-ng">
      <main className="ng-main">
        {/* 1. HERO ————————————————————————————————————————————————— */}
        <section className="ng-section ng-section--tight">
          <div className="ng-hero">
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

        {/* 3. RESUME PLAYING ———————————————————————————————————— */}
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

        {/* 4. TRENDING STEMS ———————————————————————————————————— */}
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

        {/* 5. UPCOMING LIVE EVENTS ————————————————————————————— */}
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

        {/* 6. AGENTIC MIXES ————————————————————————————————————— */}
        <section className="ng-section">
          <header className="ng-section-header">
            <div>
              <span className="ng-kicker ng-kicker--primary">AI generated sessions</span>
              <h3 className="ng-section-title">Agentic Mixes</h3>
            </div>
            <Link href="/agent" className="ng-section-link">
              Open AI DJ
              <span className="ms-icon" aria-hidden style={{ fontSize: 14 }}>arrow_forward</span>
            </Link>
          </header>
          <div className="ng-grid-5">
            {AGENT_MIXES.map((m) => (
              <Link key={m.id} href="/agent" className="ng-mix">
                <div className="ng-mix__avatar-wrap">
                  <div
                    className="ng-mix__avatar"
                    style={{
                      background: `linear-gradient(135deg, ${
                        {
                          focus: "#3b82f6, #7c3aed",
                          hype: "#ec4899, #f43f5e",
                          chill: "#06b6d4, #8b5cf6",
                          dark: "#450a0a, #0a0a0a",
                          zen: "#f59e0b, #4c1d95",
                        }[m.id]
                      })`,
                    }}
                  />
                </div>
                <p className="ng-mix__title">{m.title}</p>
                <p className="ng-mix__meta">BPM: {m.bpm} (Auto)</p>
              </Link>
            ))}
          </div>
        </section>

        {/* 7. TOP ARTISTS —————————————————————————————————————— */}
        {topArtists.length > 0 && (
          <section className="ng-section">
            <header className="ng-section-header">
              <div>
                <span className="ng-kicker ng-kicker--violet">Pioneer network</span>
                <h3 className="ng-section-title">Top Artists</h3>
              </div>
            </header>
            <div className="ng-artist-pills">
              {topArtists.map((a) => (
                <Link
                  key={a.name}
                  href={`/artist/${encodeURIComponent(a.artistId ?? a.name)}`}
                  className="ng-artist-pill"
                >
                  <span className="ng-artist-pill__avatar" aria-hidden>
                    {a.name[0]?.toUpperCase() ?? "?"}
                  </span>
                  <span>{a.name}</span>
                </Link>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

/* ----------- Trending-stem card (deterministic waveform) --------- */

const STEM_TONES = ["primary", "tertiary", "secondary"] as const;
const STEM_TAGS = ["Drums", "Vocals", "Synth"] as const;

function StemCard({ release, variantIndex }: { release: Release; variantIndex: number }) {
  const tone = STEM_TONES[variantIndex % STEM_TONES.length];
  const tag = STEM_TAGS[variantIndex % STEM_TAGS.length];
  // Deterministic bars (10) seeded by release id so rerenders don't jitter.
  const bars = useMemo(() => pseudoRandomBars(release.id, 10), [release.id]);
  const peakIdx = bars.indexOf(Math.max(...bars));

  return (
    <article className="ng-stem-card" data-tone={tone}>
      <div className="ng-stem-waveform" aria-hidden>
        {bars.map((h, i) => (
          <span
            key={i}
            className="ng-stem-waveform__bar"
            data-peak={i === peakIdx ? "true" : undefined}
            style={
              {
                height: `${h}%`,
                "--bar-opacity": `${20 + ((h * 70) / 100)}%`,
              } as React.CSSProperties
            }
          />
        ))}
      </div>
      <div className="ng-stem-card__body">
        <div className="ng-stem-card__head">
          <div>
            <h5 className="ng-stem-card__title">{release.title}</h5>
            <p className="ng-stem-card__from">
              From: {release.primaryArtist || release.artist?.displayName || "Unknown"}
            </p>
          </div>
          <span className="ng-stem-card__tag">{tag}</span>
        </div>
        <div className="ng-stem-card__actions">
          <Link
            href={`/release/${release.id}`}
            className="ng-stem-card__action ng-stem-card__action--flex"
            style={{ textAlign: "center" }}
          >
            Isolate
          </Link>
          <button
            type="button"
            className="ng-stem-card__action ng-stem-card__action--icon"
            aria-label="Download stem"
            onClick={(e) => e.preventDefault()}
          >
            <span className="ms-icon" aria-hidden style={{ fontSize: 16 }}>download</span>
          </button>
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
