"use client";

import Link from "next/link";
import { getReleaseArtworkUrl, type TopArtistItem, type TrendingTrackItem } from "../../lib/api";
import { artistProfileHref } from "../../lib/artistRoutes";

/*
 * Home popularity rails (#1451 WS-4) — engagement-ranked Trending Now and
 * Top Artists, fed by /catalog/trending and /catalog/top-artists.
 *
 * Honesty contract: `items === null` means still loading (render nothing);
 * an empty array means the catalog is below the minimum-audience threshold,
 * and the rail says so explicitly — it never falls back to upload recency.
 */

function listenersLabel(count: number) {
  return `${count} ${count === 1 ? "listener" : "listeners"}`;
}

function LowDataNotice({ subject, genreLabel }: { subject: string; genreLabel?: string }) {
  return (
    <p className="ng-play-card__artist ng-popularity-empty" style={{ opacity: 0.75 }}>
      Not enough listening yet{genreLabel ? ` in ${genreLabel}` : ""} to rank {subject}{" "}
      honestly — charts appear once more people press play.
    </p>
  );
}

export function TrendingNowRail({
  items,
  genreLabel,
}: {
  items: TrendingTrackItem[] | null;
  genreLabel?: string;
}) {
  if (items === null) return null;
  return (
    <section className="ng-section">
      <header className="ng-section-header">
        <div>
          <span className="ng-kicker ng-kicker--tertiary">What listeners play</span>
          <h3 className="ng-section-title">Trending Now</h3>
        </div>
        <span className="ng-section-link" style={{ cursor: "default", opacity: 0.7 }}>
          Last 7 days
        </span>
      </header>
      {items.length > 0 ? (
        <div className="ng-grid-4">
          {items.slice(0, 8).map((item) => (
            <Link
              key={item.trackId}
              href={`/release/${item.releaseId}`}
              className="ng-play-card ng-glass"
              style={{ borderRadius: 20, position: "relative" }}
            >
              <div className="ng-play-card__art">
                {item.artworkUrl || item.artworkMimeType ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.artworkUrl ?? getReleaseArtworkUrl(item.releaseId)}
                    alt={item.title}
                  />
                ) : (
                  <span className="ng-monogram" aria-hidden>
                    {(item.title?.[0] ?? "?").toUpperCase()}
                  </span>
                )}
                <div className="ng-play-card__overlay">
                  <span className="ms-icon" data-fill="1" aria-hidden>play_circle</span>
                </div>
                <span
                  aria-label={`Rank ${item.rank}`}
                  style={{
                    position: "absolute",
                    top: 10,
                    left: 10,
                    fontSize: 12,
                    fontWeight: 800,
                    letterSpacing: "0.04em",
                    padding: "2px 9px",
                    borderRadius: 999,
                    background: "rgba(10, 10, 18, 0.72)",
                    border: "1px solid rgba(255, 255, 255, 0.18)",
                    backdropFilter: "blur(6px)",
                  }}
                >
                  #{item.rank}
                </span>
              </div>
              <h4 className="ng-play-card__title">{item.title}</h4>
              <p className="ng-play-card__artist">
                {item.artist ?? "Unknown"} · {listenersLabel(item.uniqueListeners)}
              </p>
            </Link>
          ))}
        </div>
      ) : (
        <LowDataNotice subject="tracks" genreLabel={genreLabel} />
      )}
    </section>
  );
}

export function TopArtistsRail({
  items,
  genreLabel,
}: {
  items: TopArtistItem[] | null;
  genreLabel?: string;
}) {
  if (items === null) return null;
  return (
    <section className="ng-section">
      <header className="ng-section-header">
        <div>
          <span className="ng-kicker ng-kicker--violet">Most listened, last 7 days</span>
          <h3 className="ng-section-title">Top Artists</h3>
        </div>
      </header>
      {items.length > 0 ? (
        <div className="ng-artist-pills">
          {items.map((a) => (
            <Link
              key={a.artistId}
              href={artistProfileHref(a.artistId)}
              className="ng-artist-pill"
              title={`#${a.rank} · ${listenersLabel(a.uniqueListeners)}`}
            >
              <span className="ng-artist-pill__avatar" aria-hidden>
                {a.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={a.imageUrl}
                    alt=""
                    style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "inherit" }}
                  />
                ) : (
                  a.name[0]?.toUpperCase() ?? "?"
                )}
              </span>
              <span>
                <span style={{ opacity: 0.6, fontWeight: 800, marginRight: 6 }}>#{a.rank}</span>
                {a.name}
              </span>
            </Link>
          ))}
        </div>
      ) : (
        <LowDataNotice subject="artists" genreLabel={genreLabel} />
      )}
    </section>
  );
}
