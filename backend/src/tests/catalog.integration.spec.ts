/**
 * Catalog Service — Testcontainers Integration Test
 *
 * Tests CatalogService against a self-contained Postgres container.
 * The container is managed by Jest globalSetup/globalTeardown.
 *
 * Run: npm run test:integration
 */

import { prisma } from '../db/prisma';
import { CatalogService } from '../modules/catalog/catalog.service';
import { EventBus } from '../modules/shared/event_bus';
import { LocalStorageProvider } from '../modules/storage/local_storage_provider';
import { EncryptionService } from '../modules/encryption/encryption.service';
import { AesEncryptionProvider } from '../modules/encryption/providers/aes_encryption_provider';
import { ConfigService } from '@nestjs/config';
import { UploadRightsRoutingService } from '../modules/rights/upload-rights-routing.service';

const TEST_PREFIX = `cat_${Date.now()}_`;

let catalog: CatalogService;
let eventBus: EventBus;

describe('CatalogService (integration)', () => {
  beforeAll(async () => {
    eventBus = new EventBus();
    const storage = new LocalStorageProvider();

    // Real encryption: AES-256-GCM with ENCRYPTION_SECRET from env
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

    // Seed prerequisite data
    await prisma.user.create({
      data: { id: `${TEST_PREFIX}user`, email: `${TEST_PREFIX}user@test.resonate` },
    });
    await prisma.artist.create({
      data: {
        id: `${TEST_PREFIX}artist`,
        userId: `${TEST_PREFIX}user`,
        displayName: 'TC Test Artist',
        payoutAddress: '0x' + 'A'.repeat(40),
      },
    });
  });

  afterAll(async () => {
    await prisma.stem.deleteMany({ where: { track: { release: { artistId: `${TEST_PREFIX}artist` } } } });
    await prisma.track.deleteMany({ where: { release: { artistId: `${TEST_PREFIX}artist` } } });
    await prisma.release.deleteMany({ where: { artistId: `${TEST_PREFIX}artist` } });
    await prisma.artist.delete({ where: { id: `${TEST_PREFIX}artist` } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
  });

  it('creates a release with tracks', async () => {
    const result = await catalog.createRelease({
      userId: `${TEST_PREFIX}user`,
      title: 'TC Test Album',
      type: 'album',
      tracks: [
        { title: 'Track One', position: 1 },
        { title: 'Track Two', position: 2 },
      ],
    });
    expect(result.id).toBeDefined();
    expect(result.title).toBe('TC Test Album');
    expect(result.tracks).toHaveLength(2);
  });

  it('retrieves a release with full relations', async () => {
    const created = await catalog.createRelease({
      userId: `${TEST_PREFIX}user`,
      title: 'Retrieval Test',
      tracks: [{ title: 'Solo Track', position: 1 }],
    });
    const release = await catalog.getRelease(created.id);
    expect(release).not.toBeNull();
    expect(release!.artist.displayName).toBe('TC Test Artist');
    expect(release!.tracks[0].title).toBe('Solo Track');
  });

  it('updates release title and status', async () => {
    const created = await catalog.createRelease({
      userId: `${TEST_PREFIX}user`,
      title: 'Before Update',
      tracks: [{ title: 'T', position: 1 }],
    });
    const updated = await catalog.updateRelease(created.id, { title: 'After Update', status: 'published' });
    expect(updated.title).toBe('After Update');
    expect(updated.status).toBe('published');
  });

  it('rejects release creation for non-artist user', async () => {
    const noArtist = `${TEST_PREFIX}noartist`;
    await prisma.user.create({ data: { id: noArtist, email: `${noArtist}@test.resonate` } });
    await expect(
      catalog.createRelease({ userId: noArtist, title: 'Fail' }),
    ).rejects.toThrow('User is not a registered artist');
  });

  it('deletes release with manual cascade', async () => {
    const created = await catalog.createRelease({
      userId: `${TEST_PREFIX}user`,
      title: 'Delete Target',
      tracks: [{ title: 'Doomed', position: 1 }],
    });
    await prisma.stem.create({
      data: { trackId: created.tracks[0].id, type: 'vocals', uri: '/test.mp3' },
    });
    const result = await catalog.deleteRelease(created.id, `${TEST_PREFIX}user`);
    expect(result.success).toBe(true);
    expect(await prisma.release.findUnique({ where: { id: created.id } })).toBeNull();
  });

  it('rejects delete for wrong user', async () => {
    const created = await catalog.createRelease({
      userId: `${TEST_PREFIX}user`,
      title: 'Protected',
      tracks: [{ title: 'T', position: 1 }],
    });
    await expect(catalog.deleteRelease(created.id, 'wrong')).rejects.toThrow('Not authorized');
  });

  it('returns null for non-existent release', async () => {
    expect(await catalog.getRelease('nonexistent')).toBeNull();
  });
});
