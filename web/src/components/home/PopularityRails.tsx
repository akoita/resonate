"use client";

import type { ReactNode } from "react";
import { type TopArtistItem, type TrendingTrackItem } from "../../lib/api";
import { artistProfileHref, catalogArtistHref, publicReleaseHref } from "../../lib/artistRoutes";
import { HomeReleaseArtwork } from "./HomeReleaseArtwork";
import { HomeShelf, type ShelfTone } from "./HomeShelf";
import { HomeTile } from "./HomeTile";

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

/** Header-only section used for the honest low-data state (no empty shelf). */
function LowDataSection({
  kicker,
  kickerTone,
  title,
  meta,
  children,
}: {
  kicker: string;
  kickerTone: ShelfTone;
  title: string;
  meta?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="ng-section ng-shelf">
      <header className="ng-shelf__header">
        <div className="ng-shelf__heading">
          <span className={`ng-kicker ng-kicker--${kickerTone}`}>{kicker}</span>
          <h3 className="ng-section-title">{title}</h3>
        </div>
        {meta ? <div className="ng-shelf__aside">{meta}</div> : null}
      </header>
      {children}
    </section>
  );
}

function RankBadge({ rank }: { rank: number }) {
  return <span aria-label={`Rank ${rank}`}>#{rank}</span>;
}

export function TrendingNowRail({
  items,
  genreLabel,
}: {
  items: TrendingTrackItem[] | null;
  genreLabel?: string;
}) {
  if (items === null) return null;
  const meta = <span className="ng-shelf__meta">Last 7 days</span>;
  if (items.length === 0) {
    return (
      <LowDataSection kicker="What listeners play" kickerTone="tertiary" title="Trending Now" meta={meta}>
        <LowDataNotice subject="tracks" genreLabel={genreLabel} />
      </LowDataSection>
    );
  }
  return (
    <HomeShelf
      kicker="What listeners play"
      kickerTone="tertiary"
      title="Trending Now"
      meta={meta}
      itemWidth={196}
    >
      {items.slice(0, 8).map((item) => (
        <HomeTile
          key={item.trackId}
          href={publicReleaseHref(item.releaseId)}
          art={
            item.artworkMimeType ? (
              <HomeReleaseArtwork
                releaseId={item.releaseId}
                mimeType={item.artworkMimeType}
                artworkRevision={item.artworkRevision}
                alt={item.title}
                sizes="(max-width: 767px) 160px, 196px"
              />
            ) : item.artworkUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- URL-only legacy artwork is not trusted by the optimizer
              <img src={item.artworkUrl} alt={item.title} />
            ) : (
              <span className="ng-monogram" aria-hidden>
                {(item.title?.[0] ?? "?").toUpperCase()}
              </span>
            )
          }
          title={item.title}
          subtitle={item.artist ?? "Unknown"}
          meta={listenersLabel(item.uniqueListeners)}
          badge={<RankBadge rank={item.rank} />}
          aiDisclosure={item.aiDisclosure}
        />
      ))}
    </HomeShelf>
  );
}

/** Cover art shown in place of a missing artist portrait. */
export type ArtistCoverFallback = {
  releaseId: string;
  mimeType: string;
  artworkRevision?: number | null;
};

export function TopArtistsRail({
  items,
  genreLabel,
  coverFallbacks,
}: {
  items: TopArtistItem[] | null;
  genreLabel?: string;
  /** Newest release cover per artist id, used when `imageUrl` is missing. */
  coverFallbacks?: Record<string, ArtistCoverFallback>;
}) {
  if (items === null) return null;
  if (items.length === 0) {
    return (
      <LowDataSection kicker="Most listened, last 7 days" kickerTone="violet" title="Top Artists">
        <LowDataNotice subject="artists" genreLabel={genreLabel} />
      </LowDataSection>
    );
  }
  return (
    <HomeShelf
      kicker="Most listened, last 7 days"
      kickerTone="violet"
      title="Top Artists"
      itemWidth={148}
    >
      {items.map((a) => (
        <HomeTile
          key={a.artistId ?? a.name}
          shape="round"
          showAiDisclosure={false}
          href={a.artistId ? artistProfileHref(a.artistId) : catalogArtistHref(a.name)}
          ariaLabel={`Open ${a.name}`}
          art={
            <span className="ng-tile__portrait" aria-hidden>
              <span className="ng-tile__initial">{a.name[0]?.toUpperCase() ?? "?"}</span>
              {a.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={a.imageUrl}
                  alt=""
                  onError={(event) => {
                    event.currentTarget.style.display = "none";
                  }}
                />
              ) : a.artistId && coverFallbacks?.[a.artistId] ? (
                <HomeReleaseArtwork
                  releaseId={coverFallbacks[a.artistId].releaseId}
                  mimeType={coverFallbacks[a.artistId].mimeType}
                  artworkRevision={coverFallbacks[a.artistId].artworkRevision}
                  alt=""
                  sizes="132px"
                />
              ) : null}
            </span>
          }
          title={a.name}
          meta={listenersLabel(a.uniqueListeners)}
          badge={<RankBadge rank={a.rank} />}
        />
      ))}
    </HomeShelf>
  );
}
