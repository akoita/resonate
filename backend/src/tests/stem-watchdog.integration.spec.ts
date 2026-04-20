import { ConfigService } from '@nestjs/config';
import { prisma } from '../db/prisma';
import { CatalogService } from '../modules/catalog/catalog.service';
import { EncryptionService } from '../modules/encryption/encryption.service';
import { AesEncryptionProvider } from '../modules/encryption/providers/aes_encryption_provider';
import { StemWatchdogService } from '../modules/ingestion/stem-watchdog.service';
import { UploadRightsRoutingService } from '../modules/rights/upload-rights-routing.service';
import { EventBus } from '../modules/shared/event_bus';
import { LocalStorageProvider } from '../modules/storage/local_storage_provider';

const TEST_PREFIX = `watchdog_${Date.now()}_`;
const POLL_INTERVAL_MS = 50;
const POLL_TIMEOUT_MS = 2_000;

async function waitForReleaseAndTrack(
  releaseId: string,
  trackId: string,
  predicate: (state: {
    releaseStatus: string | null;
    releaseError: string | null;
    trackStatus: string | null;
    trackError: string | null;
  }) => boolean,
) {
  const deadline = Date.now() + POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const [release, track] = await Promise.all([
      prisma.release.findUnique({
        where: { id: releaseId },
        select: { status: true, processingError: true },
      }),
      prisma.track.findUnique({
        where: { id: trackId },
        select: { processingStatus: true, processingError: true },
      }),
    ]);

    const state = {
      releaseStatus: release?.status ?? null,
      releaseError: release?.processingError ?? null,
      trackStatus: track?.processingStatus ?? null,
      trackError: track?.processingError ?? null,
    };

    if (predicate(state)) {
      return state;
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  throw new Error(
    `Timed out waiting for release ${releaseId} / track ${trackId} state transition`,
  );
}

describe('StemWatchdogService (integration)', () => {
  let eventBus: EventBus;
  let catalog: CatalogService;
  let watchdog: StemWatchdogService;

  beforeAll(async () => {
    eventBus = new EventBus();
    const storage = new LocalStorageProvider();
    const configService = new ConfigService({
      ENCRYPTION_SECRET: process.env.ENCRYPTION_SECRET || 'test-encryption-secret-for-integration',
    });
    const aesProvider = new AesEncryptionProvider(configService);
    const encryption = new EncryptionService(aesProvider as any, configService);

    catalog = new CatalogService(
      eventBus,
      encryption as any,
      storage,
      new UploadRightsRoutingService(),
    );
    catalog.onModuleInit();
    watchdog = new StemWatchdogService(eventBus);

    await prisma.user.create({
      data: { id: `${TEST_PREFIX}user`, email: `${TEST_PREFIX}user@test.resonate` },
    });
    await prisma.artist.create({
      data: {
        id: `${TEST_PREFIX}artist`,
        userId: `${TEST_PREFIX}user`,
        displayName: 'Watchdog Artist',
        payoutAddress: '0x' + 'B'.repeat(40),
      },
    });
  });

  afterAll(async () => {
    delete process.env.STEM_WATCHDOG_TIMEOUT_MS;
    await prisma.stem.deleteMany({ where: { track: { release: { artistId: `${TEST_PREFIX}artist` } } } }).catch(() => {});
    await prisma.track.deleteMany({ where: { release: { artistId: `${TEST_PREFIX}artist` } } }).catch(() => {});
    await prisma.release.deleteMany({ where: { artistId: `${TEST_PREFIX}artist` } }).catch(() => {});
    await prisma.artist.delete({ where: { id: `${TEST_PREFIX}artist` } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } }).catch(() => {});
  });

  it('fails releases whose active tracks have gone stale', async () => {
    process.env.STEM_WATCHDOG_TIMEOUT_MS = '60000';
    const staleAt = new Date(Date.now() - 5 * 60 * 1000);
    const releaseId = `${TEST_PREFIX}stale_release`;
    const trackId = `${TEST_PREFIX}stale_track`;

    await prisma.release.create({
      data: {
        id: releaseId,
        artistId: `${TEST_PREFIX}artist`,
        title: 'Stale Release',
        status: 'processing',
      },
    });
    await prisma.track.create({
      data: {
        id: trackId,
        releaseId,
        title: 'Stale Track',
        position: 1,
        processingStatus: 'separating',
        processingStartedAt: staleAt,
        lastProgressAt: staleAt,
      },
    });

    await watchdog.runWatchdogSweep();
    const state = await waitForReleaseAndTrack(
      releaseId,
      trackId,
      ({ releaseStatus, trackStatus }) => releaseStatus === 'failed' && trackStatus === 'failed',
    );

    expect(state.releaseStatus).toBe('failed');
    expect(state.releaseError).toContain('timed out');
    expect(state.trackStatus).toBe('failed');
    expect(state.trackError).toContain('timed out');
  });

  it('does not fail releases that have recent progress heartbeats', async () => {
    process.env.STEM_WATCHDOG_TIMEOUT_MS = '60000';
    const oldStart = new Date(Date.now() - 5 * 60 * 1000);
    const recentProgress = new Date();
    const releaseId = `${TEST_PREFIX}fresh_release`;
    const trackId = `${TEST_PREFIX}fresh_track`;

    await prisma.release.create({
      data: {
        id: releaseId,
        artistId: `${TEST_PREFIX}artist`,
        title: 'Fresh Release',
        status: 'processing',
      },
    });
    await prisma.track.create({
      data: {
        id: trackId,
        releaseId,
        title: 'Fresh Track',
        position: 1,
        processingStatus: 'separating',
        processingStartedAt: oldStart,
        lastProgressAt: recentProgress,
      },
    });

    await watchdog.runWatchdogSweep();
    const state = await waitForReleaseAndTrack(
      releaseId,
      trackId,
      ({ releaseStatus, trackStatus, releaseError, trackError }) =>
        releaseStatus === 'processing' &&
        trackStatus === 'separating' &&
        releaseError === null &&
        trackError === null,
    );

    expect(state.releaseStatus).toBe('processing');
    expect(state.releaseError).toBeNull();
    expect(state.trackStatus).toBe('separating');
    expect(state.trackError).toBeNull();
  });
});
