"use client";

import {
  type HomeFeedItem,
  type HomeFeedRail,
  type HomeFeedResponse,
} from "../../lib/api";
import { HomeReleaseArtwork } from "./HomeReleaseArtwork";
import { HomeShelf, type ShelfTone } from "./HomeShelf";
import { HomeTile } from "./HomeTile";

/*
 * Home feed v2 (#1454 WS-7) — multi-rail personalized feed.
 *
 * Presentation only: rail composition, explanations, diversity caps, and
 * rotation are decided server-side (home-feed.service.ts). Contract here:
 *   - `feed === null` → still loading (render nothing);
 *   - `feed.rails === []` → honest empty state, never a catalog fallback
 *     pretending to be personal;
 *   - every explanation string is categorical — this component never
 *     fabricates a reason.
 */

const RAIL_KICKERS: Record<HomeFeedRail["kind"], { label: string; tone: ShelfTone }> = {
  because_genre: { label: "Personalized picks", tone: "violet" },
  new_from_artists: { label: "Your artists", tone: "violet" },
  trending_genre: { label: "What listeners play", tone: "tertiary" },
  exploration: { label: "Exploration", tone: "tertiary" },
  catalog_signal: { label: "Catalog signal", tone: "tertiary" },
};

function reasonLabel(item: HomeFeedItem): string {
  const meaningful = item.reasons.filter(
    (reason) => reason && !reason.startsWith("downranked:"),
  );
  const cohort = meaningful.find((reason) => reason.startsWith("cohort:"));
  if (cohort) {
    const label = cohort.slice("cohort:".length).trim();
    return label ? `From your ${label} cohort` : "Cohort signal";
  }
  const first = meaningful[0];
  if (!first) return "Catalog signal";
  if (first.startsWith("genre:")) return "Taste match";
  if (first.startsWith("mood:")) return "Mood match";
  if (first.startsWith("trending:")) return "Trending";
  if (first.startsWith("artist:")) return "Artist you play";
  if (first.startsWith("exploration:")) return "Fresh find";
  if (first.startsWith("catalog:")) return "Catalog signal";
  return first.replace(/_/g, " ");
}

export function HomeFeedRails({
  feed,
  startingSeed,
  onOpen,
  onStartSession,
}: {
  feed: HomeFeedResponse | null;
  startingSeed?: string | null;
  onOpen?: (item: HomeFeedItem, railId: string, position: number) => void;
  onStartSession?: (item: HomeFeedItem, railId: string, position: number) => void;
}) {
  if (feed === null) return null;

  if (feed.rails.length === 0) {
    return (
      <section className="ng-section ng-shelf" data-testid="home-feed-empty">
        <header className="ng-shelf__header">
          <div className="ng-shelf__heading">
            <span className="ng-kicker ng-kicker--violet">Personalized picks</span>
            <h3 className="ng-section-title">Your feed is warming up</h3>
            <p className="ng-shelf__description">
              Nothing to rank honestly yet — play a few tracks or save a genre and
              this page starts working for you.
            </p>
          </div>
        </header>
      </section>
    );
  }

  return (
    <>
      {feed.rails.map((rail) => {
        const kicker = RAIL_KICKERS[rail.kind] ?? RAIL_KICKERS.catalog_signal;
        return (
          <HomeShelf
            key={rail.id}
            kicker={kicker.label}
            kickerTone={kicker.tone}
            title={rail.title}
            description={rail.explanation}
            action={rail.kind === "because_genre" ? { href: "/agent", label: "Open AI DJ" } : undefined}
            railKind={rail.kind}
            itemWidth={196}
          >
            {rail.items.map((item, position) => {
              const seedKey = item.id;
              const starting = startingSeed === seedKey;
              return (
                <HomeTile
                  key={item.id}
                  href={`/release/${item.releaseId}`}
                  onOpen={() => onOpen?.(item, rail.id, position)}
                  art={
                    item.artworkMimeType ? (
                      <HomeReleaseArtwork
                        releaseId={item.releaseId}
                        mimeType={item.artworkMimeType}
                        artworkRevision={item.artworkRevision}
                        alt=""
                        sizes="(max-width: 767px) 160px, 196px"
                      />
                    ) : (
                      <span className="ng-monogram" aria-hidden>
                        {(item.title[0] ?? "?").toUpperCase()}
                      </span>
                    )
                  }
                  title={item.title}
                  subtitle={item.artist ?? "Unknown Artist"}
                  meta={item.genre || "Discovery"}
                  // A chip that only repeats the rail's own kicker adds noise.
                  badge={reasonLabel(item) === kicker.label ? undefined : reasonLabel(item)}
                  aiDisclosure={item.aiDisclosure}
                  action={
                    onStartSession ? (
                      <button
                        type="button"
                        className="ng-tile__action"
                        aria-label={`Start session from ${item.title}`}
                        title="Start an AI DJ session seeded by this track"
                        onClick={() => onStartSession(item, rail.id, position)}
                        disabled={starting}
                      >
                        <span className="ms-icon" data-fill="1" aria-hidden>
                          {starting ? "hourglass_top" : "auto_awesome"}
                        </span>
                      </button>
                    ) : undefined
                  }
                />
              );
            })}
          </HomeShelf>
        );
      })}
    </>
  );
}
