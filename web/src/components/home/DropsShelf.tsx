"use client";

import { useEffect, useRef, useState } from "react";
import { fetchFeaturedDrops, type FeaturedDrop, type PunchlineMoment } from "../../lib/api";
import { recordProductAnalytics } from "../../lib/productAnalytics";
import { DropDiscoveryCard, discoveryMoment } from "../drops/DropDiscoveryCard";
import { HomeShelf } from "./HomeShelf";

/*
 * Home "Drops" shelf (#1479) — first-class discovery surface for drops.
 *
 * Umbrella-named "Drops" (NOT "Punchline Drops"): other drop kinds are coming
 * (#1476), so the section never needs renaming — each card carries a small
 * kind chip instead (DROP_KIND_LABEL, "Punchline" today).
 *
 * Cards reuse the shipped living-collectible card verbatim (seeded hue,
 * lyric-as-poster, serial №, waveform ribbon) plus a compact context footer:
 * kind chip · artist · track. Edition size, collected count, and price already
 * live on the card face, so the footer never duplicates them. One click lands
 * the visitor on the release page's collect module (`?focus=moments` scroll +
 * pulse).
 *
 * The shelf renders NOTHING when no published, still-collectable drops exist —
 * no dead shelf, no dead buttons. Funnel (#489): one `punchline.drop_viewed`
 * with `source: "home"` per shelf drop per page load.
 */

/** The card face: the first still-collectable moment, else the first moment. */
export function shelfMoment(drop: FeaturedDrop): PunchlineMoment | null {
  return discoveryMoment(drop);
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
    <HomeShelf
      kicker="Own a piece of the hook"
      kickerTone="violet"
      title="Drops"
      action={{ href: "/drops", label: "Browse all" }}
      itemWidth={280}
      testId="drops-shelf"
    >
      {drops.map((drop) => (
        <DropDiscoveryCard key={drop.id} drop={drop} testId="drops-shelf-card" />
      ))}
    </HomeShelf>
  );
}
