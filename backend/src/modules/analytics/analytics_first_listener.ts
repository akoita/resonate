import type { ArtistActionCard } from "./analytics.service";
import type { FirstListenerArtistReception } from "../recommendations/first_listener.contracts";
import { sceneScoutMinimumAudience } from "../scene_scout/scene_scout.service";

export const FIRST_LISTENER_RECEPTION_SOURCE = Symbol("FIRST_LISTENER_RECEPTION_SOURCE");
export interface FirstListenerReceptionSource {
  getArtistReception(artistId: string): Promise<FirstListenerArtistReception>;
}

export function entitledFirstListenerReceptionSource(
  source: FirstListenerReceptionSource,
  entitlements: { canRead(artistId: string): Promise<boolean> },
): FirstListenerReceptionSource {
  return {
    async getArtistReception(artistId) {
      if (!await entitlements.canRead(artistId)) {
        return { available: false, minimumAudience: sceneScoutMinimumAudience(), releases: [] };
      }
      return source.getArtistReception(artistId);
    },
  };
}

export function firstListenerReceptionCards(result: FirstListenerArtistReception | undefined): ArtistActionCard[] {
  if (!result?.available) return [];
  const threshold = Math.max(5, sceneScoutMinimumAudience(), result.minimumAudience);
  return result.releases.filter((release) => Number.isSafeInteger(release.heard) && release.heard! >= threshold)
    .slice(0, 6).map((release) => {
      const fullPlays = release.fullPlays === null ? "full plays: not enough data" : `${release.fullPlays} played through`;
      const saves = release.saves === null ? "saves: not enough data" : `${release.saves} saved`;
      return {
        id: `first_listener_reception:${release.releaseId}`,
        type: "review_first_listener_reception",
        title: `First-week reception for ${release.title}`,
        description: "See how fitting listeners responded after a discovery placement in this release's first seven catalog days.",
        reason: `${release.heard} listeners heard it; ${fullPlays}; ${saves}. Counts use actual listening after placement.`,
        priority: "medium",
        confidence: 0.75,
        sourceSignal: { category: "playback", summary: "Consent-qualified first-week discovery reception", count: release.heard! },
        cta: { label: "Review release", href: `/release/${encodeURIComponent(release.releaseId)}` },
        privacy: { aggregateOnly: true, thresholdApplied: true, minimumThreshold: threshold },
      };
    });
}
