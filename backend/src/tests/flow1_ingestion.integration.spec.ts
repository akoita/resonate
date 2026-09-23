/**
 * Choreography Flow 1 — Release Ingestion Pipeline
 *
 * Tests the event chain: stems.uploaded → CatalogService → DB → stems.processed
 * → CatalogService → DB + catalog.release_ready
 *
 * NO MOCKS. Real EventBus + real CatalogService + real Postgres.
 *
 * See: backend/CHOREOGRAPHY.md (Flow 1) for sequence diagrams.
 * Run: npm run test:integration
 */

import { prisma } from '../db/prisma';
import { EventBus } from '../modules/shared/event_bus';
import { CatalogService } from '../modules/catalog/catalog.service';
import { UploadRightsRoutingService } from '../modules/rights/upload-rights-routing.service';
import type {
  StemsUploadedEvent,
  StemsProcessedEvent,
  StemsFailedEvent,
  ResonateEvent,
} from '../events/event_types';

const P = `cf1_${Date.now()}_`;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function eventSpy(eventBus: EventBus, eventName: string): ResonateEvent[] {
  const bag: ResonateEvent[] = [];
  eventBus.subscribe(eventName as any, (e: any) => bag.push(e));
  return bag;
}

describe('Choreography Flow 1: Release Ingestion Pipeline', () => {
  let eventBus: EventBus;
  let catalogService: CatalogService;

  const releaseId = `${P}release`;
  const artistId = `${P}artist`;
  const stemId1 = `${P}stem_vocals`;
  const stemId2 = `${P}stem_drums`;

  beforeAll(async () => {
    await prisma.user.create({ data: { id: `${P}user`, email: `${P}@test.resonate` } });
    await prisma.artist.create({
      data: { id: artistId, userId: `${P}user`, displayName: 'Ingestion Artist', payoutAddress: '0x' + 'C'.repeat(40) },
    });

    // Real EventBus → real CatalogService (no mocks)
    eventBus = new EventBus();
    catalogService = new CatalogService(
      eventBus as any,
      {} as any,
      {} as any,
      new UploadRightsRoutingService(),
    );
    catalogService.onModuleInit();
  });

  afterAll(async () => {
    await prisma.stem.deleteMany({ where: { track: { releaseId } } }).catch(() => {});
    await prisma.track.deleteMany({ where: { releaseId } }).catch(() => {});
    await prisma.release.delete({ where: { id: releaseId } }).catch(() => {});
    await prisma.artist.delete({ where: { id: artistId } }).catch(() => {});
    await prisma.user.delete({ where: { id: `${P}user` } }).catch(() => {});
  });

  it('stems.uploaded → CatalogService creates Release + Tracks → stems.processed → release "ready"', async () => {
    const trackStatusEvents = eventSpy(eventBus, 'catalog.track_status');
    const releaseReadyEvents = eventSpy(eventBus, 'catalog.release_ready');

    // Step 1: Publish stems.uploaded
    const uploadEvent: StemsUploadedEvent = {
      eventName: 'stems.uploaded',
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      releaseId,
      artistId,
      checksum: 'abc123',
      metadata: {
        title: 'Ingestion Album',
        type: 'single',
        genre: 'Electronic',
        tracks: [{
          title: 'Flow Track',
          position: 1,
          aiDisclosure: {
            level: 'NONE',
            facets: [],
            source: 'artist',
          },
          stems: [{ id: stemId1, uri: '/catalog/stems/master.mp3', type: 'master' }],
        }],
      },
    };
    eventBus.publish(uploadEvent);
    await wait(1500);

    // Assert: Release created in "processing" state
    const releaseAfterUpload = await prisma.release.findUnique({ where: { id: releaseId } });
    expect(releaseAfterUpload).not.toBeNull();
    expect(releaseAfterUpload!.status).toBe('processing');
    expect(releaseAfterUpload!.title).toBe('Ingestion Album');

    // Step 2: Publish stems.processed
    const tracks = await prisma.track.findMany({ where: { releaseId } });
    const realTrackId = tracks[0].id;

    const processedEvent: StemsProcessedEvent = {
      eventName: 'stems.processed',
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      releaseId,
      artistId,
      modelVersion: 'htdemucs_6s',
      tracks: [{
        id: realTrackId,
        title: 'Flow Track',
        position: 1,
        stems: [
          {
            id: stemId1,
            uri: '/catalog/stems/vocals.mp3',
            type: 'vocals',
            mimeType: 'audio/mpeg',
            // Worker-measured features (#1184) ride stems.processed into
            // the catalog upsert.
            audioFeatures: {
              schemaVersion: 'stem-audio-features/v1',
              extractor: { name: 'librosa', version: '0.10.2' },
              tempoBpm: 120.5,
              key: { tonic: 'C', mode: 'major', confidence: 0.8 },
              energyRms: 0.12,
            },
          },
          // Old-worker payload shape: no features at all (#1184 rollout).
          { id: stemId2, uri: '/catalog/stems/drums.mp3', type: 'drums', mimeType: 'audio/mpeg' },
        ],
      }],
    };
    eventBus.publish(processedEvent);
    await wait(2000);

    // Assert: Track processing complete
    const trackAfterProcessed = await prisma.track.findUnique({ where: { id: realTrackId } });
    expect(trackAfterProcessed!.processingStatus).toBe('complete');

    // Assert: Stems persisted
    const stems = await prisma.stem.findMany({ where: { trackId: realTrackId } });
    expect(stems.length).toBeGreaterThanOrEqual(2);
    expect(stems.map(s => s.type)).toEqual(expect.arrayContaining(['vocals', 'drums']));

    // Assert: audio features persisted where provided, null where absent (#1184)
    const vocalsStem = stems.find(s => s.id === stemId1);
    expect(vocalsStem?.audioFeatures).toEqual(
      expect.objectContaining({
        schemaVersion: 'stem-audio-features/v1',
        tempoBpm: 120.5,
        key: expect.objectContaining({ tonic: 'C', mode: 'major' }),
      }),
    );
    const drumsStem = stems.find(s => s.id === stemId2);
    expect(drumsStem?.audioFeatures ?? null).toBeNull();

    // Assert: Release marked "ready"
    const releaseAfterProcessed = await prisma.release.findUnique({ where: { id: releaseId } });
    expect(releaseAfterProcessed!.status).toBe('ready');

    // Assert: Follow-on events emitted
    expect(trackStatusEvents.length).toBeGreaterThanOrEqual(1);
    expect(releaseReadyEvents.length).toBeGreaterThanOrEqual(1);
  }, 15000);

  it('stems.failed → release marked "failed"', async () => {
    const failReleaseId = `${P}fail_release`;
    await prisma.release.create({
      data: { id: failReleaseId, artistId, title: 'Will Fail', status: 'processing' },
    });

    const failEvent: StemsFailedEvent = {
      eventName: 'stems.failed',
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      releaseId: failReleaseId,
      artistId,
      error: 'Demucs OOM',
    };
    eventBus.publish(failEvent);
    await wait(1000);

    const failedRelease = await prisma.release.findUnique({ where: { id: failReleaseId } });
    expect(failedRelease!.status).toBe('failed');

    await prisma.release.delete({ where: { id: failReleaseId } }).catch(() => {});
  }, 10000);

  it('does not resurrect a failed release when late stems.processed arrives', async () => {
    const lateReleaseId = `${P}late_release`;
    const lateTrackId = `${P}late_track`;
    const existingStemId = `${P}late_existing_stem`;
    const lateStemId = `${P}late_stem`;
    const trackStatusEvents = eventSpy(eventBus, 'catalog.track_status');
    const releaseReadyEvents = eventSpy(eventBus, 'catalog.release_ready');

    await prisma.release.create({
      data: { id: lateReleaseId, artistId, title: 'Late Result Release', status: 'processing' },
    });
    await prisma.track.create({
      data: { id: lateTrackId, releaseId: lateReleaseId, title: 'Late Result Track', position: 1, processingStatus: 'separating' },
    });
    await prisma.stem.create({
      data: {
        id: existingStemId,
        trackId: lateTrackId,
        type: 'vocals',
        uri: '/catalog/stems/before-failure-vocals.mp3',
      },
    });

    eventBus.publish({
      eventName: 'stems.failed',
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      releaseId: lateReleaseId,
      artistId,
      error: 'Pub/Sub handoff failed after partial publish',
    } as StemsFailedEvent);
    await wait(1000);

    const trackAfterFailure = await prisma.track.findUnique({ where: { id: lateTrackId } });
    expect(trackAfterFailure!.processingStatus).toBe('failed');
    expect(trackAfterFailure!.processingError).toBe('Pub/Sub handoff failed after partial publish');

    eventBus.publish({
      eventName: 'stems.processed',
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      releaseId: lateReleaseId,
      artistId,
      modelVersion: 'htdemucs_6s',
      tracks: [{
        id: lateTrackId,
        title: 'Late Result Track',
        artist: 'Late Result Artist',
        position: 2,
        stems: [
          { id: existingStemId, uri: '/catalog/stems/late-vocals.mp3', type: 'vocals', mimeType: 'audio/mpeg' },
          { id: lateStemId, uri: '/catalog/stems/new-late-drums.mp3', type: 'drums', mimeType: 'audio/mpeg' },
        ],
      }],
    } as StemsProcessedEvent);
    await wait(2000);

    const releaseAfterLateProcessed = await prisma.release.findUnique({ where: { id: lateReleaseId } });
    expect(releaseAfterLateProcessed!.status).toBe('failed');
    expect(releaseAfterLateProcessed!.processingError).toBe('Pub/Sub handoff failed after partial publish');
    const trackAfterLateProcessed = await prisma.track.findUnique({ where: { id: lateTrackId } });
    expect(trackAfterLateProcessed!.processingStatus).toBe(trackAfterFailure!.processingStatus);
    expect(trackAfterLateProcessed!.processingError).toBe(trackAfterFailure!.processingError);
    expect(trackAfterLateProcessed!.artist).toBe(trackAfterFailure!.artist);
    expect(trackAfterLateProcessed!.position).toBe(trackAfterFailure!.position);
    const stemsAfterLateProcessed = await prisma.stem.findMany({ where: { trackId: lateTrackId } });
    expect(stemsAfterLateProcessed).toHaveLength(1);
    expect(stemsAfterLateProcessed[0]).toEqual(expect.objectContaining({
      id: existingStemId,
      type: 'vocals',
      uri: '/catalog/stems/before-failure-vocals.mp3',
    }));
    expect(trackStatusEvents.filter(
      (event) => event.eventName === 'catalog.track_status' && event.status === 'complete',
    )).toHaveLength(0);
    expect(releaseReadyEvents).toHaveLength(0);

    await prisma.stem.deleteMany({ where: { trackId: lateTrackId } }).catch(() => {});
    await prisma.track.deleteMany({ where: { id: lateTrackId } }).catch(() => {});
    await prisma.release.delete({ where: { id: lateReleaseId } }).catch(() => {});
  }, 15000);

  it('rejects malformed processed results before they mutate tracks or stems', async () => {
    const senderReleaseId = `${P}ownership_sender_release`;
    const otherReleaseId = `${P}ownership_other_release`;
    const senderTrackId = `${P}ownership_sender_track`;
    const secondSenderTrackId = `${P}ownership_second_sender_track`;
    const otherTrackId = `${P}ownership_other_track`;
    const senderStemId = `${P}ownership_sender_stem`;
    const secondSenderStemId = `${P}ownership_second_sender_stem`;
    const otherStemId = `${P}ownership_other_stem`;
    const newStemForForeignTrackId = `${P}ownership_new_foreign_track_stem`;
    const duplicateTrackStemId1 = `${P}ownership_duplicate_track_stem_1`;
    const duplicateTrackStemId2 = `${P}ownership_duplicate_track_stem_2`;
    const sharedStemId = `${P}ownership_shared_stem`;
    const trackStatusEvents = eventSpy(eventBus, 'catalog.track_status');
    const releaseReadyEvents = eventSpy(eventBus, 'catalog.release_ready');

    await prisma.release.createMany({
      data: [
        { id: senderReleaseId, artistId, title: 'Ownership Sender', status: 'processing' },
        { id: otherReleaseId, artistId, title: 'Ownership Other', status: 'processing' },
      ],
    });
    await prisma.track.createMany({
      data: [
        {
          id: senderTrackId,
          releaseId: senderReleaseId,
          title: 'Sender Track',
          position: 1,
          processingStatus: 'separating',
          artist: 'Sender Artist',
        },
        {
          id: secondSenderTrackId,
          releaseId: senderReleaseId,
          title: 'Second Sender Track',
          position: 2,
          processingStatus: 'separating',
          artist: 'Second Sender Artist',
        },
        {
          id: otherTrackId,
          releaseId: otherReleaseId,
          title: 'Other Track',
          position: 7,
          processingStatus: 'separating',
          artist: 'Other Artist',
        },
      ],
    });
    await prisma.stem.createMany({
      data: [
        { id: senderStemId, trackId: senderTrackId, type: 'vocals', uri: '/catalog/stems/sender-original.mp3' },
        { id: secondSenderStemId, trackId: secondSenderTrackId, type: 'drums', uri: '/catalog/stems/second-sender-original.mp3' },
        { id: otherStemId, trackId: otherTrackId, type: 'drums', uri: '/catalog/stems/other-original.mp3' },
      ],
    });

    // A foreign track ID must be rejected even when its stem IDs are new.
    eventBus.publish({
      eventName: 'stems.processed',
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      releaseId: senderReleaseId,
      artistId,
      modelVersion: 'htdemucs_6s',
      tracks: [{
        id: otherTrackId,
        title: 'Mutated Other Track',
        artist: 'Mutated Artist',
        position: 99,
        stems: [{
          id: newStemForForeignTrackId,
          uri: '/catalog/stems/should-not-exist.mp3',
          type: 'vocals',
        }],
      }],
    } as StemsProcessedEvent);
    await wait(1000);

    // A sender-owned track still cannot claim a stem owned by the other release.
    eventBus.publish({
      eventName: 'stems.processed',
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      releaseId: senderReleaseId,
      artistId,
      modelVersion: 'htdemucs_6s',
      tracks: [{
        id: senderTrackId,
        title: 'Mutated Sender Track',
        artist: 'Mutated Artist',
        position: 99,
        stems: [{
          id: otherStemId,
          uri: '/catalog/stems/should-not-overwrite.mp3',
          type: 'vocals',
        }],
      }],
    } as StemsProcessedEvent);
    await wait(1000);

    // Duplicate track IDs must be rejected before an upsert can complete a track.
    eventBus.publish({
      eventName: 'stems.processed',
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      releaseId: senderReleaseId,
      artistId,
      modelVersion: 'htdemucs_6s',
      tracks: [
        {
          id: senderTrackId,
          title: 'Duplicate Sender Track',
          artist: 'Mutated Artist',
          position: 99,
          stems: [{ id: duplicateTrackStemId1, uri: '/catalog/stems/should-not-exist-1.mp3', type: 'vocals' }],
        },
        {
          id: senderTrackId,
          title: 'Duplicate Sender Track',
          artist: 'Mutated Artist',
          position: 100,
          stems: [{ id: duplicateTrackStemId2, uri: '/catalog/stems/should-not-exist-2.mp3', type: 'drums' }],
        },
      ],
    } as StemsProcessedEvent);
    await wait(1000);

    // A new stem ID cannot be assigned to two tracks in the same event.
    eventBus.publish({
      eventName: 'stems.processed',
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      releaseId: senderReleaseId,
      artistId,
      modelVersion: 'htdemucs_6s',
      tracks: [
        {
          id: senderTrackId,
          title: 'Sender Track',
          artist: 'Mutated Artist',
          position: 99,
          stems: [{ id: sharedStemId, uri: '/catalog/stems/should-not-exist-shared.mp3', type: 'vocals' }],
        },
        {
          id: secondSenderTrackId,
          title: 'Second Sender Track',
          artist: 'Mutated Artist',
          position: 100,
          stems: [{ id: sharedStemId, uri: '/catalog/stems/should-not-exist-shared.mp3', type: 'vocals' }],
        },
      ],
    } as StemsProcessedEvent);
    await wait(1000);

    const [senderRelease, otherRelease] = await Promise.all([
      prisma.release.findUnique({ where: { id: senderReleaseId } }),
      prisma.release.findUnique({ where: { id: otherReleaseId } }),
    ]);
    expect(senderRelease!.status).toBe('processing');
    expect(otherRelease!.status).toBe('processing');

    const [senderTrack, secondSenderTrack, otherTrack] = await Promise.all([
      prisma.track.findUnique({ where: { id: senderTrackId } }),
      prisma.track.findUnique({ where: { id: secondSenderTrackId } }),
      prisma.track.findUnique({ where: { id: otherTrackId } }),
    ]);
    expect(senderTrack).toEqual(expect.objectContaining({
      processingStatus: 'separating',
      artist: 'Sender Artist',
      position: 1,
    }));
    expect(secondSenderTrack).toEqual(expect.objectContaining({
      processingStatus: 'separating',
      artist: 'Second Sender Artist',
      position: 2,
    }));
    expect(otherTrack).toEqual(expect.objectContaining({
      releaseId: otherReleaseId,
      processingStatus: 'separating',
      artist: 'Other Artist',
      position: 7,
    }));

    const stems = await prisma.stem.findMany({
      where: { trackId: { in: [senderTrackId, secondSenderTrackId, otherTrackId] } },
      orderBy: { id: 'asc' },
    });
    expect(stems).toHaveLength(3);
    expect(stems).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: senderStemId, trackId: senderTrackId, uri: '/catalog/stems/sender-original.mp3' }),
      expect.objectContaining({ id: secondSenderStemId, trackId: secondSenderTrackId, uri: '/catalog/stems/second-sender-original.mp3' }),
      expect.objectContaining({ id: otherStemId, trackId: otherTrackId, uri: '/catalog/stems/other-original.mp3' }),
    ]));
    expect(trackStatusEvents.filter(
      (event) => event.eventName === 'catalog.track_status' && event.status === 'complete',
    )).toHaveLength(0);
    expect(releaseReadyEvents).toHaveLength(0);

    await prisma.stem.deleteMany({ where: { trackId: { in: [senderTrackId, secondSenderTrackId, otherTrackId] } } }).catch(() => {});
    await prisma.track.deleteMany({ where: { id: { in: [senderTrackId, secondSenderTrackId, otherTrackId] } } }).catch(() => {});
    await prisma.release.deleteMany({ where: { id: { in: [senderReleaseId, otherReleaseId] } } }).catch(() => {});
  }, 15000);

  it('ignores tokenless results while a replacement is pending or active', async () => {
    const guardedReleaseId = `${P}tokenless_guard_release`;
    const guardedTrackId = `${P}tokenless_guard_track`;
    const guardedStemId = `${P}tokenless_guard_stem`;
    const unexpectedStemId = `${P}tokenless_guard_unexpected_stem`;
    const pendingRevision = `${P}pending_revision`;
    const activeRevision = `${P}active_revision`;
    const trackStatusEvents = eventSpy(eventBus, 'catalog.track_status');
    const releaseReadyEvents = eventSpy(eventBus, 'catalog.release_ready');

    await prisma.release.create({
      data: { id: guardedReleaseId, artistId, title: 'Tokenless Guard', status: 'ready' },
    });
    await prisma.track.create({
      data: {
        id: guardedTrackId,
        releaseId: guardedReleaseId,
        title: 'Tokenless Guard Track',
        artist: 'Current Artist',
        position: 1,
        processingStatus: 'complete',
        pendingAudioRevision: pendingRevision,
        audioReplacementStatus: 'processing',
      },
    });
    await prisma.stem.create({
      data: {
        id: guardedStemId,
        trackId: guardedTrackId,
        type: 'original',
        uri: '/catalog/stems/tokenless-original.mp3',
        data: Buffer.from('current-audio'),
      },
    });

    const tokenlessResult: StemsProcessedEvent = {
      eventName: 'stems.processed',
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      releaseId: guardedReleaseId,
      artistId,
      modelVersion: 'legacy-worker',
      tracks: [{
        id: guardedTrackId,
        title: 'Stale Track Title',
        artist: 'Stale Artist',
        position: 99,
        stems: [
          { id: guardedStemId, uri: '/catalog/stems/stale-original.mp3', type: 'original' },
          { id: unexpectedStemId, uri: '/catalog/stems/stale-vocals.mp3', type: 'vocals' },
        ],
      }],
    };

    try {
      // A late track-scoped failure without a revision must not fail a ready release.
      eventBus.publish({
        eventName: 'stems.failed',
        eventVersion: 1,
        occurredAt: new Date().toISOString(),
        releaseId: guardedReleaseId,
        artistId,
        trackId: guardedTrackId,
        error: 'Stale initial processing failure',
      } as StemsFailedEvent);
      eventBus.publish({
        eventName: 'stems.failed',
        eventVersion: 1,
        occurredAt: new Date().toISOString(),
        releaseId: guardedReleaseId,
        artistId,
        error: 'Stale release-level failure',
      } as StemsFailedEvent);
      await wait(500);

      eventBus.publish(tokenlessResult);
      await wait(750);

      let [releaseAfterPending, trackAfterPending, stemsAfterPending] = await Promise.all([
        prisma.release.findUnique({ where: { id: guardedReleaseId } }),
        prisma.track.findUnique({ where: { id: guardedTrackId } }),
        prisma.stem.findMany({ where: { trackId: guardedTrackId } }),
      ]);
      expect(releaseAfterPending!.status).toBe('ready');
      expect(trackAfterPending).toEqual(expect.objectContaining({
        pendingAudioRevision: pendingRevision,
        artist: 'Current Artist',
        position: 1,
      }));
      expect(stemsAfterPending).toHaveLength(1);
      expect(stemsAfterPending[0].uri).toBe('/catalog/stems/tokenless-original.mp3');

      await prisma.track.update({
        where: { id: guardedTrackId },
        data: { pendingAudioRevision: null, activeAudioRevision: activeRevision },
      });
      eventBus.publish(tokenlessResult);
      await wait(750);

      const [releaseAfterActive, trackAfterActive, stemsAfterActive] = await Promise.all([
        prisma.release.findUnique({ where: { id: guardedReleaseId } }),
        prisma.track.findUnique({ where: { id: guardedTrackId } }),
        prisma.stem.findMany({ where: { trackId: guardedTrackId } }),
      ]);
      expect(releaseAfterActive!.status).toBe('ready');
      expect(trackAfterActive).toEqual(expect.objectContaining({
        activeAudioRevision: activeRevision,
        pendingAudioRevision: null,
        artist: 'Current Artist',
        position: 1,
      }));
      expect(stemsAfterActive).toHaveLength(1);
      expect(stemsAfterActive[0].uri).toBe('/catalog/stems/tokenless-original.mp3');
      expect(trackStatusEvents.filter(
        (event) => event.eventName === 'catalog.track_status' && event.status === 'complete',
      )).toHaveLength(0);
      expect(releaseReadyEvents).toHaveLength(0);
    } finally {
      await prisma.stem.deleteMany({ where: { trackId: guardedTrackId } }).catch(() => {});
      await prisma.track.deleteMany({ where: { id: guardedTrackId } }).catch(() => {});
      await prisma.release.delete({ where: { id: guardedReleaseId } }).catch(() => {});
    }
  }, 10000);
});
