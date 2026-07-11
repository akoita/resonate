"use client";

import Link from "next/link";
import {
  getReleaseArtworkUrl,
  type HomeFeedItem,
  type HomeFeedRail,
  type HomeFeedResponse,
} from "../../lib/api";

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

const RAIL_KICKERS: Record<HomeFeedRail["kind"], { label: string; className: string }> = {
  because_genre: { label: "Personalized picks", className: "ng-kicker--violet" },
  new_from_artists: { label: "Your artists", className: "ng-kicker--violet" },
  trending_genre: { label: "What listeners play", className: "ng-kicker--tertiary" },
  exploration: { label: "Exploration", className: "ng-kicker--tertiary" },
  catalog_signal: { label: "Catalog signal", className: "ng-kicker--tertiary" },
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
      <section className="ng-section" data-testid="home-feed-empty">
        <header className="ng-section-header">
          <div>
            <span className="ng-kicker ng-kicker--violet">Personalized picks</span>
            <h3 className="ng-section-title">Your feed is warming up</h3>
          </div>
        </header>
        <p className="ng-play-card__artist" style={{ opacity: 0.75 }}>
          Nothing to rank honestly yet — play a few tracks or save a genre and
          this page starts working for you.
        </p>
      </section>
    );
  }

  return (
    <>
      {feed.rails.map((rail) => {
        const kicker = RAIL_KICKERS[rail.kind] ?? RAIL_KICKERS.catalog_signal;
        return (
          <section className="ng-section" key={rail.id} data-rail-kind={rail.kind}>
            <header className="ng-section-header">
              <div>
                <span className={`ng-kicker ${kicker.className}`}>{kicker.label}</span>
                <h3 className="ng-section-title">{rail.title}</h3>
                <p
                  className="ng-play-card__artist"
                  style={{ opacity: 0.7, marginTop: 4, maxWidth: 560 }}
                >
                  {rail.explanation}
                </p>
              </div>
              {rail.kind === "because_genre" && (
                <Link href="/agent" className="ng-section-link">
                  Open AI DJ
                  <span className="ms-icon" aria-hidden style={{ fontSize: 14 }}>arrow_forward</span>
                </Link>
              )}
            </header>
            <div className="ng-recommendation-grid">
              {rail.items.map((item, position) => {
                const seedKey = item.id;
                return (
                  <article key={item.id} className="ng-recommendation-card ng-glass">
                    <Link
                      href={`/release/${item.releaseId}`}
                      className="ng-recommendation-card__art"
                      aria-label={`Open ${item.title}`}
                      onClick={() => onOpen?.(item, rail.id, position)}
                    >
                      {item.artworkMimeType ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={getReleaseArtworkUrl(item.releaseId)} alt="" />
                      ) : (
                        <span className="ng-monogram" aria-hidden>
                          {(item.title[0] ?? "?").toUpperCase()}
                        </span>
                      )}
                    </Link>
                    <div className="ng-recommendation-card__body">
                      <h4>{item.title}</h4>
                      <p>{item.artist ?? "Unknown Artist"}</p>
                      <div className="ng-recommendation-card__meta">
                        <span>{item.genre || "Discovery"}</span>
                        <span>{reasonLabel(item)}</span>
                      </div>
                      {onStartSession && (
                        <button
                          type="button"
                          className="ng-recommendation-card__action"
                          onClick={() => onStartSession(item, rail.id, position)}
                          disabled={startingSeed === seedKey}
                        >
                          <span className="ms-icon" data-fill="1" aria-hidden>
                            {startingSeed === seedKey ? "hourglass_top" : "play_arrow"}
                          </span>
                          {startingSeed === seedKey ? "Starting" : "Start session"}
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        );
      })}
    </>
  );
}
