import type { ArtistActionCard } from "./analytics.service";
import type { UnmetDemandResult, UnmetDemandRow } from "../scene_scout/unmet_demand.contracts";
import { sceneScoutMinimumAudience } from "../scene_scout/scene_scout.service";

/** Only catalog/category totals reach the artist action cockpit. */
export function unmetDemandCards(result: UnmetDemandResult | undefined): ArtistActionCard[] {
  if (result?.status !== "ready") return [];
  const rows = new Map<string, UnmetDemandRow>();
  for (const row of result.demand) {
    if (row.distinctRequesters < sceneScoutMinimumAudience() || row.requestCount < 5) continue;
    const key = `${row.targetType}:${row.trackId ?? ""}:${row.kind}:${row.value}`;
    const previous = rows.get(key);
    if (!previous || row.windowDays > previous.windowDays) rows.set(key, row);
  }
  return [...rows.values()].sort((a, b) => b.requestCount - a.requestCount).slice(0, 6).map((row) => {
    const trackTarget = row.targetType === "track" && row.releaseId && row.trackId && row.trackTitle;
    const supplyTarget = trackTarget && (row.kind === "stem" || row.kind === "license");
    const params = new URLSearchParams({ demandTrack: row.trackId ?? "" });
    if (supplyTarget) params.set(row.kind === "stem" ? "demandStem" : "demandLicense", row.value);
    return {
      id: `unmet_demand:${row.targetType}:${row.trackId ?? "artist"}:${row.kind}:${row.value}:${row.windowDays}`,
      type: "review_unmet_demand",
      title: supplyTarget ? `Review ${row.value} ${row.kind} supply` : `Review unmet ${row.kind} demand`,
      description: trackTarget ? `Requests for ${row.trackTitle} came up short.` : `Requests matching your catalog came up short for ${row.value}.`,
      reason: `${row.requestCount} requests from ${row.distinctRequesters} people in ${row.windowDays} days. This is a supply gap, not a forecast of sales.`,
      priority: row.requestCount >= 25 ? "high" : "medium",
      confidence: row.requestCount >= 25 ? 0.8 : 0.66,
      sourceSignal: { category: "catalog", summary: "Qualified categorical request shortfalls", count: row.requestCount },
      cta: {
        label: supplyTarget ? (row.kind === "stem" ? "Publish this stem" : "List this license") : "Review catalog",
        href: supplyTarget ? `/release/${encodeURIComponent(row.releaseId!)}?${params.toString()}#scene-scout-supply` : "/artist/catalog",
      },
      privacy: { aggregateOnly: true, thresholdApplied: true, minimumThreshold: 5 },
    };
  });
}
