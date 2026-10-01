/**
 * Taste edits — Integration Test (Testcontainers) (#1961, ADR-TE-5).
 *
 * Preview never writes; apply writes only what the listener confirmed, as
 * declared controls; boosted controls reach recommendation preference matching;
 * removing a control restores the previous behavior.
 *
 * Run: npm run test:integration
 */

import { BadRequestException } from '@nestjs/common';
import { prisma } from '../db/prisma';
import { DiscoveryRankingService } from '../modules/recommendations/discovery-ranking.service';
import { RecommendationsService } from '../modules/recommendations/recommendations.service';
import { TasteMemoryService } from '../modules/recommendations/taste_memory.service';
import { EventBus } from '../modules/shared/event_bus';

const TEST_PREFIX = `taste_edits_${Date.now()}_`;
const USER_ID = `${TEST_PREFIX}user`;
const ARTIST_NAME = `Edit Band ${Date.now()}`;

describe('Taste edits (integration)', () => {
  let eventBus: EventBus;
  let publish: jest.SpyInstance;
  let tasteMemory: TasteMemoryService;
  let recommendations: RecommendationsService;

  const controls = () =>
    prisma.listenerTasteSignalControl.findMany({ where: { userId: USER_ID }, orderBy: { value: 'asc' } });

  // Served history would hide a track the previous call returned, so each
  // recommendation call starts from a clean history.
  const recommend = async (limit: number, overrides?: Parameters<RecommendationsService['getRecommendations']>[2]) => {
    await prisma.recommendationProfile.updateMany({ where: { userId: USER_ID }, data: { servedTrackIds: [] } });
    return recommendations.getRecommendations(USER_ID, limit, overrides);
  };

  const publishedEvents = () => publish.mock.calls.map(([event]) => event as Record<string, unknown>);

  beforeAll(async () => {
    await prisma.user.create({
      data: { id: USER_ID, email: `${TEST_PREFIX}user@test.resonate` },
    });
    await prisma.artist.create({
      data: {
        id: `${TEST_PREFIX}artist`,
        userId: USER_ID,
        displayName: ARTIST_NAME,
        payoutAddress: '0x' + 'D'.repeat(40),
      },
    });
    await prisma.release.create({
      data: {
        id: `${TEST_PREFIX}jazz_release`,
        title: 'Edit Jazz Album',
        artistId: `${TEST_PREFIX}artist`,
        status: 'published',
        genre: 'Jazz',
        moods: ['Focus'],
      },
    });
    await prisma.release.create({
      data: {
        id: `${TEST_PREFIX}drill_release`,
        title: 'Edit Drill Album',
        artistId: `${TEST_PREFIX}artist`,
        status: 'published',
        genre: 'Drill',
        moods: ['Dark'],
      },
    });
    await prisma.track.createMany({
      data: [
        { id: `${TEST_PREFIX}jazz_track`, title: 'Quiet Room', releaseId: `${TEST_PREFIX}jazz_release`, position: 1 },
        { id: `${TEST_PREFIX}drill_track`, title: 'Loud Room', releaseId: `${TEST_PREFIX}drill_release`, position: 1 },
      ],
    });
  });

  beforeEach(async () => {
    await prisma.listenerTasteSignalControl.deleteMany({ where: { userId: USER_ID } });
    await prisma.recommendationProfile.deleteMany({ where: { userId: USER_ID } });
    await prisma.listenerTasteMemorySettings.updateMany({ where: { userId: USER_ID }, data: { resetAt: null } });
    eventBus = new EventBus();
    publish = jest.spyOn(eventBus, 'publish');
    tasteMemory = new TasteMemoryService(eventBus);
    recommendations = new RecommendationsService(eventBus, new DiscoveryRankingService(), tasteMemory);
  });

  afterAll(async () => {
    await prisma.listenerTasteSignalControl.deleteMany({ where: { userId: USER_ID } }).catch(() => {});
    await prisma.listenerTasteMemorySettings.deleteMany({ where: { userId: USER_ID } }).catch(() => {});
    await prisma.recommendationProfile.deleteMany({ where: { userId: USER_ID } }).catch(() => {});
    await prisma.track.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } }).catch(() => {});
    await prisma.release.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } }).catch(() => {});
    await prisma.artist.delete({ where: { id: `${TEST_PREFIX}artist` } }).catch(() => {});
    await prisma.user.delete({ where: { id: USER_ID } }).catch(() => {});
  });

  describe('preview', () => {
    it('proposes edits and writes nothing', async () => {
      const before = await controls();

      const preview = await tasteMemory.previewTasteEdits(
        `less drill, more jazz, more live instruments, hide ${ARTIST_NAME.toLowerCase()}`,
      );

      expect(preview.items.map((item) => item.kind)).toEqual([
        'downrank_genre',
        'boost_genre',
        'written_preference',
        'hide_artist',
      ]);
      // The artist comes back with the catalog's own casing.
      expect(preview.items[3].value).toBe(ARTIST_NAME);
      expect(await controls()).toEqual(before);
      expect(await prisma.listenerTasteSignalControl.count({ where: { userId: USER_ID } })).toBe(0);
      expect(publish).not.toHaveBeenCalled();
    });

    it('does not create settings or touch the user for a preview', async () => {
      await tasteMemory.previewTasteEdits('less drill');
      expect(await prisma.listenerTasteMemorySettings.count({ where: { userId: USER_ID } })).toBe(0);
    });

    it('reports an artist that is not in the catalog as unmapped', async () => {
      const preview = await tasteMemory.previewTasteEdits(`hide ${TEST_PREFIX}nobody`);
      expect(preview.items).toHaveLength(1);
      expect(preview.items[0].kind).toBe('unmapped');
    });

    it('rejects a non-string text', async () => {
      await expect(tasteMemory.previewTasteEdits(42)).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('apply', () => {
    it('writes only the confirmed items, as declared controls', async () => {
      const preview = await tasteMemory.previewTasteEdits('less drill, more jazz, more live instruments');
      const confirmed = preview.items.filter((item) => item.kind !== 'downrank_genre');

      const memory = await tasteMemory.applyTasteEdits(USER_ID, confirmed);

      const stored = await controls();
      expect(stored.map((control) => [control.signalType, control.value, control.action, control.source])).toEqual([
        ['genre', 'Jazz', 'boosted', 'declared_text_edit'],
        ['note', 'more live instruments', 'declared', 'declared_text_edit'],
      ]);
      // The unchecked "less drill" never reached the database.
      expect(stored.find((control) => control.value === 'Drill')).toBeUndefined();
      expect(memory.controls.map((control) => control.action).sort()).toEqual(['boosted', 'declared']);
      expect(memory.edits).toEqual({ appliedCount: 2, ignoredCount: 0 });
    });

    it('ignores unmapped rows instead of failing or storing them', async () => {
      const preview = await tasteMemory.previewTasteEdits('more jazz, songs about the ocean');
      expect(preview.items.map((item) => item.kind)).toEqual(['boost_genre', 'unmapped']);

      const memory = await tasteMemory.applyTasteEdits(USER_ID, preview.items);

      expect(memory.edits).toEqual({ appliedCount: 1, ignoredCount: 1 });
      expect(await controls()).toHaveLength(1);
    });

    it('applies downranked, hidden-artist and energy edits', async () => {
      await tasteMemory.applyTasteEdits(USER_ID, [
        { signalType: 'genre', value: 'Drill', action: 'downranked' },
        { signalType: 'artist', value: ARTIST_NAME, action: 'hidden' },
        { signalType: 'energy', value: 'low', action: 'boosted' },
      ]);
      const stored = await controls();
      expect(stored.map((control) => `${control.signalType}:${control.action}`).sort()).toEqual([
        'artist:hidden',
        'energy:boosted',
        'genre:downranked',
      ]);
      expect(stored.every((control) => control.source === 'declared_text_edit')).toBe(true);
    });

    it('keeps one declared energy band: the newest replaces the rest', async () => {
      await tasteMemory.applyTasteEdits(USER_ID, [{ signalType: 'energy', value: 'low', action: 'boosted' }]);
      await tasteMemory.applyTasteEdits(USER_ID, [{ signalType: 'energy', value: 'high', action: 'boosted' }]);
      const energy = (await controls()).filter((control) => control.signalType === 'energy');
      expect(energy.map((control) => control.value)).toEqual(['high']);
    });

    it('rejects invalid combinations and writes nothing, even beside a valid item', async () => {
      const valid = { signalType: 'genre', value: 'Jazz', action: 'boosted' };
      for (const invalid of [
        { signalType: 'artist', value: ARTIST_NAME, action: 'boosted' },
        { signalType: 'genre', value: 'Drill', action: 'hidden' },
        { signalType: 'note', value: 'more piano', action: 'hidden' },
        { signalType: 'scene', value: 'Berlin', action: 'boosted' },
        { signalType: 'energy', value: 'extreme', action: 'boosted' },
        { signalType: 'genre', value: 'x'.repeat(81), action: 'boosted' },
        { signalType: 'genre', value: '   ', action: 'boosted' },
      ]) {
        await expect(tasteMemory.applyTasteEdits(USER_ID, [valid, invalid])).rejects.toBeInstanceOf(
          BadRequestException,
        );
      }
      expect(await controls()).toHaveLength(0);
      expect(publish).not.toHaveBeenCalled();
    });

    it('rejects an empty or oversized items list', async () => {
      await expect(tasteMemory.applyTasteEdits(USER_ID, [])).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        tasteMemory.applyTasteEdits(
          USER_ID,
          Array.from({ length: 21 }, (_, index) => ({ signalType: 'genre', value: `Genre ${index}`, action: 'boosted' })),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(tasteMemory.applyTasteEdits(USER_ID, 'genre')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('re-declares an existing manual control instead of duplicating it', async () => {
      await tasteMemory.upsertSignalControl(USER_ID, { signalType: 'genre', value: 'Jazz', action: 'hidden' });
      await tasteMemory.applyTasteEdits(USER_ID, [{ signalType: 'genre', value: 'Jazz', action: 'boosted' }]);
      const stored = await controls();
      expect(stored).toHaveLength(1);
      expect(stored[0]).toMatchObject({ action: 'boosted', source: 'declared_text_edit' });
    });

    it('publishes counts only, never the listener\'s own words', async () => {
      const note = 'more zither solos please';
      await tasteMemory.applyTasteEdits(USER_ID, [
        { signalType: 'genre', value: 'Jazz', action: 'boosted' },
        { signalType: 'genre', value: 'Drill', action: 'downranked' },
        { signalType: 'note', value: note, action: 'declared' },
      ]);

      const events = publishedEvents();
      const applied = events.find((event) => event.eventName === 'taste_memory.edits_applied');
      expect(applied).toMatchObject({
        userId: USER_ID,
        appliedCount: 3,
        ignoredCount: 0,
        boostedCount: 1,
        downrankedCount: 1,
        hiddenCount: 0,
        declaredCount: 1,
      });
      expect(events.map((event) => event.eventName)).toEqual(
        expect.arrayContaining(['taste_memory.signal_boosted', 'taste_memory.signal_downranked']),
      );
      expect(JSON.stringify(events)).not.toContain(note);

      // Removing the note publishes the restore without its text too.
      const stored = await controls();
      const noteControl = stored.find((control) => control.signalType === 'note')!;
      publish.mockClear();
      await tasteMemory.removeSignalControl(USER_ID, noteControl.id);
      expect(JSON.stringify(publishedEvents())).not.toContain(note);
    });
  });

  describe('manual signal route stays hide/downrank only', () => {
    it.each([
      ['genre', 'boosted'],
      ['note', 'declared'],
      ['energy', 'boosted'],
      ['note', 'hidden'],
    ])('rejects %s / %s', async (signalType, action) => {
      await expect(
        tasteMemory.upsertSignalControl(USER_ID, { signalType, value: 'Jazz', action }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(await controls()).toHaveLength(0);
    });
  });

  describe('effect on recommendations', () => {
    const mine = <T extends { id: string }>(items: T[]) => items.filter((item) => item.id.startsWith(TEST_PREFIX));

    it('adds a boosted genre to preference matching and reasons', async () => {
      const before = await recommend(50);
      expect(before.preferences.genres ?? []).not.toContain('Jazz');

      await tasteMemory.applyTasteEdits(USER_ID, [{ signalType: 'genre', value: 'Jazz', action: 'boosted' }]);

      const after = await recommend(50);
      expect(after.preferences.genres).toContain('Jazz');
      const jazz = mine(after.items).find((item) => item.id === `${TEST_PREFIX}jazz_track`);
      expect(jazz?.reasons).toContain('genre:Jazz');
      // Declared taste is a real ranking input: the boosted track leads my two.
      expect(mine(after.items)[0].id).toBe(`${TEST_PREFIX}jazz_track`);
    });

    it('keeps the listener\'s own genres and adds the boosted one', async () => {
      await recommendations.setPreferences(USER_ID, { genres: ['Drill'] });
      await tasteMemory.applyTasteEdits(USER_ID, [{ signalType: 'genre', value: 'Jazz', action: 'boosted' }]);
      const result = await recommend(50);
      expect(result.preferences.genres).toEqual(expect.arrayContaining(['Drill', 'Jazz']));
    });

    it('applies a declared energy band unless the request names one', async () => {
      await tasteMemory.applyTasteEdits(USER_ID, [{ signalType: 'energy', value: 'low', action: 'boosted' }]);
      expect((await recommend(10)).preferences.energy).toBe('low');
      expect((await recommend(10, { energy: 'high' })).preferences.energy).toBe('high');
    });

    it('lets a hidden artist edit remove that artist from the page', async () => {
      await tasteMemory.applyTasteEdits(USER_ID, [{ signalType: 'artist', value: ARTIST_NAME, action: 'hidden' }]);
      const result = await recommend(50);
      expect(mine(result.items)).toHaveLength(0);
    });

    it('has no ranking effect for a written note', async () => {
      const before = mine((await recommend(50)).items).map((item) => item.id);
      await tasteMemory.applyTasteEdits(USER_ID, [
        { signalType: 'note', value: 'more live instruments', action: 'declared' },
      ]);
      const policy = await tasteMemory.getPolicy(USER_ID);
      expect(policy.hidden.size + policy.downranked.size + policy.boosted.size).toBe(0);
      const after = mine((await recommend(50)).items).map((item) => item.id);
      expect(after).toEqual(before);
    });

    it('restores the previous behavior when the control is removed', async () => {
      await tasteMemory.applyTasteEdits(USER_ID, [{ signalType: 'genre', value: 'Jazz', action: 'boosted' }]);
      const [control] = await controls();

      const removed = await tasteMemory.removeSignalControl(USER_ID, control.id);

      expect(removed.status).toBe('restored');
      expect(await controls()).toHaveLength(0);
      const policy = await tasteMemory.getPolicy(USER_ID);
      expect(policy.boosted.size).toBe(0);
      const result = await recommend(50);
      expect(result.preferences.genres ?? []).not.toContain('Jazz');
    });

    it('never decays: a declared control survives a taste-memory reset', async () => {
      await tasteMemory.applyTasteEdits(USER_ID, [{ signalType: 'genre', value: 'Jazz', action: 'boosted' }]);
      await tasteMemory.resetTasteMemory(USER_ID);
      const stored = await controls();
      expect(stored.map((control) => [control.value, control.action])).toEqual([['Jazz', 'boosted']]);
    });
  });
});
