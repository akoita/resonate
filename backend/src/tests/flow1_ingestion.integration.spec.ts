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
          { id: stemId1, uri: '/catalog/stems/vocals.mp3', type: 'vocals', mimeType: 'audio/mpeg' },
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
});
