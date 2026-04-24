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
    catalog.onModuleInit();

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

  it('consolidates an AI-generated release with its legacy Demucs duplicate', async () => {
    const canonicalReleaseId = `${TEST_PREFIX}ai_canonical`;
    const canonicalTrackId = `${TEST_PREFIX}ai_track`;
    const canonicalStemId = `${TEST_PREFIX}ai_master`;
    const duplicateReleaseId = `${TEST_PREFIX}ai_duplicate`;
    const duplicateTrackId = `${TEST_PREFIX}dup_track`;
    const duplicateOriginalStemId = `${TEST_PREFIX}dup_original`;
    const duplicateVocalStemId = `${TEST_PREFIX}dup_vocals`;

    await prisma.release.create({
      data: {
        id: canonicalReleaseId,
        artistId: `${TEST_PREFIX}artist`,
        title: 'Duplicate AI Single',
        status: 'published',
        type: 'ai_generated',
        primaryArtist: 'AI (Lyria)',
        tracks: {
          create: {
            id: canonicalTrackId,
            title: 'Duplicate AI Single',
            processingStatus: 'complete',
            stems: {
              create: {
                id: canonicalStemId,
                type: 'master',
                uri: 'gs://bucket/master.mp3',
                storageProvider: 'gcs',
              },
            },
          },
        },
      },
    });
    await prisma.release.create({
      data: {
        id: duplicateReleaseId,
        artistId: `${TEST_PREFIX}artist`,
        title: 'Duplicate AI Single',
        status: 'ready',
        type: 'single',
        primaryArtist: 'AI (Lyria)',
        rightsRoute: 'LIMITED_MONITORING',
        rightsSourceType: 'ai_generated',
        tracks: {
          create: {
            id: duplicateTrackId,
            title: 'Duplicate AI Single',
            processingStatus: 'complete',
            stems: {
              create: [
                {
                  id: duplicateOriginalStemId,
                  type: 'original',
                  uri: 'gs://bucket/original.mp3',
                  storageProvider: 'gcs',
                },
                {
                  id: duplicateVocalStemId,
                  type: 'vocals',
                  uri: 'gs://bucket/vocals.mp3',
                  storageProvider: 'gcs',
                },
              ],
            },
          },
        },
      },
    });

    const release = await catalog.getRelease(canonicalReleaseId, { includeRestricted: true });

    expect(release).not.toBeNull();
    expect(release!.rightsRoute).toBe('LIMITED_MONITORING');
    expect(release!.tracks[0].stems.map((stem) => stem.type).sort()).toEqual(['master', 'vocals']);
    const movedStem = await prisma.stem.findUnique({ where: { id: duplicateVocalStemId } });
    expect(movedStem?.trackId).toBe(canonicalTrackId);
    const duplicate = await prisma.release.findUnique({ where: { id: duplicateReleaseId } });
    expect(duplicate).toBeNull();
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

  it('preserves bucket-relative URIs when decrypting marketplace previews', async () => {
    const releaseId = `${TEST_PREFIX}preview_release_encrypted`;
    const trackId = `${TEST_PREFIX}preview_track_encrypted`;
    const stemId = `${TEST_PREFIX}preview_stem_encrypted`;
    const stemUri = 'resonate-stems-staging/originals/preview-encrypted.mp3';

    await prisma.release.create({
      data: {
        id: releaseId,
        artistId: `${TEST_PREFIX}artist`,
        title: 'Encrypted Preview',
        status: 'ready',
        rightsRoute: 'STANDARD_ESCROW',
        artworkData: Buffer.from('artwork'),
        artworkMimeType: 'image/png',
      },
    });
    await prisma.track.create({
      data: {
        id: trackId,
        releaseId,
        title: 'Encrypted Preview Track',
        rightsRoute: 'STANDARD_ESCROW',
      },
    });
    await prisma.stem.create({
      data: {
        id: stemId,
        trackId,
        type: 'vocals',
        uri: stemUri,
        mimeType: 'audio/mpeg',
        storageProvider: 'gcs',
        encryptionMetadata: JSON.stringify({
          iv: 'iv',
          authTag: 'tag',
          keyId: 'key',
        }),
      },
    });

    const decrypt = jest.fn().mockResolvedValue(Buffer.from('decrypted-preview'));
    const previewCatalog = new CatalogService(
      eventBus,
      { decrypt } as unknown as EncryptionService,
      { download: jest.fn(), upload: jest.fn(), delete: jest.fn() } as unknown as LocalStorageProvider,
      new UploadRightsRoutingService(),
    );

    try {
      const preview = await previewCatalog.getStemPreview(stemId);

      expect(preview.data.toString()).toBe('decrypted-preview');
      expect(decrypt).toHaveBeenCalledWith(
        stemUri,
        expect.any(String),
        [],
        expect.objectContaining({
          address: '0x0000000000000000000000000000000000000000',
        }),
      );
    } finally {
      await prisma.stem.delete({ where: { id: stemId } });
      await prisma.track.delete({ where: { id: trackId } });
      await prisma.release.delete({ where: { id: releaseId } });
    }
  });

  it('uses the storage provider for unencrypted marketplace previews before localhost fetch', async () => {
    const releaseId = `${TEST_PREFIX}preview_release_unencrypted`;
    const trackId = `${TEST_PREFIX}preview_track_unencrypted`;
    const stemId = `${TEST_PREFIX}preview_stem_unencrypted`;
    const stemUri = 'resonate-stems-staging/originals/preview-raw.mp3';
    const download = jest.fn().mockResolvedValue(Buffer.from('raw-preview'));
    const fetchSpy = jest.spyOn(global, 'fetch').mockRejectedValue(new Error('should not fetch'));

    await prisma.release.create({
      data: {
        id: releaseId,
        artistId: `${TEST_PREFIX}artist`,
        title: 'Raw Preview',
        status: 'ready',
        rightsRoute: 'STANDARD_ESCROW',
        artworkData: Buffer.from('artwork'),
        artworkMimeType: 'image/png',
      },
    });
    await prisma.track.create({
      data: {
        id: trackId,
        releaseId,
        title: 'Raw Preview Track',
        rightsRoute: 'STANDARD_ESCROW',
      },
    });
    await prisma.stem.create({
      data: {
        id: stemId,
        trackId,
        type: 'vocals',
        uri: stemUri,
        mimeType: 'audio/mpeg',
        storageProvider: 'gcs',
      },
    });

    const previewCatalog = new CatalogService(
      eventBus,
      { decrypt: jest.fn() } as unknown as EncryptionService,
      { download, upload: jest.fn(), delete: jest.fn() } as unknown as LocalStorageProvider,
      new UploadRightsRoutingService(),
    );

    try {
      const preview = await previewCatalog.getStemPreview(stemId);

      expect(preview.data.toString()).toBe('raw-preview');
      expect(download).toHaveBeenCalledWith(stemUri);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
      await prisma.stem.delete({ where: { id: stemId } });
      await prisma.track.delete({ where: { id: trackId } });
      await prisma.release.delete({ where: { id: releaseId } });
    }
  });

  it('persists processing errors on failed releases and tracks', async () => {
    const created = await catalog.createRelease({
      userId: `${TEST_PREFIX}user`,
      title: 'Failure Capture',
      tracks: [{ title: 'Broken Track', position: 1 }],
    });

    eventBus.publish({
      eventName: 'stems.failed' as any,
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      releaseId: created.id,
      artistId: `${TEST_PREFIX}artist`,
      error: 'Demucs worker exited with code 1',
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    const failedRelease = await catalog.getRelease(created.id, { includeRestricted: true });
    expect(failedRelease).not.toBeNull();
    expect(failedRelease!.status).toBe('failed');
    expect(failedRelease!.processingError).toBe('Demucs worker exited with code 1');
    expect(failedRelease!.tracks[0].processingStatus).toBe('failed');
    expect(failedRelease!.tracks[0].processingError).toBe('Demucs worker exited with code 1');
  });

  it('ignores late failed events after a release has been deleted', async () => {
    const created = await catalog.createRelease({
      userId: `${TEST_PREFIX}user`,
      title: 'Delete Race Target',
      tracks: [{ title: 'Transient Track', position: 1 }],
    });

    await catalog.deleteRelease(created.id, `${TEST_PREFIX}user`);

    eventBus.publish({
      eventName: 'stems.failed' as any,
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      releaseId: created.id,
      artistId: `${TEST_PREFIX}artist`,
      error: 'Late worker callback',
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(await prisma.release.findUnique({ where: { id: created.id } })).toBeNull();
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

  it('deletes a failed upload release that already has a fingerprint', async () => {
    const created = await catalog.createRelease({
      userId: `${TEST_PREFIX}user`,
      title: 'Failed Fingerprinted Release',
      tracks: [{ title: 'Broken Upload', position: 1 }],
    });

    await prisma.audioFingerprint.create({
      data: {
        trackId: created.tracks[0].id,
        fingerprint: '1,2,3,4',
        fingerprintHash: `${TEST_PREFIX}fingerprint-hash`,
        duration: 196.65,
      },
    });

    await prisma.release.update({
      where: { id: created.id },
      data: {
        status: 'failed',
        processingError: 'Demucs processing failed',
      },
    });

    const result = await catalog.deleteRelease(created.id, `${TEST_PREFIX}user`);

    expect(result.success).toBe(true);
    expect(await prisma.audioFingerprint.findUnique({ where: { trackId: created.tracks[0].id } })).toBeNull();
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

  it('hides restricted releases from public catalog reads and streams', async () => {
    const restrictedReleaseId = `${TEST_PREFIX}restricted_release`;
    const restrictedTrackId = `${TEST_PREFIX}restricted_track`;
    const restrictedStemId = `${TEST_PREFIX}restricted_stem`;

    await prisma.release.create({
      data: {
        id: restrictedReleaseId,
        artistId: `${TEST_PREFIX}artist`,
        title: 'Restricted Release',
        status: 'ready',
        rightsRoute: 'QUARANTINED_REVIEW',
        artworkData: Buffer.from('artwork'),
        artworkMimeType: 'image/png',
      },
    });
    await prisma.track.create({
      data: {
        id: restrictedTrackId,
        releaseId: restrictedReleaseId,
        title: 'Restricted Track',
        rightsRoute: 'QUARANTINED_REVIEW',
      },
    });
    await prisma.stem.create({
      data: {
        id: restrictedStemId,
        trackId: restrictedTrackId,
        type: 'original',
        uri: '/restricted.wav',
        data: Buffer.from('restricted-audio'),
        mimeType: 'audio/wav',
      },
    });

    expect(await catalog.getRelease(restrictedReleaseId)).toBeNull();
    expect(await catalog.getTrack(restrictedTrackId)).toBeNull();
    expect(await catalog.getReleaseArtwork(restrictedReleaseId)).toBeNull();
    expect(await catalog.getTrackStream(restrictedTrackId)).toBeNull();
    expect(await catalog.getStemBlob(restrictedStemId)).toBeNull();
    await expect(catalog.getStemPreview(restrictedStemId)).rejects.toThrow('Stem not found');
    expect(
      await catalog.getRelease(restrictedReleaseId, { includeRestricted: true }),
    ).not.toBeNull();
    expect(
      await catalog.getReleaseForUser(restrictedReleaseId, `${TEST_PREFIX}user`),
    ).not.toBeNull();
    expect(
      await catalog.getTrackStream(restrictedTrackId, { includeRestricted: true }),
    ).not.toBeNull();
    expect(
      await catalog.getStemBlob(restrictedStemId, { includeRestricted: true }),
    ).not.toBeNull();

    const publicArtistReleases = await catalog.listByArtist(`${TEST_PREFIX}artist`);
    expect(publicArtistReleases.some((release) => release.id === restrictedReleaseId)).toBe(false);

    const ownerReleases = await catalog.listByUserId(`${TEST_PREFIX}user`);
    expect(ownerReleases.some((release) => release.id === restrictedReleaseId)).toBe(true);

    const searchResults = await catalog.search('Restricted Release');
    expect(searchResults.items.some((release: any) => release.id === restrictedReleaseId)).toBe(false);

    await prisma.stem.delete({ where: { id: restrictedStemId } });
    await prisma.track.delete({ where: { id: restrictedTrackId } });
    await prisma.release.delete({ where: { id: restrictedReleaseId } });
  });
});
