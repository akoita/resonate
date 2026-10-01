import type { HomeFeedRail, HomeFeedResponse } from "./api";
import type { ProductAnalyticsPayload } from "./productAnalytics";

/**
 * Payloads for the Home ranking events (#1449 WS-2, #1455 WS-8). The feed's
 * `rankerVariant` / `experimentKey` labels ride on every served and clicked
 * event so the quality dashboard can compare variants. Labels only.
 */

type FeedLabels = Pick<HomeFeedResponse, "requestId" | "rankerVariant" | "experimentKey">;

export function buildRecommendationServedPayload(
  feed: FeedLabels,
  rail: Pick<HomeFeedRail, "id" | "items">,
): ProductAnalyticsPayload {
  return {
    requestId: feed.requestId,
    railId: rail.id,
    trackIds: rail.items.map((item) => item.id),
    count: rail.items.length,
    source: "home",
    rankerVariant: feed.rankerVariant,
    experimentKey: feed.experimentKey ?? undefined,
  };
}

export function buildRecommendationClickedPayload(
  feed: Partial<FeedLabels> | null | undefined,
  input: { railId: string; trackId: string; position: number },
): ProductAnalyticsPayload {
  return {
    requestId: feed?.requestId ?? null,
    railId: input.railId,
    trackId: input.trackId,
    position: input.position,
    source: "home",
    rankerVariant: feed?.rankerVariant,
    experimentKey: feed?.experimentKey ?? undefined,
  };
}
