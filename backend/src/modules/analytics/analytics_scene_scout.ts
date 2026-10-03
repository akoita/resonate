import type { ArtistActionCard } from "./analytics.service";
import { sceneScoutMeetsServingThreshold, type SceneScoutResult } from "../scene_scout/scene_scout.service";

/** Counts only. The source applies the audience floor before storage/reads. */
export function sceneScoutCityCards(result: SceneScoutResult | undefined): ArtistActionCard[] {
  if (result?.status !== "ready") return [];
  const cities = new Map<string, SceneScoutResult["cityDemand"][number]>();
  for (const row of result.cityDemand) {
    if (!sceneScoutMeetsServingThreshold(row)) continue;
    const key = `${row.releaseId}:${row.countryCode}:${row.citySlug}`;
    const previous = cities.get(key);
    if (!previous || row.windowDays > previous.windowDays) cities.set(key, row);
  }
  return [...cities.values()].sort((a, b) => b.signalCount - a.signalCount)
    .slice(0, 6).map((row) => {
    const city = row.citySlug.split("-").map((part) => part[0].toUpperCase() + part.slice(1)).join(" ");
    const params = new URLSearchParams({ city: row.citySlug, country: row.countryCode, releaseId: row.releaseId });
    return {
      id: `propose_show_city:${row.releaseId}:${row.countryCode}:${row.citySlug}:${row.windowDays}`,
      type: "propose_show_city",
      title: `Consider a show in ${city}`,
      description: `${row.releaseTitle} has qualified listening demand in ${city}, ${row.countryCode}.`,
      reason: `${row.uniqueListeners} listeners; ${row.resonantListeners} resonated, ${row.saves} saved, ${row.purchases} purchased in ${row.windowDays} days.`,
      priority: row.signalCount >= 25 ? "high" : "medium",
      confidence: row.signalCount >= 25 ? 0.8 : 0.66,
      sourceSignal: { category: "playback", summary: "Qualified release and city demand", count: row.signalCount },
      cta: { label: "Draft a show", href: `/shows/create?${params.toString()}` },
      privacy: { aggregateOnly: true, thresholdApplied: true, minimumThreshold: 5 },
    };
  });
}
