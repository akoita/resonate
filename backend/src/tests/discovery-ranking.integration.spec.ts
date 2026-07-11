/**
 * Discovery ranking core + durable discovery state — Integration (#1448 WS-1)
 *
 * Real Prisma. Covers the WS-1 acceptance criteria:
 *   (a) preferences + served-history SURVIVE across service instances
 *       (simulates two Cloud Run instances / a restart — no in-memory Maps)
 *   (b) the candidate pool is wider than "50 newest": an old track outside the
 *       fresh window is recommended through the preference-catalog source
 *   (c) deterministic fallback: with NO Redis cache, NO warehouse signals, and
 *       NO cohort/taste services wired, the endpoint still returns a correct
 *       ranked result
 *   (d) served-history influences the next request across instances
 *
 * Run: npx jest --runInBand --forceExit --config jest.integration.config.js \
 *        --testPathPattern='discovery-ranking'
 */

import { prisma } from "../db/prisma";
import { EventBus } from "../modules/shared/event_bus";
import { DiscoveryRankingService } from "../modules/recommendations/discovery-ranking.service";
import { RecommendationsService } from "../modules/recommendations/recommendations.service";

const TEST_PREFIX = `discovery_${Date.now()}_`;
const USER_ID = `${TEST_PREFIX}user`;
const ARTIST_ID = `${TEST_PREFIX}artist`;
const OLD_RELEASE = `${TEST_PREFIX}old_release`;
const FRESH_RELEASE = `${TEST_PREFIX}fresh_release`;
const OLD_TRACK = `${TEST_PREFIX}old_track`;

function newService() {
  // Each construction simulates a separate backend instance: no shared
  // process memory, no Redis cache (fallback path), no optional signals.
  return new RecommendationsService(
    new EventBus(),
    new DiscoveryRankingService(),
  );
}

describe("Discovery ranking + durable state (#1448 WS-1)", () => {
  beforeAll(async () => {
    await prisma.user.create({
      data: { id: USER_ID, email: `${USER_ID}@test.resonate` },
    });
    await prisma.artist.create({
      data: { id: ARTIST_ID, userId: USER_ID, displayName: "Discovery Artist" },
    });

    // One OLD release with the target genre, created two years ago…
    await prisma.release.create({
      data: {
        id: OLD_RELEASE,
        artistId: ARTIST_ID,
        title: "Vintage Zouk Classics",
        status: "ready",
        genre: "Zouk Retro",
        createdAt: new Date("2024-01-01T00:00:00Z"),
      },
    });
    await prisma.track.create({
      data: {
        id: OLD_TRACK,
        releaseId: OLD_RELEASE,
        title: "Vintage Groove",
        position: 1,
        explicit: false,
        createdAt: new Date("2024-01-01T00:00:00Z"),
      },
    });

    // …buried behind 55 fresh tracks in a different genre, so the old track
    // can NEVER appear through the 50-newest source alone.
    await prisma.release.create({
      data: {
        id: FRESH_RELEASE,
        artistId: ARTIST_ID,
        title: "Fresh Filler",
        status: "ready",
        genre: "Filler Electronica",
      },
    });
    await prisma.track.createMany({
      data: Array.from({ length: 55 }, (_, i) => ({
        id: `${TEST_PREFIX}fresh_${i}`,
        releaseId: FRESH_RELEASE,
        title: `Filler ${i}`,
        position: i + 1,
        explicit: false,
      })),
    });
  });

  afterAll(async () => {
    await prisma.recommendationProfile.deleteMany({ where: { userId: USER_ID } });
    await prisma.track.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.release.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.artist.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.user.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
  });

  it("(a) preferences survive across service instances (durable, no Maps)", async () => {
    const instanceA = newService();
    await instanceA.setPreferences(USER_ID, {
      genres: ["Zouk Retro"],
      energy: "low",
    });

    const instanceB = newService();
    const prefs = await instanceB.getPreferences(USER_ID);
    expect(prefs.genres).toEqual(["Zouk Retro"]);
    expect(prefs.energy).toBe("low");
  });

  it("(b)+(c) an old track outside the fresh window is recommended via the preference source, with zero optional services (deterministic fallback)", async () => {
    const service = newService();
    const result = await service.getRecommendations(USER_ID, 5);

    const ids = result.items.map((item) => item.id);
    expect(ids).toContain(OLD_TRACK);
    const oldItem = result.items.find((item) => item.id === OLD_TRACK)!;
    expect(oldItem.reasons).toContain("genre:Zouk Retro");
    expect(oldItem.score).toBeGreaterThan(0);
  });

  it("(d) served-history persists across instances and excludes re-serves", async () => {
    // The previous test served OLD_TRACK from a different service instance.
    const profile = await prisma.recommendationProfile.findUnique({
      where: { userId: USER_ID },
    });
    expect(profile?.servedTrackIds).toContain(OLD_TRACK);

    const freshInstance = newService();
    const next = await freshInstance.getRecommendations(USER_ID, 5);
    expect(next.items.map((item) => item.id)).not.toContain(OLD_TRACK);
  });
});
