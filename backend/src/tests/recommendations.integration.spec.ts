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
import { TasteMemoryService } from '../modules/recommendations/taste_memory.service';

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
        genre: 'Hip Hop',
        moods: ['Focus', 'Late Night'],
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
    await prisma.listenerTasteSignalControl.deleteMany({ where: { userId: `${TEST_PREFIX}user` } }).catch(() => {});
    await prisma.listenerTasteMemorySettings.deleteMany({ where: { userId: `${TEST_PREFIX}user` } }).catch(() => {});
    await prisma.track.deleteMany({ where: { releaseId: `${TEST_PREFIX}release` } }).catch(() => {});
    await prisma.release.delete({ where: { id: `${TEST_PREFIX}release` } }).catch(() => {});
    await prisma.artist.delete({ where: { id: `${TEST_PREFIX}artist` } }).catch(() => {});
    await prisma.user.delete({ where: { id: `${TEST_PREFIX}user` } }).catch(() => {});
  });

  it('returns recommended tracks with preferences', async () => {
    const service = new RecommendationsService(new EventBus());
    service.setPreferences(`${TEST_PREFIX}user`, { energy: 'high', genres: ['Hip Hop'], mood: 'Focus' });

    const result = await service.getRecommendations(`${TEST_PREFIX}user`, 2);
    expect(result.items.length).toBeGreaterThanOrEqual(1);
    expect(result.preferences.energy).toBe('high');
    expect(result.items[0].genre).toBe('Hip Hop');
    expect(result.items[0].moods).toContain('Focus');
    expect(result.items[0].reasons).toContain('genre:Hip Hop');
    expect(result.items[0].reasons).toContain('mood:Focus');
  });

  it('accepts per-request vibe overrides without replacing stored preferences', async () => {
    const service = new RecommendationsService(new EventBus());
    service.setPreferences(`${TEST_PREFIX}user`, { genres: ['Jazz'] });

    const result = await service.getRecommendations(`${TEST_PREFIX}user`, 2, {
      mood: 'Late Night',
      genres: ['Hip Hop'],
    });

    expect(result.preferences.genres).toEqual(['Hip Hop']);
    expect(result.preferences.mood).toBe('Late Night');
    expect(service.getPreferences(`${TEST_PREFIX}user`).genres).toEqual(['Jazz']);
    expect(result.items[0].reasons).toEqual(expect.arrayContaining(['mood:Late Night']));
  });

  it('returns tracks from real DB when no preferences set', async () => {
    const service = new RecommendationsService(new EventBus());
    const result = await service.getRecommendations(`${TEST_PREFIX}user`, 10);
    expect(result.items.length).toBeGreaterThanOrEqual(1);
  });

  it('excludes hidden taste signals from recommendation reasons', async () => {
    const eventBus = new EventBus();
    const tasteMemory = new TasteMemoryService(eventBus);
    const service = new RecommendationsService(eventBus, tasteMemory);
    await tasteMemory.upsertSignalControl(`${TEST_PREFIX}user`, {
      signalType: 'genre',
      value: 'Hip Hop',
      action: 'hidden',
    });
    service.setPreferences(`${TEST_PREFIX}user`, { genres: ['Hip Hop'], mood: 'Focus' });

    const result = await service.getRecommendations(`${TEST_PREFIX}user`, 2);

    expect(result.preferences.genres).toEqual([]);
    expect(result.items[0].reasons).not.toContain('genre:Hip Hop');
    expect(result.items[0].reasons).toContain('mood:Focus');
  });

  it('falls back after reset instead of using older stored preferences', async () => {
    const eventBus = new EventBus();
    const tasteMemory = new TasteMemoryService(eventBus);
    const service = new RecommendationsService(eventBus, tasteMemory);
    service.setPreferences(`${TEST_PREFIX}user`, { genres: ['Hip Hop'], mood: 'Focus' });

    await tasteMemory.resetTasteMemory(`${TEST_PREFIX}user`);
    const result = await service.getRecommendations(`${TEST_PREFIX}user`, 2);

    expect(result.preferences.genres).toBeUndefined();
    expect(result.preferences.mood).toBeUndefined();
  });
});
