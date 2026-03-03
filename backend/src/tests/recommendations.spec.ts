/**
 * Recommendations Service — Infra-backed Tests (zero-mock)
 *
 * Tests RecommendationsService with real Postgres for track retrieval.
 *
 * Requires: make dev-up (Postgres at localhost:5432)
 * Run: npm test
 */

import { PrismaClient } from '@prisma/client';
import { RecommendationsService } from '../modules/recommendations/recommendations.service';
import { EventBus } from '../modules/shared/event_bus';

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://resonate:resonate@localhost:5432/resonate';

let prisma: PrismaClient;
let dbAvailable = false;

const TEST_PREFIX = `rec_${Date.now()}_`;

async function isPostgresAvailable(): Promise<boolean> {
  try {
    const p = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });
    await p.$connect();
    await p.$disconnect();
    return true;
  } catch {
    return false;
  }
}

describe('RecommendationsService (infra-backed)', () => {
  beforeAll(async () => {
    dbAvailable = await isPostgresAvailable();
    if (!dbAvailable) {
      console.warn('⚠️  Postgres not available. Start with: make dev-up');
      return;
    }
    prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });
    await prisma.$connect();

    // Seed: User → Artist → Release → Tracks
    await prisma.user.upsert({
      where: { id: `${TEST_PREFIX}user` },
      update: {},
      create: { id: `${TEST_PREFIX}user`, email: `${TEST_PREFIX}user@test.resonate` },
    });
    await prisma.artist.upsert({
      where: { userId: `${TEST_PREFIX}user` },
      update: {},
      create: {
        id: `${TEST_PREFIX}artist`,
        userId: `${TEST_PREFIX}user`,
        displayName: 'Rec Test Artist',
        payoutAddress: '0x' + 'E'.repeat(40),
      },
    });
    const release = await prisma.release.create({
      data: {
        id: `${TEST_PREFIX}release`,
        title: 'Rec Test Album',
        artistId: `${TEST_PREFIX}artist`,
        status: 'published',
      },
    });
    await prisma.track.createMany({
      data: [
        { id: `${TEST_PREFIX}track1`, title: 'Pulse', releaseId: release.id, position: 1 },
        { id: `${TEST_PREFIX}track2`, title: 'Glow', releaseId: release.id, position: 2 },
        { id: `${TEST_PREFIX}track3`, title: 'Drift', releaseId: release.id, position: 3 },
      ],
    });
  });

  afterAll(async () => {
    if (!dbAvailable) return;
    try {
      await prisma.track.deleteMany({ where: { releaseId: `${TEST_PREFIX}release` } });
      await prisma.release.delete({ where: { id: `${TEST_PREFIX}release` } });
      await prisma.artist.delete({ where: { id: `${TEST_PREFIX}artist` } });
      await prisma.user.delete({ where: { id: `${TEST_PREFIX}user` } });
    } catch (err) {
      console.warn('Cleanup warning:', err);
    }
    await prisma.$disconnect();
  });

  it('returns recommended tracks with preferences', async () => {
    if (!dbAvailable) return;

    const service = new RecommendationsService(new EventBus());
    service.setPreferences('user-1', { genres: ['electronic'], energy: 'high' });

    const result = await service.getRecommendations('user-1', 2);
    expect(result.items.length).toBeGreaterThanOrEqual(1);
    expect(result.preferences.energy).toBe('high');
  });

  it('returns tracks from real DB when no preferences set', async () => {
    if (!dbAvailable) return;

    const service = new RecommendationsService(new EventBus());
    const result = await service.getRecommendations(`${TEST_PREFIX}user`, 10);
    expect(result.items.length).toBeGreaterThanOrEqual(1);
  });
});
