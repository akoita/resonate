/**
 * Recommendations Service — Integration Test (Testcontainers)
 *
 * Tests RecommendationsService against real Postgres for track retrieval.
 *
 * Run: npm run test:integration
 */

import { prisma } from '../db/prisma';
import { RecommendationsService } from '../modules/recommendations/recommendations.service';
import { EventBus } from '../modules/shared/event_bus';

const TEST_PREFIX = `rec_${Date.now()}_`;

describe('RecommendationsService (integration)', () => {
  beforeAll(async () => {
    await prisma.user.create({
      data: { id: `${TEST_PREFIX}user`, email: `${TEST_PREFIX}user@test.resonate` },
    });
    await prisma.artist.create({
      data: {
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
    await prisma.track.deleteMany({ where: { releaseId: `${TEST_PREFIX}release` } }).catch(() => {});
    await prisma.release.delete({ where: { id: `${TEST_PREFIX}release` } }).catch(() => {});
    await prisma.artist.delete({ where: { id: `${TEST_PREFIX}artist` } }).catch(() => {});
    await prisma.user.delete({ where: { id: `${TEST_PREFIX}user` } }).catch(() => {});
  });

  it('returns recommended tracks with preferences', async () => {
    const service = new RecommendationsService(new EventBus());
    service.setPreferences(`${TEST_PREFIX}user`, { energy: 'high' });

    const result = await service.getRecommendations(`${TEST_PREFIX}user`, 2);
    expect(result.items.length).toBeGreaterThanOrEqual(1);
    expect(result.preferences.energy).toBe('high');
  });

  it('returns tracks from real DB when no preferences set', async () => {
    const service = new RecommendationsService(new EventBus());
    const result = await service.getRecommendations(`${TEST_PREFIX}user`, 10);
    expect(result.items.length).toBeGreaterThanOrEqual(1);
  });
});
