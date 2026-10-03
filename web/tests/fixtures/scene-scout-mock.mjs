/** Deterministic artist data shared by the guide capture and browser flow. */
export async function mockSceneScoutApi(page, variant = "city") {
  const artistId = "test-artist-id";
  const timestamp = "2026-10-03T09:00:00.000Z";
  const actions = variant === "demand" ? [{
    id: "unmet_demand:track:guide-track:stem:vocals:28", type: "review_unmet_demand",
    title: "Review vocals stem supply", description: "Requests for First Light came up short.",
    reason: "14 requests from 8 people in 28 days. This is a supply gap, not a forecast of sales.",
    priority: "medium", confidence: 0.66,
    sourceSignal: { category: "catalog", summary: "Qualified categorical request shortfalls", count: 14 },
    cta: { label: "Publish this stem", href: "/release/guide-first-light?demandTrack=guide-track&demandStem=vocals#scene-scout-supply" },
    privacy: { aggregateOnly: true, thresholdApplied: true, minimumThreshold: 5 },
  }] : variant === "reception" ? [{
    id: "first_listener_reception:guide-first-light", type: "review_first_listener_reception",
    title: "First-week reception for First Light",
    description: "See how fitting listeners responded after a discovery placement in this release's first seven catalog days.",
    reason: "28 listeners heard it; 18 played through; 8 saved. Counts use actual listening after placement.",
    priority: "medium", confidence: 0.75,
    sourceSignal: { category: "playback", summary: "Consent-qualified first-week discovery reception", count: 28 },
    cta: { label: "Review release", href: "/release/guide-first-light" },
    privacy: { aggregateOnly: true, thresholdApplied: true, minimumThreshold: 5 },
  }] : [{
    id: "propose_show_city:guide-first-light:FR:paris:28",
    type: "propose_show_city",
    title: "Consider a show in Paris",
    description: "First Light has qualified listening demand in Paris, FR.",
    reason: "28 listeners; 18 resonated, 12 saved, 0 purchased in 28 days.",
    priority: "high", confidence: 0.8,
    sourceSignal: { category: "playback", summary: "Qualified release and city demand", count: 30 },
    cta: { label: "Draft a show", href: "/shows/create?city=paris&country=FR&releaseId=guide-first-light" },
    privacy: { aggregateOnly: true, thresholdApplied: true, minimumThreshold: 5 },
  }];
  await page.route("**/analytics/artist/test-artist-id/v1?**", (route) => route.fulfill({ json: {
    summary: { artistId, days: 30, totalPlays: 75, totalPayoutUsd: 0, payoutsByAsset: [] },
    tracks: [], topTracks: [], sessions: [], sources: [], playsOverTime: [], trackPerformance: [],
    protection: { totalDecisions: 0, releasesWithDecisions: 0, marketplaceReadyReleases: 0, restrictedReleases: 0, blockedReleases: 0, routes: [] },
    actions, sceneScout: { status: "ready" }, unmetDemand: { status: "ready" }, firstListenerReception: { status: "ready" },
    meta: { source: "warehouse_export", generatedAt: timestamp, timeWindow: { from: "2026-09-03T09:00:00.000Z", to: timestamp, days: 30 }, freshness: { asOf: timestamp, lagSeconds: 0 }, isEmpty: false, cache: { hit: false, ttlSeconds: 0 } },
    export: { artistId, days: 30, totalPlays: 75, totalPayoutUsd: 0, payoutsByAsset: [], generatedAt: timestamp, source: "warehouse_export", freshness: { asOf: timestamp, lagSeconds: 0 } },
  } }));
  await page.route("**/catalog/me", (route) => route.fulfill({ json: [{
    id: "guide-first-light", artistId, title: "First Light", primaryArtist: "Test Artist",
    artist: { id: artistId, displayName: "Test Artist" }, type: "EP", status: "ready",
    genre: "Afro house", moods: [], releaseDate: timestamp, createdAt: timestamp, explicit: false, tracks: [],
  }] }));
  await page.route("**/catalog/published?**", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/metadata/stakes/analytics/**", (route) => route.fulfill({ json: {
    totalStaked: "0", totalSlashed: "0", counts: { total: 0, active: 0, slashed: 0, refunded: 0 }, stakes: [],
  } }));
  await page.route("**/analytics/product-events", (route) => route.fulfill({ status: 202, json: { recorded: true } }));
}
