"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { type TopArtistItem, type TrendingTrackItem } from "../../lib/api";
import { artistProfileHref, catalogArtistHref, publicReleaseHref } from "../../lib/artistRoutes";
import { HomeReleaseArtwork } from "./HomeReleaseArtwork";
import { HomeShelf, type ShelfTone } from "./HomeShelf";
import { HomeTile } from "./HomeTile";
import type { RailState } from "./railState";

export type { RailState } from "./railState";

/*
 * Home popularity rails (#1451 WS-4) — engagement-ranked Trending Now and
 * Top Artists, fed by /catalog/trending and /catalog/top-artists.
 *
 * Honesty contract (#2228): a rail is in exactly one of three states.
 *   - `loading`: still fetching (render nothing);
 *   - `ready`:   the served ranking; an empty `items` array means the catalog
 *                is below the minimum-audience threshold, and the rail says so;
 *   - `error`:   the request failed — say the charts are unavailable, which is
 *                different from "not enough listening yet".
 * No state ever falls back to upload recency.
 */

/** User Guide entry explaining which listens count toward the charts (#2229). */
export const CHARTS_HELP_HREF = "/help/discover-music#charts-listens";

function listenersLabel(count: number) {
  return `${count} ${count === 1 ? "listener" : "listeners"}`;
}

function LowDataNotice({ subject, genreLabel }: { subject: string; genreLabel?: string }) {
  return (
    <p className="ng-play-card__artist ng-popularity-empty" style={{ opacity: 0.75 }}>
      Not enough listening yet{genreLabel ? ` in ${genreLabel}` : ""} to rank {subject}{" "}
      honestly — charts appear once more people press play.{" "}
      <Link
        href={CHARTS_HELP_HREF}
        className="ng-popularity-empty__why"
        aria-label="Why? Which listens count toward the charts"
      >
        Why?
      </Link>
    </p>
  );
}

function UnavailableNotice() {
  return (
    <p className="ng-play-card__artist ng-popularity-empty" style={{ opacity: 0.75 }} role="status">
      Charts are unavailable right now.
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
  state,
  genreLabel,
  queueable = false,
}: {
  state: RailState<TrendingTrackItem>;
  genreLabel?: string;
  /** Offer Play Next / Add to Queue on each tile. Needs the player provider. */
  queueable?: boolean;
}) {
  if (state.status === "loading") return null;
  const meta = <span className="ng-shelf__meta">Last 7 days</span>;
  if (state.status === "error") {
    return (
      <LowDataSection kicker="What listeners play" kickerTone="tertiary" title="Trending Now" meta={meta}>
        <UnavailableNotice />
      </LowDataSection>
    );
  }
  const { items } = state;
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
          queueTarget={
            queueable
              ? { kind: "track", title: item.title, releaseId: item.releaseId, trackId: item.trackId }
              : undefined
          }
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
  state,
  genreLabel,
  coverFallbacks,
  queueable = false,
}: {
  state: RailState<TopArtistItem>;
  genreLabel?: string;
  /** Offer Play Next / Add to Queue (all of the artist's tracks) on each tile. */
  queueable?: boolean;
  /** Newest release cover per artist id, used when `imageUrl` is missing. */
  coverFallbacks?: Record<string, ArtistCoverFallback>;
}) {
  if (state.status === "loading") return null;
  if (state.status === "error") {
    return (
      <LowDataSection kicker="Most listened, last 7 days" kickerTone="violet" title="Top Artists">
        <UnavailableNotice />
      </LowDataSection>
    );
  }
  const { items } = state;
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
          queueTarget={
            queueable ? { kind: "artistRef", title: a.name, artistId: a.artistId, name: a.name } : undefined
          }
        />
      ))}
    </HomeShelf>
  );
}
