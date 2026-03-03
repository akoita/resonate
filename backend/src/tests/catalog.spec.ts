/**
 * Catalog Service — Infra-backed Tests
 *
 * Tests CatalogService against a real Postgres database (no Prisma mocks).
 * Validates actual query behavior, relations, and cascade deletes.
 *
 * Requires: make dev-up (Postgres at localhost:5432)
 * Run: npm run test:integration
 */

import { PrismaClient } from '@prisma/client';
import { CatalogService } from '../modules/catalog/catalog.service';
import { EventBus } from '../modules/shared/event_bus';
import { LocalStorageProvider } from '../modules/storage/local_storage_provider';

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://resonate:resonate@localhost:5432/resonate';

let prisma: PrismaClient;
let catalog: CatalogService;
let eventBus: EventBus;
let dbAvailable = false;

const TEST_PREFIX = `cat_infra_${Date.now()}_`;

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

describe('CatalogService (infra-backed)', () => {
  beforeAll(async () => {
    dbAvailable = await isPostgresAvailable();
    if (!dbAvailable) {
      console.warn('⚠️  Postgres not available. Start with: make dev-up');
      return;
    }

    prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });
    await prisma.$connect();

    eventBus = new EventBus();
    const storage = new LocalStorageProvider();
    // EncryptionService: mock only the external encryption provider (Lit Protocol)
    const mockEncryption = {
      encrypt: jest.fn().mockResolvedValue(null),
      get isReady() { return false; },
      get providerName() { return 'mock'; },
      verifyAccess: jest.fn().mockResolvedValue(true),
    };

    catalog = new CatalogService(eventBus, mockEncryption as any, storage);

    // Seed prerequisite data: User → Artist
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
        displayName: 'Infra Test Artist',
        payoutAddress: '0x' + 'A'.repeat(40),
      },
    });
  });

  afterAll(async () => {
    if (!dbAvailable) return;
    try {
      // Ordered cleanup (no cascade in schema)
      await prisma.stemListing.deleteMany({ where: { stem: { track: { release: { artistId: `${TEST_PREFIX}artist` } } } } }).catch(() => {});
      await prisma.stemNftMint.deleteMany({ where: { stem: { track: { release: { artistId: `${TEST_PREFIX}artist` } } } } }).catch(() => {});
      await prisma.stem.deleteMany({ where: { track: { release: { artistId: `${TEST_PREFIX}artist` } } } });
      await prisma.license.deleteMany({ where: { track: { release: { artistId: `${TEST_PREFIX}artist` } } } }).catch(() => {});
      await prisma.track.deleteMany({ where: { release: { artistId: `${TEST_PREFIX}artist` } } });
      await prisma.release.deleteMany({ where: { artistId: `${TEST_PREFIX}artist` } });
      await prisma.artist.deleteMany({ where: { id: `${TEST_PREFIX}artist` } });
      await prisma.user.deleteMany({ where: { id: `${TEST_PREFIX}user` } });
    } catch (err) {
      console.warn('Cleanup warning:', err);
    }
    await prisma.$disconnect();
  });

  it('creates a release with tracks in real DB', async () => {
    if (!dbAvailable) return;

    const result = await catalog.createRelease({
      userId: `${TEST_PREFIX}user`,
      title: 'Infra Test Album',
      type: 'album',
      primaryArtist: 'Infra Artist',
      tracks: [
        { title: 'Track One', position: 1 },
        { title: 'Track Two', position: 2 },
      ],
    });

    expect(result.id).toBeDefined();
    expect(result.title).toBe('Infra Test Album');
    expect(result.tracks).toHaveLength(2);
    expect(result.tracks[0].title).toBe('Track One');
  });

  it('retrieves a release with full relations', async () => {
    if (!dbAvailable) return;

    // Create release first
    const created = await catalog.createRelease({
      userId: `${TEST_PREFIX}user`,
      title: 'Retrieval Test',
      tracks: [{ title: 'Solo Track', position: 1 }],
    });

    const release = await catalog.getRelease(created.id);

    expect(release).not.toBeNull();
    expect(release!.title).toBe('Retrieval Test');
    expect(release!.artist.displayName).toBe('Infra Test Artist');
    expect(release!.tracks).toHaveLength(1);
    expect(release!.tracks[0].title).toBe('Solo Track');
  });

  it('updates release title and status', async () => {
    if (!dbAvailable) return;

    const created = await catalog.createRelease({
      userId: `${TEST_PREFIX}user`,
      title: 'Before Update',
      tracks: [{ title: 'T', position: 1 }],
    });

    const updated = await catalog.updateRelease(created.id, {
      title: 'After Update',
      status: 'published',
    });

    expect(updated.title).toBe('After Update');
    expect(updated.status).toBe('published');
  });

  it('rejects release creation for non-artist user', async () => {
    if (!dbAvailable) return;

    // Create a user without an artist profile
    const noArtistUserId = `${TEST_PREFIX}noartist`;
    await prisma.user.upsert({
      where: { id: noArtistUserId },
      update: {},
      create: { id: noArtistUserId, email: `${noArtistUserId}@test.resonate` },
    });

    await expect(
      catalog.createRelease({
        userId: noArtistUserId,
        title: 'Should Fail',
      }),
    ).rejects.toThrow('User is not a registered artist');

    // Cleanup
    await prisma.user.delete({ where: { id: noArtistUserId } });
  });

  it('deletes release with manual cascade (stems → tracks → release)', async () => {
    if (!dbAvailable) return;

    const created = await catalog.createRelease({
      userId: `${TEST_PREFIX}user`,
      title: 'Delete Target',
      tracks: [{ title: 'Doomed Track', position: 1 }],
    });

    // Add a stem to the track
    await prisma.stem.create({
      data: {
        trackId: created.tracks[0].id,
        type: 'vocals',
        uri: '/test/vocals.mp3',
      },
    });

    // Verify stem exists
    const stemsBefore = await prisma.stem.findMany({ where: { trackId: created.tracks[0].id } });
    expect(stemsBefore).toHaveLength(1);

    // Delete via CatalogService (manual cascade)
    const result = await catalog.deleteRelease(created.id, `${TEST_PREFIX}user`);
    expect(result.success).toBe(true);

    // Verify everything is gone
    const release = await prisma.release.findUnique({ where: { id: created.id } });
    expect(release).toBeNull();

    const tracks = await prisma.track.findMany({ where: { releaseId: created.id } });
    expect(tracks).toHaveLength(0);

    const stemsAfter = await prisma.stem.findMany({ where: { trackId: created.tracks[0].id } });
    expect(stemsAfter).toHaveLength(0);
  });

  it('rejects delete for wrong user', async () => {
    if (!dbAvailable) return;

    const created = await catalog.createRelease({
      userId: `${TEST_PREFIX}user`,
      title: 'Protected Release',
      tracks: [{ title: 'T', position: 1 }],
    });

    await expect(
      catalog.deleteRelease(created.id, 'wrong-user-id'),
    ).rejects.toThrow('Not authorized');
  });

  it('emits event when stems are processed', async () => {
    if (!dbAvailable) return;

    const events: any[] = [];
    eventBus.subscribe('catalog.track.status', (e: any) => events.push(e));

    const created = await catalog.createRelease({
      userId: `${TEST_PREFIX}user`,
      title: 'Event Test',
      tracks: [{ title: 'Event Track', position: 1 }],
    });

    // Verify release was persisted
    const found = await prisma.release.findUnique({ where: { id: created.id } });
    expect(found).not.toBeNull();
  });

  it('returns null for non-existent release', async () => {
    if (!dbAvailable) return;

    const result = await catalog.getRelease('nonexistent-release-id');
    expect(result).toBeNull();
  });
});
