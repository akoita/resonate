"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { fetchFeaturedDrops, type FeaturedDrop, type PunchlineMoment } from "../../lib/api";
import { recordProductAnalytics } from "../../lib/productAnalytics";
import { PunchlineCollectibleCard } from "../punchline/PunchlineCollectibleCard";
import { DROP_KIND_LABEL } from "../punchline/punchlineDropHelpers";
import { formatEditionsRemaining } from "../punchline/punchlineCollectHelpers";

/*
 * Home "Drops" shelf (#1479) — first-class discovery surface for drops.
 *
 * Umbrella-named "Drops" (NOT "Punchline Drops"): other drop kinds are coming
 * (#1476), so the section never needs renaming — each card carries a small
 * kind chip instead (DROP_KIND_LABEL, "Punchline" today).
 *
 * Cards reuse the shipped living-collectible card verbatim (seeded hue,
 * lyric-as-poster, serial №, waveform ribbon) plus a compact context footer:
 * artist · track · scarcity numerals · price. One click lands the visitor on
 * the release page's collect module (`?focus=moments` scroll + pulse).
 *
 * The shelf renders NOTHING when no published, still-collectable drops exist —
 * no dead shelf, no dead buttons. Funnel (#489): one `punchline.drop_viewed`
 * with `source: "home"` per shelf drop per page load.
 */

/** The card face: the first still-collectable moment, else the first moment. */
export function shelfMoment(drop: FeaturedDrop): PunchlineMoment | null {
  return (
    drop.moments.find((moment) => moment.collectedCount < moment.editionSize) ??
    drop.moments[0] ??
    null
  );
}

export function formatPrice(priceCents: number): string {
  if (priceCents <= 0) return "Free to collect";
  return `$${(priceCents / 100).toFixed(2)}`;
}

/** Fetching wrapper: loads featured drops and emits shelf impressions. */
export function DropsShelf({ token }: { token?: string | null }) {
  const [drops, setDrops] = useState<FeaturedDrop[]>([]);
  // Impressions read the freshest token without re-triggering the fetch.
  const tokenRef = useRef(token);
  useEffect(() => {
    tokenRef.current = token;
  }, [token]);

  useEffect(() => {
    let cancelled = false;
    fetchFeaturedDrops(6)
      .then((result) => {
        if (cancelled) return;
        const items = result.items ?? [];
        setDrops(items);
        // Funnel (#489): one drop_viewed per shelf drop per page load —
        // `source: "home"` makes Home vs release-page conversion comparable.
        for (const drop of items) {
          void recordProductAnalytics(tokenRef.current, "punchline.drop_viewed", {
            payload: {
              dropId: drop.id,
              trackId: drop.trackId,
              momentCount: drop.moments.length,
              source: "home",
            },
          });
        }
      })
      .catch(() => {
        if (!cancelled) setDrops([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return <DropsShelfView drops={drops} />;
}

/** Presentational shelf — renders NOTHING when there are no drops (no dead shelf). */
export function DropsShelfView({ drops }: { drops: FeaturedDrop[] }) {
  if (drops.length === 0) return null;

  return (
    <section className="ng-section" data-testid="drops-shelf">
      <header className="ng-section-header">
        <div>
          <span className="ng-kicker ng-kicker--violet">Own a piece of the hook</span>
          <h3 className="ng-section-title">Drops</h3>
        </div>
      </header>
      <div className="ng-grid-3" style={{ alignItems: "stretch" }}>
        {drops.map((drop) => {
          const moment = shelfMoment(drop);
          if (!moment) return null;
          return (
            <Link
              key={drop.id}
              href={`/release/${drop.context.releaseId}?focus=moments`}
              className="ng-glass"
              style={{
                display: "block",
                borderRadius: 20,
                padding: 14,
                textDecoration: "none",
                color: "inherit",
                position: "relative",
              }}
              aria-label={`Collect ${moment.title} from ${drop.context.trackTitle}`}
            >
              <span
                className="punchline-kind-chip"
                style={{ position: "absolute", top: 22, right: 22, zIndex: 2 }}
              >
                {DROP_KIND_LABEL}
              </span>
              <PunchlineCollectibleCard
                title={moment.title}
                lyricText={moment.lyricText}
                artworkUrl={moment.artworkUrl}
                durationMs={moment.endMs - moment.startMs}
                editionSize={moment.editionSize}
                priceCents={moment.priceCents}
                rightsLabel={moment.rightsLabel}
                collectedCount={moment.collectedCount}
              />
              <p
                className="ng-play-card__artist"
                style={{
                  marginTop: 10,
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "4px 8px",
                  alignItems: "baseline",
                }}
              >
                <strong style={{ fontWeight: 700 }}>
                  {drop.context.artistName ?? "Unknown artist"}
                </strong>
                <span style={{ opacity: 0.7 }}>· {drop.context.trackTitle}</span>
                <span style={{ opacity: 0.9, fontVariantNumeric: "tabular-nums" }}>
                  · {formatEditionsRemaining(moment.editionSize, moment.collectedCount)}
                </span>
                <span style={{ opacity: 0.9 }}>· {formatPrice(moment.priceCents)}</span>
              </p>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
