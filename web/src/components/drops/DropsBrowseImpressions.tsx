"use client";

import { useEffect, useRef } from "react";
import type { BrowseDrop } from "../../lib/api";
import { recordProductAnalyticsFromBrowser } from "../../lib/productAnalytics";

export function DropsBrowseImpressions({ drops }: { drops: BrowseDrop[] }) {
  const recordedIds = useRef(new Set<string>());

  useEffect(() => {
    for (const drop of drops) {
      if (recordedIds.current.has(drop.id)) continue;
      recordedIds.current.add(drop.id);
      recordProductAnalyticsFromBrowser("punchline.drop_viewed", {
        payload: {
          dropId: drop.id,
          trackId: drop.trackId,
          momentCount: drop.moments.length,
          source: "drops_browse",
        },
      });
    }
  }, [drops]);

  return null;
}
