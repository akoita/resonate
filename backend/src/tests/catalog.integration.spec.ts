/**
 * Catalog Service — Testcontainers Integration Test
 *
 * Tests CatalogService against a self-contained Postgres container.
 * The container is managed by Jest globalSetup/globalTeardown.
 *
 * Run: npm run test:integration
 */

import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ManagementGrantStatus, ManagementScope } from '@prisma/client';
import { prisma } from '../db/prisma';
import { CatalogService } from '../modules/catalog/catalog.service';
import { ManagementService } from '../modules/management/management.service';
import { EventBus } from '../modules/shared/event_bus';
import { LocalStorageProvider } from '../modules/storage/local_storage_provider';
import { EncryptionService } from '../modules/encryption/encryption.service';
import { AesEncryptionProvider } from '../modules/encryption/providers/aes_encryption_provider';
import { ConfigService } from '@nestjs/config';
import { UploadRightsRoutingService } from '../modules/rights/upload-rights-routing.service';
import type { StemsProcessedEvent } from '../events/event_types';

const TEST_PREFIX = `cat_${Date.now()}_`;
const NO_AI_DISCLOSURE = { level: 'none' as const, facets: [] as string[] };

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
    await prisma.managementTransfer.deleteMany({
      where: {
        OR: [
          { proposerUserId: { startsWith: TEST_PREFIX } },
          { recipientUserId: { startsWith: TEST_PREFIX } },
        ],
      },
    });
    await prisma.stemPurchase.deleteMany({
      where: { listing: { stem: { is: { track: { release: { artistId: `${TEST_PREFIX}artist` } } } } } },
    });
    await prisma.stemListing.deleteMany({
      where: { stem: { is: { track: { release: { artistId: `${TEST_PREFIX}artist` } } } } },
    });
    await prisma.stemPricing.deleteMany({ where: { stem: { track: { release: { artistId: `${TEST_PREFIX}artist` } } } } });
    await prisma.stemNftMint.deleteMany({ where: { stem: { track: { release: { artistId: `${TEST_PREFIX}artist` } } } } });
    await prisma.stem.deleteMany({ where: { track: { release: { artistId: `${TEST_PREFIX}artist` } } } });
    await prisma.track.deleteMany({ where: { release: { artistId: { startsWith: TEST_PREFIX } } } });
    await prisma.release.deleteMany({ where: { artistId: { startsWith: TEST_PREFIX } } });
    await prisma.showCampaign.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.artist.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.artist.deleteMany({
      where: { displayName: { contains: TEST_PREFIX, mode: 'insensitive' } },
    });
    await prisma.user.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
  });

  it('creates a release with tracks', async () => {
    const result = await catalog.createRelease({
      userId: `${TEST_PREFIX}user`,
      title: 'TC Test Album',
      type: 'album',
      tracks: [
        { title: 'Track One', position: 1, aiDisclosure: NO_AI_DISCLOSURE },
        { title: 'Track Two', position: 2, aiDisclosure: NO_AI_DISCLOSURE },
      ],
    });
    expect(result.id).toBeDefined();
    expect(result.title).toBe('TC Test Album');
    expect(result.tracks).toHaveLength(2);
    expect(result.aiDisclosure).toMatchObject({
      level: 'none',
      containsAI: 'None',
      facets: [],
    });
    expect(result.tracks[0].aiDisclosure).toMatchObject({
      level: 'none',
      source: 'artist',
    });
    expect(result.artworkRevision).toBe(1);
  });

  it('preserves an edited track title when stems processing completes', async () => {
    const sourceTitle = 'Original Track Title';
    const editedTitle = 'Artist Edited Track Title';
    const release = await catalog.createRelease({
      userId: `${TEST_PREFIX}user`,
      title: 'Track Title Race',
      tracks: [{ title: sourceTitle, position: 1, aiDisclosure: NO_AI_DISCLOSURE }],
    });
    const track = release.tracks[0];

    await catalog.updateTrackMetadata(release.id, track.id, `${TEST_PREFIX}user`, {
      title: editedTitle,
    });

    const processedEvent: StemsProcessedEvent = {
      eventName: 'stems.processed',
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      releaseId: release.id,
      artistId: `${TEST_PREFIX}artist`,
      modelVersion: 'integration-test',
      tracks: [{
        id: track.id,
        title: sourceTitle,
        position: track.position,
        stems: [],
      }],
    };
    eventBus.publish(processedEvent);

    let processedTrack: { title: string; processingStatus: string } | null = null;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      processedTrack = await prisma.track.findUnique({
        where: { id: track.id },
        select: { title: true, processingStatus: true },
      });
      if (processedTrack?.processingStatus === 'complete') break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    expect(processedTrack).toEqual({ title: editedTitle, processingStatus: 'complete' });
  });

  it('activates a replacement without changing playback until commit and keeps historical stems addressable', async () => {
    const releaseId = `${TEST_PREFIX}replacement_lifecycle_release`;
    const trackId = `${TEST_PREFIX}replacement_lifecycle_track`;
    const oldRevision = `${TEST_PREFIX}audio_old`;
    const failedRevision = `${TEST_PREFIX}audio_failed`;
    const activeRevision = `${TEST_PREFIX}audio_active`;
    const oldOriginalId = `${TEST_PREFIX}replacement_old_original`;
    const oldVocalId = `${TEST_PREFIX}replacement_old_vocals`;
    const failedOriginalId = `${TEST_PREFIX}replacement_failed_original`;
    const activeOriginalId = `${TEST_PREFIX}replacement_active_original`;
    const activeVocalId = `${TEST_PREFIX}replacement_active_vocals`;
    const oldAudio = Buffer.from('old-current-audio');
    const oldVocalAudio = Buffer.from('old-current-vocals');
    const activeAudio = Buffer.from('new-current-audio');
    const activeVocalAudio = Buffer.from('new-current-vocals');
    const trackStatusEvents: any[] = [];
    const releaseReadyEvents: any[] = [];
    eventBus.subscribe('catalog.track_status', (event: any) => trackStatusEvents.push(event));
    eventBus.subscribe('catalog.release_ready', (event: any) => releaseReadyEvents.push(event));

    await prisma.release.create({
      data: {
        id: releaseId,
        artistId: `${TEST_PREFIX}artist`,
        title: 'Replacement Revision Lifecycle',
        status: 'ready',
      },
    });
    await prisma.track.create({
      data: {
        id: trackId,
        releaseId,
        title: 'Replacement Track',
        artist: 'Current Artist',
        position: 1,
        processingStatus: 'complete',
        activeAudioRevision: oldRevision,
        pendingAudioRevision: failedRevision,
        audioReplacementStatus: 'processing',
        pendingAudioFingerprint: 'failed-pending-fingerprint',
        pendingAudioFingerprintHash: `${TEST_PREFIX}failed-hash`,
        pendingAudioFingerprintDuration: 125,
      },
    });
    await prisma.stem.createMany({
      data: [
        {
          id: oldOriginalId,
          trackId,
          type: 'original',
          uri: '/catalog/stems/old-original.mp3',
          data: oldAudio,
          audioRevision: oldRevision,
          isCurrent: true,
        },
        {
          id: oldVocalId,
          trackId,
          type: 'vocals',
          uri: '/catalog/stems/old-vocals.mp3',
          data: oldVocalAudio,
          audioRevision: oldRevision,
          isCurrent: true,
        },
        {
          id: failedOriginalId,
          trackId,
          type: 'original',
          uri: '/catalog/stems/failed-original.mp3',
          data: Buffer.from('failed-pending-audio'),
          audioRevision: failedRevision,
          isCurrent: false,
        },
      ],
    });
    await prisma.audioFingerprint.create({
      data: {
        trackId,
        fingerprint: 'active-fingerprint-before-replacement',
        fingerprintHash: `${TEST_PREFIX}active-fingerprint-hash`,
        duration: 120,
      },
    });

    try {
      expect((await catalog.getTrackStream(trackId))?.data).toEqual(oldAudio);

      eventBus.publish({
        eventName: 'stems.failed',
        eventVersion: 1,
        occurredAt: new Date().toISOString(),
        releaseId,
        artistId: `${TEST_PREFIX}artist`,
        trackId,
        audioRevision: failedRevision,
        error: 'Replacement separation failed',
      });

      let failedTrack: { pendingAudioRevision: string | null; audioReplacementStatus: string | null } | null = null;
      for (let attempt = 0; attempt < 40; attempt += 1) {
        failedTrack = await prisma.track.findUnique({
          where: { id: trackId },
          select: { pendingAudioRevision: true, audioReplacementStatus: true },
        });
        if (failedTrack?.audioReplacementStatus === 'failed') break;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(failedTrack).toEqual({ pendingAudioRevision: null, audioReplacementStatus: 'failed' });
      expect((await prisma.release.findUnique({ where: { id: releaseId } }))?.status).toBe('ready');
      expect((await prisma.audioFingerprint.findUnique({ where: { trackId } }))?.fingerprint)
        .toBe('active-fingerprint-before-replacement');
      expect((await catalog.getTrackStream(trackId))?.data).toEqual(oldAudio);

      await prisma.track.update({
        where: { id: trackId },
        data: {
          pendingAudioRevision: activeRevision,
          audioReplacementStatus: 'processing',
          audioReplacementError: null,
          pendingAudioFingerprint: 'active-fingerprint-after-replacement',
          pendingAudioFingerprintHash: `${TEST_PREFIX}active-fingerprint-new-hash`,
          pendingAudioFingerprintDuration: 121.5,
        },
      });
      await prisma.stem.create({
        data: {
          id: activeOriginalId,
          trackId,
          type: 'original',
          uri: '/catalog/stems/new-original.mp3',
          data: activeAudio,
          audioRevision: activeRevision,
          isCurrent: false,
        },
      });

      const replacementEvent: StemsProcessedEvent = {
        eventName: 'stems.processed',
        eventVersion: 1,
        occurredAt: new Date().toISOString(),
        releaseId,
        artistId: `${TEST_PREFIX}artist`,
        audioRevision: activeRevision,
        modelVersion: 'integration-test',
        tracks: [{
          id: trackId,
          title: 'Replacement Track',
          artist: 'Stale Worker Artist',
          position: 99,
          stems: [
            {
              id: activeOriginalId,
              uri: '/catalog/stems/new-original.mp3',
              type: 'original',
              data: activeAudio,
              mimeType: 'audio/mpeg',
            },
            {
              id: activeVocalId,
              uri: '/catalog/stems/new-vocals.mp3',
              type: 'vocals',
              data: activeVocalAudio,
              mimeType: 'audio/mpeg',
            },
          ],
        }],
      };

      const staleResult = await catalog.activateAudioReplacement({
        ...replacementEvent,
        audioRevision: failedRevision,
        tracks: [{
          ...replacementEvent.tracks[0],
          stems: [{
            id: failedOriginalId,
            uri: '/catalog/stems/failed-result.mp3',
            type: 'original',
          }, {
            id: `${TEST_PREFIX}failed-vocals`,
            uri: '/catalog/stems/failed-vocals.mp3',
            type: 'vocals',
          }],
        }],
      });
      expect(staleResult).toEqual({ applied: false, reason: 'stale_audio_revision' });
      expect((await prisma.track.findUnique({ where: { id: trackId } }))?.pendingAudioRevision)
        .toBe(activeRevision);
      expect((await catalog.getTrackStream(trackId))?.data).toEqual(oldAudio);

      // The event-bus path for tagged worker results delegates to the same method.
      eventBus.publish(replacementEvent);
      let activeTrack: { activeAudioRevision: string | null; audioReplacementStatus: string | null } | null = null;
      for (let attempt = 0; attempt < 40; attempt += 1) {
        activeTrack = await prisma.track.findUnique({
          where: { id: trackId },
          select: { activeAudioRevision: true, audioReplacementStatus: true },
        });
        if (activeTrack?.activeAudioRevision === activeRevision) break;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(activeTrack).toEqual({ activeAudioRevision: activeRevision, audioReplacementStatus: 'complete' });

      const duplicateResult = await catalog.activateAudioReplacement(replacementEvent);
      expect(duplicateResult).toEqual({ applied: false, reason: 'duplicate_audio_revision' });
      expect((await prisma.release.findUnique({ where: { id: releaseId } }))?.status).toBe('ready');
      expect((await catalog.getTrackStream(trackId))?.data).toEqual(activeAudio);

      const stems = await prisma.stem.findMany({ where: { trackId }, orderBy: { id: 'asc' } });
      expect(stems).toHaveLength(5);
      expect(stems.filter((stem) => stem.isCurrent).map((stem) => stem.id).sort()).toEqual(
        [activeOriginalId, activeVocalId].sort(),
      );
      expect(stems.find((stem) => stem.id === oldVocalId)?.isCurrent).toBe(false);
      expect(stems.find((stem) => stem.id === failedOriginalId)?.isCurrent).toBe(false);

      const [historicalBlob, historicalPreview] = await Promise.all([
        catalog.getStemBlob(oldVocalId),
        catalog.getStemPreview(oldVocalId),
      ]);
      expect(historicalBlob?.data).toEqual(oldVocalAudio);
      expect(historicalPreview.data).toEqual(oldVocalAudio);

      const trackView = await catalog.getTrack(trackId);
      expect(trackView?.stems.map((stem) => stem.id).sort()).toEqual([activeOriginalId, activeVocalId].sort());
      const releaseView = await catalog.getRelease(releaseId);
      expect(releaseView?.tracks[0].stems.map((stem: any) => stem.id).sort())
        .toEqual([activeOriginalId, activeVocalId].sort());
      const managedRelease = (await catalog.listByUserId(`${TEST_PREFIX}user`))
        .find((item: any) => item.id === releaseId);
      expect(managedRelease?.tracks[0].stems.map((stem: any) => stem.id).sort())
        .toEqual([activeOriginalId, activeVocalId].sort());
      const discoveryRelease = (await catalog.search('Replacement Revision Lifecycle')).items
        .find((item: any) => item.id === releaseId);
      expect((discoveryRelease as any)?.tracks[0].stems.map((stem: any) => stem.id).sort())
        .toEqual([activeOriginalId, activeVocalId].sort());
      const playerActions = await catalog.getPlayerTrackActions(trackId);
      const inspectAction = playerActions?.actions.find((action) => action.key === 'inspect_stems');
      expect(inspectAction?.metadata?.stemCount).toBe(2);

      const fingerprint = await prisma.audioFingerprint.findUnique({ where: { trackId } });
      expect(fingerprint).toEqual(expect.objectContaining({
        fingerprint: 'active-fingerprint-after-replacement',
        fingerprintHash: `${TEST_PREFIX}active-fingerprint-new-hash`,
        duration: 121.5,
      }));
      const trackAfterFingerprint = await prisma.track.findUnique({ where: { id: trackId } });
      expect(trackAfterFingerprint).toEqual(expect.objectContaining({
        pendingAudioRevision: null,
        pendingAudioFingerprint: null,
        pendingAudioFingerprintHash: null,
        pendingAudioFingerprintDuration: null,
        artist: 'Current Artist',
        position: 1,
      }));
      expect(trackStatusEvents.filter((event) => event.trackId === trackId && event.status === 'complete'))
        .toHaveLength(1);
      expect(releaseReadyEvents.filter((event) => event.releaseId === releaseId)).toHaveLength(0);
    } finally {
      await prisma.audioFingerprint.deleteMany({ where: { trackId } }).catch(() => {});
      await prisma.stem.deleteMany({ where: { trackId } }).catch(() => {});
      await prisma.track.deleteMany({ where: { id: trackId } }).catch(() => {});
      await prisma.release.delete({ where: { id: releaseId } }).catch(() => {});
    }
  }, 15000);

  it('fails a pending replacement if publication wins the release lock', async () => {
    const releaseId = `${TEST_PREFIX}replacement_publish_race_release`;
    const trackId = `${TEST_PREFIX}replacement_publish_race_track`;
    const oldStemId = `${TEST_PREFIX}replacement_publish_race_old`;
    const stagedOriginalId = `${TEST_PREFIX}replacement_publish_race_new`;
    const revision = `${TEST_PREFIX}replacement_publish_race_revision`;
    const oldAudio = Buffer.from('audio-before-publication');

    await prisma.release.create({
      data: {
        id: releaseId,
        artistId: `${TEST_PREFIX}artist`,
        title: 'Replacement Publication Race',
        status: 'ready',
      },
    });
    await prisma.track.create({
      data: {
        id: trackId,
        releaseId,
        title: 'Publication Race Track',
        processingStatus: 'complete',
        activeAudioRevision: `${TEST_PREFIX}previous_revision`,
        pendingAudioRevision: revision,
        audioReplacementStatus: 'processing',
      },
    });
    await prisma.stem.createMany({
      data: [
        {
          id: oldStemId,
          trackId,
          type: 'original',
          uri: '/catalog/stems/before-publication.mp3',
          data: oldAudio,
          audioRevision: `${TEST_PREFIX}previous_revision`,
          isCurrent: true,
        },
        {
          id: stagedOriginalId,
          trackId,
          type: 'original',
          uri: '/catalog/stems/pending-publication.mp3',
          data: Buffer.from('pending-audio'),
          audioRevision: revision,
          isCurrent: false,
        },
      ],
    });

    try {
      let signalReleaseLock!: () => void;
      let allowPublication!: () => void;
      const releaseLocked = new Promise<void>((resolve) => { signalReleaseLock = resolve; });
      const publicationGate = new Promise<void>((resolve) => { allowPublication = resolve; });
      const publicationTransaction = prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "Release" WHERE "id" = ${releaseId} FOR UPDATE`;
        signalReleaseLock();
        await publicationGate;
        await tx.release.update({ where: { id: releaseId }, data: { status: 'published' } });
      });
      await releaseLocked;

      const activationPromise = catalog.activateAudioReplacement({
        eventName: 'stems.processed',
        eventVersion: 1,
        occurredAt: new Date().toISOString(),
        releaseId,
        artistId: `${TEST_PREFIX}artist`,
        audioRevision: revision,
        modelVersion: 'integration-test',
        tracks: [{
          id: trackId,
          title: 'Publication Race Track',
          position: 1,
          stems: [
            { id: stagedOriginalId, uri: '/catalog/stems/pending-publication.mp3', type: 'original' },
            { id: `${TEST_PREFIX}replacement_publish_race_vocals`, uri: '/catalog/stems/pending-vocals.mp3', type: 'vocals' },
          ],
        }],
      });
      await new Promise((resolve) => setTimeout(resolve, 25));
      allowPublication();
      await publicationTransaction;

      await expect(activationPromise).resolves.toEqual({
        applied: false,
        reason: 'Release is no longer ready for audio replacement',
      });
      const [release, track, stems, stream] = await Promise.all([
        prisma.release.findUnique({ where: { id: releaseId } }),
        prisma.track.findUnique({ where: { id: trackId } }),
        prisma.stem.findMany({ where: { trackId } }),
        catalog.getTrackStream(trackId),
      ]);
      expect(release?.status).toBe('published');
      expect(track).toEqual(expect.objectContaining({
        pendingAudioRevision: null,
        activeAudioRevision: `${TEST_PREFIX}previous_revision`,
        audioReplacementStatus: 'failed',
      }));
      expect(stems).toHaveLength(2);
      expect(stems.find((stem) => stem.id === oldStemId)).toEqual(expect.objectContaining({ isCurrent: true }));
      expect(stems.find((stem) => stem.id === stagedOriginalId)).toEqual(expect.objectContaining({ isCurrent: false }));
      expect(stream?.data).toEqual(oldAudio);
    } finally {
      await prisma.stem.deleteMany({ where: { trackId } }).catch(() => {});
      await prisma.track.deleteMany({ where: { id: trackId } }).catch(() => {});
      await prisma.release.delete({ where: { id: releaseId } }).catch(() => {});
    }
  }, 15000);

  it('increments release artworkRevision atomically and returns the versioned URL', async () => {
    const release = await prisma.release.create({
      data: {
        id: `${TEST_PREFIX}artwork_revision_release`,
        artistId: `${TEST_PREFIX}artist`,
        title: 'Artwork Revision Release',
        status: 'ready',
        rightsRoute: 'STANDARD_ESCROW',
        artworkData: Buffer.from('initial-artwork'),
        artworkMimeType: 'image/png',
      },
    });
    const image = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    );

    try {
      expect(release.artworkRevision).toBe(1);

      const updated = await catalog.updateReleaseArtwork(
        release.id,
        `${TEST_PREFIX}user`,
        { buffer: image, mimetype: 'image/png' },
      );

      expect(updated).toMatchObject({
        artworkRevision: 2,
        artworkUrl: `/catalog/releases/${release.id}/artwork/v2`,
      });
      await expect(
        prisma.release.findUnique({ where: { id: release.id }, select: { artworkRevision: true } }),
      ).resolves.toMatchObject({ artworkRevision: 2 });

      const publicRelease = await catalog.getRelease(release.id);
      expect(publicRelease?.artworkRevision).toBe(2);
      await expect(catalog.getReleaseArtwork(release.id, '1')).resolves.toMatchObject({
        mimeType: 'image/png',
      });
      await expect(catalog.getReleaseArtwork(release.id, '2')).resolves.toMatchObject({
        mimeType: 'image/png',
      });
      await expect(catalog.getReleaseArtwork(release.id, '3')).resolves.toBeNull();
      await expect(catalog.getReleaseArtwork(release.id, 'not-a-revision')).resolves.toBeNull();
    } finally {
      await prisma.release.delete({ where: { id: release.id } });
    }
  });

  it('rejects a new track without an explicit AI disclosure', async () => {
    await expect(catalog.createRelease({
      userId: `${TEST_PREFIX}user`,
      title: 'Missing Disclosure',
      tracks: [{ title: 'Undeclared Track', position: 1 }],
    } as any)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('keeps fully AI-generated tracks available through direct catalog reads', async () => {
    const created = await catalog.createRelease({
      userId: `${TEST_PREFIX}user`,
      title: 'Direct AI Catalog Release',
      tracks: [{
        title: 'Declared AI Track',
        position: 1,
        aiDisclosure: { level: 'all', facets: ['production'] },
      }],
    });
    await prisma.release.update({
      where: { id: created.id },
      data: { status: 'ready' },
    });

    const release = await catalog.getRelease(created.id);
    expect(release?.aiDisclosure).toMatchObject({ level: 'all', containsAI: 'All' });
    expect(release?.tracks[0].aiDisclosure).toMatchObject({
      level: 'all',
      facets: ['production'],
      source: 'artist',
    });
  });

  it('retrieves a release with full relations', async () => {
    const created = await catalog.createRelease({
      userId: `${TEST_PREFIX}user`,
      title: 'Retrieval Test',
      tracks: [{ title: 'Solo Track', position: 1, aiDisclosure: NO_AI_DISCLOSURE }],
    });
    const release = await catalog.getRelease(created.id);
    expect(release).not.toBeNull();
    expect(release!.artist.displayName).toBe('TC Test Artist');
    expect(release!.tracks[0].title).toBe('Solo Track');
  });

  it('separates public artist discography from managed uploader catalog', async () => {
    const creditedArtist = await prisma.artist.create({
      data: {
        id: `${TEST_PREFIX}credited_official`,
        displayName: 'TC Test Artist',
        profileType: 'public_artist',
        claimStatus: 'unclaimed',
      },
    });
    const officialRelease = await catalog.createRelease({
      userId: `${TEST_PREFIX}user`,
      title: 'Official Credit Release',
      type: 'single',
      primaryArtist: 'TC Test Artist',
      artistCredits: [{ role: 'main', artistId: creditedArtist.id, displayName: 'TC Test Artist' }],
    });
    const managedOnlyRelease = await catalog.createRelease({
      userId: `${TEST_PREFIX}user`,
      title: 'Managed External Credit',
      type: 'single',
      primaryArtist: 'External Credited Artist',
    });
    await prisma.release.updateMany({
      where: { id: { in: [officialRelease.id, managedOnlyRelease.id] } },
      data: { status: 'ready' },
    });
    const externalProfile = await prisma.artist.findFirstOrThrow({
      where: { displayName: 'External Credited Artist', profileType: 'public_artist' },
    });

    const publicArtistReleases = await catalog.listByArtist(`${TEST_PREFIX}artist`);
    expect(publicArtistReleases.some((release) => release.id === officialRelease.id)).toBe(false);
    expect(publicArtistReleases.some((release) => release.id === managedOnlyRelease.id)).toBe(false);

    expect((await catalog.listByArtist(creditedArtist.id)).some((release) => release.id === officialRelease.id)).toBe(true);

    const externalArtistReleases = await catalog.listByArtist(externalProfile.id);
    expect(externalArtistReleases.some((release) => release.id === managedOnlyRelease.id)).toBe(true);

    const ownerReleases = await catalog.listByUserId(`${TEST_PREFIX}user`);
    expect(ownerReleases.some((release) => release.id === officialRelease.id)).toBe(true);
    expect(ownerReleases.some((release) => release.id === managedOnlyRelease.id)).toBe(true);
  });

  it('supports several main artists plus featured credits on one release', async () => {
    const created = await catalog.createRelease({
      userId: `${TEST_PREFIX}user`,
      title: 'Shared Billing Release',
      type: 'single',
      artistCredits: [
        { role: 'main', displayName: 'Alpha Artist', sortOrder: 0 },
        { role: 'main', displayName: 'Beta Artist', sortOrder: 1 },
        { role: 'featured', displayName: 'Guest Artist', sortOrder: 2 },
        { role: 'producer', displayName: 'Studio Producer', sortOrder: 3 },
      ],
    });

    const release = await catalog.getRelease(created.id, { includeRestricted: true });
    expect(release?.artistCredits.map((credit) => ({
      role: credit.role,
      displayName: credit.displayName,
      sortOrder: credit.sortOrder,
    }))).toEqual([
      { role: 'main', displayName: 'Alpha Artist', sortOrder: 0 },
      { role: 'main', displayName: 'Beta Artist', sortOrder: 1 },
      { role: 'featured', displayName: 'Guest Artist', sortOrder: 2 },
      { role: 'producer', displayName: 'Studio Producer', sortOrder: 3 },
    ]);
  });

  it('records release credit identity provenance without changing artist ownership', async () => {
    const uniqueName = `${TEST_PREFIX}Unique Credit Artist`;
    const duplicateName = `${TEST_PREFIX}Twin Credit Artist`;
    const createdName = `${TEST_PREFIX}New Credit Artist`;
    const uniqueArtistId = `${TEST_PREFIX}identity_unique_artist`;
    const duplicateArtistIds = [
      `${TEST_PREFIX}identity_duplicate_a`,
      `${TEST_PREFIX}identity_duplicate_b`,
    ];
    const selectedArtistId = `${TEST_PREFIX}identity_selected_artist`;

    await prisma.artist.create({
      data: {
        id: uniqueArtistId,
        displayName: uniqueName,
        profileType: 'public_artist',
        claimStatus: 'unclaimed',
      },
    });
    await prisma.artist.createMany({
      data: duplicateArtistIds.map((id, index) => ({
        id,
        displayName: index === 0 ? duplicateName : duplicateName.toLowerCase(),
        profileType: 'public_artist',
        claimStatus: 'unclaimed',
      })),
    });
    const selectedArtist = await prisma.artist.create({
      data: {
        id: selectedArtistId,
        displayName: `${TEST_PREFIX}Selected Artist`,
        profileType: 'public_artist',
        claimStatus: 'unclaimed',
      },
    });
    const managerBefore = await prisma.artist.findUniqueOrThrow({
      where: { id: `${TEST_PREFIX}artist` },
      select: { id: true, userId: true, claimStatus: true },
    });

    const created = await catalog.createRelease({
      userId: `${TEST_PREFIX}user`,
      title: 'Credit Identity Provenance',
      artistCredits: [
        { role: 'main', displayName: uniqueName.toUpperCase(), sortOrder: 0 },
        { role: 'main', displayName: duplicateName.toUpperCase(), sortOrder: 1 },
        { role: 'main', artistId: selectedArtist.id, displayName: 'Selected Alias', sortOrder: 2 },
        { role: 'featured', displayName: createdName, sortOrder: 3 },
      ],
    });
    await prisma.release.update({ where: { id: created.id }, data: { status: 'ready' } });

    const release = await catalog.getRelease(created.id, { includeRestricted: true });
    expect(release).not.toBeNull();
    const credits = release!.artistCredits as Array<{
      id: string;
      artistId: string;
      displayName: string;
      role: string;
      sortOrder: number;
      identityStatus: string;
    }>;
    expect(credits.map(({ identityStatus, sortOrder }) => ({ identityStatus, sortOrder }))).toEqual([
      { identityStatus: 'inferred', sortOrder: 0 },
      { identityStatus: 'ambiguous', sortOrder: 1 },
      { identityStatus: 'selected', sortOrder: 2 },
      { identityStatus: 'created', sortOrder: 3 },
    ]);

    const ambiguousCredit = credits.find(({ identityStatus }) => identityStatus === 'ambiguous')!;
    const ambiguousArtist = await prisma.artist.findUniqueOrThrow({
      where: { id: ambiguousCredit.artistId },
      select: { id: true, displayName: true, profileType: true, claimStatus: true, userId: true },
    });
    expect(duplicateArtistIds).not.toContain(ambiguousArtist.id);
    expect(ambiguousArtist).toMatchObject({
      displayName: duplicateName.toUpperCase(),
      profileType: 'public_artist',
      claimStatus: 'unclaimed',
      userId: null,
    });

    const uniqueCredit = credits.find(({ sortOrder }) => sortOrder === 0)!;
    expect(uniqueCredit.artistId).toBe(uniqueArtistId);
    const explicitCredit = credits.find(({ sortOrder }) => sortOrder === 2)!;
    expect(explicitCredit.artistId).toBe(selectedArtistId);
    expect(await prisma.artist.findUniqueOrThrow({
      where: { id: selectedArtistId },
      select: { userId: true, claimStatus: true },
    })).toEqual({ userId: null, claimStatus: 'unclaimed' });

    expect((await catalog.listByArtist(ambiguousArtist.id)).some(({ id }) => id === created.id)).toBe(false);
    expect((await catalog.listByArtist(`${TEST_PREFIX}artist`)).some(({ id }) => id === created.id)).toBe(false);
    expect((await catalog.listByArtist(uniqueArtistId)).some(({ id }) => id === created.id)).toBe(true);
    expect((await catalog.listByArtist(selectedArtistId)).some(({ id }) => id === created.id)).toBe(true);

    await expect(catalog.reviewCreditIdentity(
      ambiguousCredit.id, `${TEST_PREFIX}user`, 'listener', selectedArtistId,
      'Reviewed the source credit evidence.',
    )).rejects.toBeInstanceOf(ForbiddenException);
    await expect(catalog.reviewCreditIdentity(
      ambiguousCredit.id, `${TEST_PREFIX}user`, 'operator', `${TEST_PREFIX}missing`,
      'Reviewed the source credit evidence.',
    )).rejects.toThrow('Artist profile was not found');
    await expect(catalog.reviewCreditIdentity(
      ambiguousCredit.id, `${TEST_PREFIX}user`, 'operator', managerBefore.id,
      'Reviewed the source credit evidence.',
    )).rejects.toThrow('Credit identity must be a public artist profile');
    const reviewedCredit = await catalog.reviewCreditIdentity(
      ambiguousCredit.id, `${TEST_PREFIX}user`, 'operator', selectedArtistId,
      'Reviewed the source credit evidence.',
    );
    expect(reviewedCredit).toMatchObject({
      id: ambiguousCredit.id,
      artistId: selectedArtistId,
      identityStatus: 'reviewed',
    });
    expect(await prisma.releaseArtistCredit.findUniqueOrThrow({
      where: { id: ambiguousCredit.id },
      select: { identityReviewerUserId: true, identityReviewNote: true, identityReviewedAt: true },
    })).toMatchObject({
      identityReviewerUserId: `${TEST_PREFIX}user`,
      identityReviewNote: 'Reviewed the source credit evidence.',
      identityReviewedAt: expect.any(Date),
    });
    expect((await catalog.listByArtist(selectedArtistId)).some(({ id }) => id === created.id)).toBe(true);
    await expect(catalog.reviewCreditIdentity(
      ambiguousCredit.id, `${TEST_PREFIX}user`, 'operator', uniqueArtistId,
      'Reviewed the source credit evidence.',
    )).rejects.toThrow('Only ambiguous credits can be reviewed');

    const managerFallbackRelease = await catalog.createRelease({
      userId: `${TEST_PREFIX}user`,
      title: 'Manager Fallback Credit Identity',
    });
    const managerCredit = await prisma.releaseArtistCredit.findFirstOrThrow({
      where: { releaseId: managerFallbackRelease.id, role: 'main' },
    });
    expect(managerCredit).toMatchObject({ identityStatus: 'ambiguous' });
    expect(managerCredit.artistId).not.toBe(managerBefore.id);
    expect((await prisma.artist.findUniqueOrThrow({ where: { id: managerCredit.artistId } })).profileType).toBe('public_artist');
    expect(await prisma.release.findUniqueOrThrow({
      where: { id: created.id },
      select: { artistId: true },
    })).toEqual({ artistId: managerBefore.id });
    expect(await prisma.artist.findUniqueOrThrow({
      where: { id: managerBefore.id },
      select: { id: true, userId: true, claimStatus: true },
    })).toEqual(managerBefore);

    await expect(catalog.createRelease({
      userId: `${TEST_PREFIX}user`,
      title: 'Unknown Explicit Credit Artist',
      artistCredits: [{ role: 'main', artistId: `${TEST_PREFIX}missing_credit_artist` }],
    })).rejects.toThrow('Release artist credit must reference an existing artist profile');
    await expect(catalog.createRelease({
      userId: `${TEST_PREFIX}user`,
      title: 'Manager Explicit Credit Artist',
      artistCredits: [{ role: 'main', artistId: managerBefore.id }],
    })).rejects.toThrow('Release credits must select a public artist profile');

    const uploadReleaseId = `${TEST_PREFIX}identity_upload_release`;
    eventBus.publish({
      eventName: 'stems.uploaded',
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      releaseId: uploadReleaseId,
      artistId: managerBefore.id,
      checksum: 'identity-upload-checksum',
      metadata: {
        title: 'Upload Exact Credit Identity',
        primaryArtist: 'Upload Fallback Name',
        artistCredits: [{
          artistId: selectedArtistId,
          displayName: 'Upload Selected Alias',
          role: 'main',
          sortOrder: 0,
        }],
        tracks: [],
      },
    });
    let uploadedCredit: { artistId: string; identityStatus: string } | null = null;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      uploadedCredit = await prisma.releaseArtistCredit.findFirst({
        where: { releaseId: uploadReleaseId },
        select: { artistId: true, identityStatus: true },
      });
      if (uploadedCredit) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(uploadedCredit).toEqual({ artistId: selectedArtistId, identityStatus: 'selected' });
    const uploadCreditsBeforeRetry = await prisma.releaseArtistCredit.findMany({
      where: { releaseId: uploadReleaseId },
      orderBy: { sortOrder: 'asc' },
    });

    eventBus.publish({
      eventName: 'stems.uploaded',
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      releaseId: uploadReleaseId,
      artistId: managerBefore.id,
      checksum: 'retry',
      metadata: {
        title: 'Retry Upload Credit Identity',
        primaryArtist: 'Lost Exact Selection',
        tracks: [],
      },
    });
    let retryTitleUpdated = false;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const retryRelease = await prisma.release.findUnique({
        where: { id: uploadReleaseId },
        select: { title: true },
      });
      if (retryRelease?.title === 'Retry Upload Credit Identity') {
        retryTitleUpdated = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(retryTitleUpdated).toBe(true);
    const creditsAfterRetry = await prisma.releaseArtistCredit.findMany({
      where: { releaseId: uploadReleaseId },
      orderBy: { sortOrder: 'asc' },
    });
    expect(creditsAfterRetry.map(({ artistId, identityStatus, sortOrder }) => ({
      artistId,
      identityStatus,
      sortOrder,
    }))).toEqual(uploadCreditsBeforeRetry.map(({ artistId, identityStatus, sortOrder }) => ({
      artistId,
      identityStatus,
      sortOrder,
    })));
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

  it('does not consolidate a same-title non-AI release into an AI-generated release', async () => {
    const canonicalReleaseId = `${TEST_PREFIX}ai_canonical_safe`;
    const canonicalTrackId = `${TEST_PREFIX}ai_track_safe`;
    const canonicalStemId = `${TEST_PREFIX}ai_master_safe`;
    const normalReleaseId = `${TEST_PREFIX}normal_same_title`;
    const normalTrackId = `${TEST_PREFIX}normal_track`;
    const normalVocalStemId = `${TEST_PREFIX}normal_vocals`;

    await prisma.release.create({
      data: {
        id: canonicalReleaseId,
        artistId: `${TEST_PREFIX}artist`,
        title: 'Shared Title',
        status: 'published',
        type: 'ai_generated',
        primaryArtist: 'AI (Lyria)',
        tracks: {
          create: {
            id: canonicalTrackId,
            title: 'Shared Title',
            processingStatus: 'complete',
            stems: {
              create: {
                id: canonicalStemId,
                type: 'master',
                uri: 'gs://bucket/master-safe.mp3',
                storageProvider: 'gcs',
              },
            },
          },
        },
      },
    });
    await prisma.release.create({
      data: {
        id: normalReleaseId,
        artistId: `${TEST_PREFIX}artist`,
        title: 'Shared Title',
        status: 'ready',
        type: 'single',
        primaryArtist: 'TC Test Artist',
        rightsSourceType: 'direct_upload',
        tracks: {
          create: {
            id: normalTrackId,
            title: 'Shared Title',
            processingStatus: 'complete',
            stems: {
              create: {
                id: normalVocalStemId,
                type: 'vocals',
                uri: 'gs://bucket/normal-vocals.mp3',
                storageProvider: 'gcs',
              },
            },
          },
        },
      },
    });

    const release = await catalog.getRelease(canonicalReleaseId, { includeRestricted: true });

    expect(release).not.toBeNull();
    expect(release!.tracks[0].stems.map((stem) => stem.type)).toEqual(['master']);
    const normalRelease = await prisma.release.findUnique({ where: { id: normalReleaseId } });
    expect(normalRelease).not.toBeNull();
    const normalStem = await prisma.stem.findUnique({ where: { id: normalVocalStemId } });
    expect(normalStem?.trackId).toBe(normalTrackId);
  });

  it('updates release title and status', async () => {
    const created = await catalog.createRelease({
      userId: `${TEST_PREFIX}user`,
      title: 'Before Update',
      tracks: [{ title: 'T', position: 1, aiDisclosure: NO_AI_DISCLOSURE }],
    });
    const updated = await catalog.updateRelease(created.id, `${TEST_PREFIX}user`, {
      title: 'After Update',
      status: 'published',
    });
    expect(updated.title).toBe('After Update');
    expect(updated.status).toBe('published');
  });

  it('limits a release manager to the invited catalog scope and honors an ownership transfer', async () => {
    const delegateId = `${TEST_PREFIX}catalog_delegate`;
    const successorId = `${TEST_PREFIX}catalog_successor`;
    await prisma.user.createMany({
      data: [delegateId, successorId].map((id) => ({ id, email: `${id}@test.resonate` })),
    });
    const release = await catalog.createRelease({
      userId: `${TEST_PREFIX}user`,
      title: 'Delegation Before',
      tracks: [{ title: 'T', position: 1, aiDisclosure: NO_AI_DISCLOSURE }],
    });
    await prisma.managementGrant.create({
      data: {
        releaseId: release.id,
        granteeUserId: delegateId,
        inviterUserId: `${TEST_PREFIX}user`,
        scopes: [ManagementScope.CATALOG_METADATA],
        status: ManagementGrantStatus.active,
        acceptedAt: new Date(),
      },
    });

    expect((await catalog.listByUserId(delegateId)).map((item) => item.id)).toContain(release.id);
    await catalog.updateRelease(release.id, delegateId, { title: 'Delegation After' });
    await expect(catalog.updateRelease(release.id, delegateId, { status: 'published' }))
      .rejects.toBeInstanceOf(ForbiddenException);
    await expect(catalog.updateRelease(release.id, delegateId, { primaryArtist: 'Other artist' }))
      .rejects.toBeInstanceOf(ForbiddenException);

    await prisma.release.update({
      where: { id: release.id },
      data: { managementOwnerUserId: successorId },
    });
    await expect(catalog.updateRelease(release.id, `${TEST_PREFIX}user`, { title: 'Former owner edit' }))
      .rejects.toBeInstanceOf(ForbiddenException);
    await catalog.updateRelease(release.id, successorId, { title: 'Successor edit' });
    expect((await catalog.listByUserId(`${TEST_PREFIX}user`)).map((item) => item.id)).not.toContain(release.id);
    expect((await catalog.listByUserId(successorId)).map((item) => item.id)).toContain(release.id);
  });

  it('edits only track title and explicit with the track metadata scope', async () => {
    const delegateId = `${TEST_PREFIX}track_metadata_delegate`;
    const metadataManagerId = `${TEST_PREFIX}release_metadata_manager`;
    const successorId = `${TEST_PREFIX}track_metadata_successor`;
    await prisma.user.createMany({
      data: [delegateId, metadataManagerId, successorId]
        .map((id) => ({ id, email: `${id}@test.resonate` })),
    });

    const release = await catalog.createRelease({
      userId: `${TEST_PREFIX}user`,
      title: 'Track Metadata Release',
      primaryArtist: 'Immutable credited artist',
      tracks: [{ title: 'Original Track', position: 1, aiDisclosure: NO_AI_DISCLOSURE }],
    });
    const trackId = release.tracks[0].id;
    await prisma.track.update({
      where: { id: trackId },
      data: {
        isrc: 'USAAA1234567',
        artist: 'Immutable credited artist',
        aiDisclosureLevel: 'ALL',
        aiContributionFacets: ['production'],
        aiDisclosureSource: 'artist',
        aiDisclosureVersion: 'test-version',
        rightsRoute: 'STANDARD_ESCROW',
        rightsFlags: { publishing: 'reviewed' },
        rightsReason: 'Reviewed before track metadata correction',
        rightsPolicyVersion: 'test-policy',
        rightsEvaluatedAt: new Date('2026-09-01T00:00:00.000Z'),
      },
    });
    const immutableTrackFields = {
      releaseId: true,
      isrc: true,
      artist: true,
      position: true,
      aiDisclosureLevel: true,
      aiContributionFacets: true,
      aiDisclosureSource: true,
      aiDisclosureVersion: true,
      aiDeclaredAt: true,
      rightsRoute: true,
      rightsFlags: true,
      rightsReason: true,
      rightsPolicyVersion: true,
      rightsEvaluatedAt: true,
    } as const;
    const beforeTrack = await prisma.track.findUniqueOrThrow({
      where: { id: trackId },
      select: immutableTrackFields,
    });
    const beforeRelease = await prisma.release.findUniqueOrThrow({
      where: { id: release.id },
      select: { artistId: true, title: true, primaryArtist: true, artistCredits: { select: { artistId: true, displayName: true, role: true } } },
    });

    const ownerUpdate = await catalog.updateTrackMetadata(release.id, trackId, `${TEST_PREFIX}user`, {
      title: '  Owner Edited Track  ',
      explicit: true,
    });
    expect(ownerUpdate).toMatchObject({ title: 'Owner Edited Track', explicit: true });

    await prisma.managementGrant.create({
      data: {
        releaseId: release.id,
        granteeUserId: delegateId,
        inviterUserId: `${TEST_PREFIX}user`,
        scopes: [ManagementScope.TRACK_METADATA],
        status: ManagementGrantStatus.active,
        acceptedAt: new Date(),
      },
    });
    await prisma.managementGrant.create({
      data: {
        releaseId: release.id,
        granteeUserId: metadataManagerId,
        inviterUserId: `${TEST_PREFIX}user`,
        scopes: [ManagementScope.CATALOG_METADATA],
        status: ManagementGrantStatus.active,
        acceptedAt: new Date(),
      },
    });

    const delegatedUpdate = await catalog.updateTrackMetadata(release.id, trackId, delegateId, {
      title: 'Delegated Track Name',
      explicit: false,
    });
    expect(delegatedUpdate).toMatchObject({ title: 'Delegated Track Name', explicit: false });
    const explicitOnlyUpdate = await catalog.updateTrackMetadata(release.id, trackId, delegateId, {
      explicit: true,
    });
    expect(explicitOnlyUpdate).toMatchObject({ title: 'Delegated Track Name', explicit: true });
    await expect(catalog.updateRelease(release.id, delegateId, { title: 'Release edit denied' }))
      .rejects.toBeInstanceOf(ForbiddenException);
    await expect(catalog.updateTrackMetadata(release.id, trackId, metadataManagerId, { explicit: true }))
      .rejects.toBeInstanceOf(ForbiddenException);
    await expect(catalog.updateTrackMetadata(release.id, trackId, `${TEST_PREFIX}outsider`, { title: 'Denied' }))
      .rejects.toBeInstanceOf(ForbiddenException);
    await expect(catalog.updateTrackMetadata(release.id, trackId, delegateId, {}))
      .rejects.toBeInstanceOf(BadRequestException);
    await expect(catalog.updateTrackMetadata(release.id, trackId, delegateId, { title: '  ' }))
      .rejects.toBeInstanceOf(BadRequestException);
    await expect(catalog.updateTrackMetadata(release.id, trackId, delegateId, { title: 'x'.repeat(201) }))
      .rejects.toBeInstanceOf(BadRequestException);
    await expect(catalog.updateTrackMetadata(release.id, trackId, delegateId, { explicit: 'yes' }))
      .rejects.toBeInstanceOf(BadRequestException);
    await expect(catalog.updateTrackMetadata(release.id, trackId, delegateId, { title: 'Name', isrc: 'mutable?' }))
      .rejects.toBeInstanceOf(BadRequestException);

    const otherRelease = await catalog.createRelease({
      userId: `${TEST_PREFIX}user`,
      title: 'Other Track Metadata Release',
      tracks: [{ title: 'Other Track', position: 1, aiDisclosure: NO_AI_DISCLOSURE }],
    });
    await expect(catalog.updateTrackMetadata(release.id, otherRelease.tracks[0].id, `${TEST_PREFIX}user`, {
      title: 'Wrong parent',
    })).rejects.toThrow('Track not found for this release');

    const afterTrack = await prisma.track.findUniqueOrThrow({
      where: { id: trackId },
      select: immutableTrackFields,
    });
    const afterRelease = await prisma.release.findUniqueOrThrow({
      where: { id: release.id },
      select: { artistId: true, title: true, primaryArtist: true, artistCredits: { select: { artistId: true, displayName: true, role: true } } },
    });
    expect(afterTrack).toEqual(beforeTrack);
    expect(afterRelease).toEqual(beforeRelease);
    expect((await prisma.track.findUniqueOrThrow({ where: { id: trackId } })).title)
      .toBe('Delegated Track Name');

    const management = new ManagementService();
    const transfer = await management.createTransfer(`${TEST_PREFIX}user`, {
      recipientEmail: `${successorId}@test.resonate`,
      releaseIds: [release.id],
    });
    await management.acceptTransfer(successorId, transfer.id);
    await expect(catalog.updateTrackMetadata(release.id, trackId, delegateId, { title: 'After transfer' }))
      .rejects.toBeInstanceOf(ForbiddenException);
    await catalog.updateTrackMetadata(release.id, trackId, successorId, { title: 'Successor Track Name' });
  });

  it('does not let an owner reopen a published release to bypass disclosure locking', async () => {
    const created = await catalog.createRelease({
      userId: `${TEST_PREFIX}user`,
      title: 'Locked Disclosure',
      tracks: [{ title: 'Locked Track', position: 1, aiDisclosure: NO_AI_DISCLOSURE }],
    });
    await catalog.updateRelease(created.id, `${TEST_PREFIX}user`, {
      status: 'published',
    });

    await expect(
      catalog.updateRelease(created.id, `${TEST_PREFIX}user`, { status: 'draft' }),
    ).rejects.toThrow('cannot return to an editable lifecycle state');
    await expect(
      catalog.updateRelease(created.id, `${TEST_PREFIX}user`, {
        tracks: [{
          id: created.tracks[0].id,
          aiDisclosure: { level: 'all', facets: [] },
        }],
      }),
    ).rejects.toThrow('cannot be silently replaced');
  });

  // #1492: owner-scoped post-hoc correction of the credited artist.
  describe('updateRelease primaryArtist correction (#1492)', () => {
    let releaseId: string;

    beforeAll(async () => {
      // A second user with no claim on the release — the non-owner caller.
      await prisma.user.create({
        data: { id: `${TEST_PREFIX}user2`, email: `${TEST_PREFIX}user2@test.resonate` },
      });
      const created = await catalog.createRelease({
        userId: `${TEST_PREFIX}user`,
        title: 'Miscredited Release',
        tracks: [{ title: 'T', position: 1, aiDisclosure: NO_AI_DISCLOSURE }],
      });
      releaseId = created.id;
    });

    it('lets the owner correct the credited artist', async () => {
      const updated = await catalog.updateRelease(releaseId, `${TEST_PREFIX}user`, {
        primaryArtist: '  The   Game ',
      });
      // Trimmed + whitespace-collapsed on write.
      expect(updated.primaryArtist).toBe('The Game');
    });

    it('rejects a non-owner with Forbidden', async () => {
      await expect(
        catalog.updateRelease(releaseId, `${TEST_PREFIX}user2`, {
          primaryArtist: 'Hijacked Credit',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects an empty credited artist with BadRequest', async () => {
      await expect(
        catalog.updateRelease(releaseId, `${TEST_PREFIX}user`, { primaryArtist: '   ' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects an over-long credited artist with BadRequest', async () => {
      await expect(
        catalog.updateRelease(releaseId, `${TEST_PREFIX}user`, {
          primaryArtist: 'x'.repeat(201),
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
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

  it('uses the contained source loader for unencrypted marketplace previews', async () => {
    const releaseId = `${TEST_PREFIX}preview_release_unencrypted`;
    const trackId = `${TEST_PREFIX}preview_track_unencrypted`;
    const stemId = `${TEST_PREFIX}preview_stem_unencrypted`;
    const stemUri = 'resonate-stems-staging/originals/preview-raw.mp3';
    const loadSourceBuffer = jest.fn().mockResolvedValue(Buffer.from('raw-preview'));
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
      { decrypt: jest.fn(), loadSourceBuffer } as unknown as EncryptionService,
      { download: jest.fn(), upload: jest.fn(), delete: jest.fn() } as unknown as LocalStorageProvider,
      new UploadRightsRoutingService(),
    );

    try {
      const preview = await previewCatalog.getStemPreview(stemId);

      expect(preview.data.toString()).toBe('raw-preview');
      expect(loadSourceBuffer).toHaveBeenCalledWith(stemUri);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
      await prisma.stem.delete({ where: { id: stemId } });
      await prisma.track.delete({ where: { id: trackId } });
      await prisma.release.delete({ where: { id: releaseId } });
    }
  });

  it('does not raw-fetch a hostile stem URI after source policy rejection', async () => {
    const releaseId = `${TEST_PREFIX}hostile_release`;
    const trackId = `${TEST_PREFIX}hostile_track`;
    const stemId = `${TEST_PREFIX}hostile_stem`;
    const hostileUri = 'http://evil.example/catalog/stems/existing.wav/blob';
    const fetchSpy = jest.spyOn(global, 'fetch');

    await prisma.release.create({
      data: {
        id: releaseId,
        artistId: `${TEST_PREFIX}artist`,
        title: 'Hostile Source',
        status: 'ready',
        rightsRoute: 'STANDARD_ESCROW',
      },
    });
    await prisma.track.create({
      data: {
        id: trackId,
        releaseId,
        title: 'Hostile Source Track',
      },
    });
    await prisma.stem.create({
      data: {
        id: stemId,
        trackId,
        type: 'vocals',
        uri: hostileUri,
        storageProvider: 'local',
      },
    });

    try {
      await expect(
        catalog.getStemBlob(stemId, { includeRestricted: true }),
      ).resolves.toBeNull();
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
      await prisma.stem.delete({ where: { id: stemId } });
      await prisma.track.delete({ where: { id: trackId } });
      await prisma.release.delete({ where: { id: releaseId } });
    }
  });

  it('stops after a missing local-disk source instead of fetching its own blob route', async () => {
    const releaseId = `${TEST_PREFIX}missing_local_release`;
    const trackId = `${TEST_PREFIX}missing_local_track`;
    const stemId = `${TEST_PREFIX}missing_local_stem`;
    const loadSourceBuffer = jest.fn();
    const localCatalog = new CatalogService(
      eventBus,
      { loadSourceBuffer } as unknown as EncryptionService,
      new LocalStorageProvider(),
      new UploadRightsRoutingService(),
    );

    await prisma.release.create({
      data: {
        id: releaseId,
        artistId: `${TEST_PREFIX}artist`,
        title: 'Missing Local Source',
        status: 'ready',
        rightsRoute: 'STANDARD_ESCROW',
      },
    });
    await prisma.track.create({
      data: { id: trackId, releaseId, title: 'Missing Local Source Track' },
    });
    await prisma.stem.create({
      data: {
        id: stemId,
        trackId,
        type: 'vocals',
        uri: `/catalog/stems/${stemId}.mp3/blob`,
        storageProvider: 'local',
      },
    });

    try {
      await expect(
        localCatalog.getStemBlob(stemId, { includeRestricted: true }),
      ).resolves.toBeNull();
      expect(loadSourceBuffer).not.toHaveBeenCalled();
    } finally {
      await prisma.stem.delete({ where: { id: stemId } });
      await prisma.track.delete({ where: { id: trackId } });
      await prisma.release.delete({ where: { id: releaseId } });
    }
  });

  it('retains contained disk lookup compatibility for legacy bare local filenames', () => {
    expect(
      (catalog as any).getLocalStemFilename({ id: 'fallback-id', uri: 'legacy-stem.mp3' }),
    ).toBe('legacy-stem.mp3');
  });

  it('persists processing errors on failed releases and tracks', async () => {
    const created = await catalog.createRelease({
      userId: `${TEST_PREFIX}user`,
      title: 'Failure Capture',
      tracks: [{ title: 'Broken Track', position: 1, aiDisclosure: NO_AI_DISCLOSURE }],
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
      tracks: [{ title: 'Transient Track', position: 1, aiDisclosure: NO_AI_DISCLOSURE }],
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
      tracks: [{ title: 'Doomed', position: 1, aiDisclosure: NO_AI_DISCLOSURE }],
    });
    await prisma.stem.create({
      data: { trackId: created.tracks[0].id, type: 'vocals', uri: '/test.mp3' },
    });
    const result = await catalog.deleteRelease(created.id, `${TEST_PREFIX}user`);
    expect(result.success).toBe(true);
    expect(await prisma.release.findUnique({ where: { id: created.id } })).toBeNull();
  });

  it('deletes saved library tracks and prunes playlists for deleted release tracks', async () => {
    const created = await catalog.createRelease({
      userId: `${TEST_PREFIX}user`,
      title: 'Library Delete Target',
      tracks: [{ title: 'Saved Track', position: 1, aiDisclosure: NO_AI_DISCLOSURE }],
    });
    const trackId = created.tracks[0].id;
    const libraryTrackId = `${TEST_PREFIX}library_${trackId}`;
    const keepTrackId = `${TEST_PREFIX}keep_track`;
    const playlist = await prisma.playlist.create({
      data: {
        userId: `${TEST_PREFIX}user`,
        name: 'Release Playlist',
        trackIds: [trackId, libraryTrackId, keepTrackId],
      },
    });
    await prisma.libraryTrack.create({
      data: {
        id: libraryTrackId,
        userId: `${TEST_PREFIX}user`,
        source: 'remote',
        title: 'Saved Track',
        artist: 'TC Test Artist',
        album: 'Library Delete Target',
        catalogTrackId: trackId,
      },
    });

    const result = await catalog.deleteRelease(created.id, `${TEST_PREFIX}user`);

    expect(result.success).toBe(true);
    expect(await prisma.libraryTrack.findUnique({ where: { id: libraryTrackId } })).toBeNull();
    const updatedPlaylist = await prisma.playlist.findUnique({ where: { id: playlist.id } });
    expect(updatedPlaylist?.trackIds).toEqual([keepTrackId]);
    await prisma.playlist.delete({ where: { id: playlist.id } });
  });

  it('deletes release when stem quality ratings exist', async () => {
    const created = await catalog.createRelease({
      userId: `${TEST_PREFIX}user`,
      title: 'Legacy Rating Delete Target',
      tracks: [{ title: 'Rated Stem', position: 1, aiDisclosure: NO_AI_DISCLOSURE }],
    });
    const stem = await prisma.stem.create({
      data: { trackId: created.tracks[0].id, type: 'vocals', uri: '/rated.mp3' },
    });

    await prisma.stemQualityRating.create({
      data: {
        id: `${TEST_PREFIX}rating`,
        stemId: stem.id,
        curatorUserId: `${TEST_PREFIX}user`,
        score: 5,
        rmsEnergy: 0.1,
        spectralDensity: 0.1,
        silenceRatio: 0.9,
        musicalSalience: 0.1,
        confidence: 0.5,
        taskType: 'stem.quality_rating',
        analysisMethod: 'test',
        analysisMetadata: {},
        onchainStatus: 'local',
      },
    });

    const result = await catalog.deleteRelease(created.id, `${TEST_PREFIX}user`);

    expect(result.success).toBe(true);
    expect(await prisma.stemQualityRating.findUnique({ where: { id: `${TEST_PREFIX}rating` } })).toBeNull();
    expect(await prisma.stem.findUnique({ where: { id: stem.id } })).toBeNull();
    expect(await prisma.release.findUnique({ where: { id: created.id } })).toBeNull();
  });

  it('deletes release with purchased stem listing', async () => {
    const created = await catalog.createRelease({
      userId: `${TEST_PREFIX}user`,
      title: 'Purchased Stem Delete Target',
      tracks: [{ title: 'Sold Stem', position: 1, aiDisclosure: NO_AI_DISCLOSURE }],
    });
    const stem = await prisma.stem.create({
      data: { trackId: created.tracks[0].id, type: 'vocals', uri: '/sold.mp3' },
    });
    const listing = await prisma.stemListing.create({
      data: {
        listingId: BigInt(Date.now()),
        stemId: stem.id,
        tokenId: BigInt(Date.now() + 1),
        chainId: 31337,
        contractAddress: '0x' + '1'.repeat(40),
        sellerAddress: '0x' + '2'.repeat(40),
        pricePerUnit: '5000000000000000',
        amount: BigInt(1),
        paymentToken: '0x' + '3'.repeat(40),
        expiresAt: new Date(Date.now() + 86_400_000),
        transactionHash: '0x' + `${TEST_PREFIX}listing`.padEnd(64, '0').slice(0, 64),
        blockNumber: BigInt(1),
        listedAt: new Date(),
      },
    });
    const purchase = await prisma.stemPurchase.create({
      data: {
        listingId: listing.id,
        buyerAddress: '0x' + '4'.repeat(40),
        amount: BigInt(1),
        totalPaid: '5000000000000000',
        royaltyPaid: '250000000000000',
        protocolFeePaid: '50000000000000',
        sellerReceived: '4700000000000000',
        transactionHash: '0x' + `${TEST_PREFIX}purchase`.padEnd(64, '0').slice(0, 64),
        blockNumber: BigInt(2),
        purchasedAt: new Date(),
      },
    });

    const result = await catalog.deleteRelease(created.id, `${TEST_PREFIX}user`);

    expect(result.success).toBe(true);
    expect(await prisma.stemPurchase.findUnique({ where: { id: purchase.id } })).toBeNull();
    expect(await prisma.stemListing.findUnique({ where: { id: listing.id } })).toBeNull();
    expect(await prisma.release.findUnique({ where: { id: created.id } })).toBeNull();
  });

  it('deletes a failed upload release that already has a fingerprint', async () => {
    const created = await catalog.createRelease({
      userId: `${TEST_PREFIX}user`,
      title: 'Failed Fingerprinted Release',
      tracks: [{ title: 'Broken Upload', position: 1, aiDisclosure: NO_AI_DISCLOSURE }],
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

  it('deletes release for the owner when stored wallet casing differs from the JWT subject', async () => {
    const mixedCaseUserId = `${TEST_PREFIX}OwnerMixed`;
    const releaseId = `${TEST_PREFIX}case_release`;
    const trackId = `${TEST_PREFIX}case_track`;

    await prisma.user.create({
      data: { id: mixedCaseUserId, email: `${TEST_PREFIX}owner-mixed@test.resonate` },
    });
    await prisma.artist.create({
      data: {
        id: `${TEST_PREFIX}case_artist`,
        userId: mixedCaseUserId,
        displayName: 'Case Owner',
        payoutAddress: '0x' + 'C'.repeat(40),
      },
    });
    await prisma.release.create({
      data: {
        id: releaseId,
        artistId: `${TEST_PREFIX}case_artist`,
        title: 'Case Sensitive Delete Target',
        status: 'ready',
      },
    });
    await prisma.track.create({
      data: { id: trackId, releaseId, title: 'Case Track', position: 1 },
    });

    const result = await catalog.deleteRelease(releaseId, mixedCaseUserId.toLowerCase());

    expect(result.success).toBe(true);
    expect(await prisma.release.findUnique({ where: { id: releaseId } })).toBeNull();
    await prisma.artist.delete({ where: { id: `${TEST_PREFIX}case_artist` } });
    await prisma.user.delete({ where: { id: mixedCaseUserId } });
  });

  it('rejects delete for wrong user', async () => {
    const created = await catalog.createRelease({
      userId: `${TEST_PREFIX}user`,
      title: 'Protected',
      tracks: [{ title: 'T', position: 1, aiDisclosure: NO_AI_DISCLOSURE }],
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

  it('returns safe player actions from public track and active listing state', async () => {
    const releaseId = `${TEST_PREFIX}player_actions_release`;
    const trackId = `${TEST_PREFIX}player_actions_track`;
    const activeStemId = `${TEST_PREFIX}player_actions_stem_active`;
    const expiredStemId = `${TEST_PREFIX}player_actions_stem_expired`;
    const sellerAddress = `0x${'B'.repeat(40)}`;
    const now = new Date();

    await prisma.release.create({
      data: {
        id: releaseId,
        artistId: `${TEST_PREFIX}artist`,
        title: 'Player Action Release',
        status: 'published',
        type: 'single',
        primaryArtist: 'TC Test Artist',
        genre: 'Jazz',
        moods: ['focused'],
        tracks: {
          create: {
            id: trackId,
            title: 'Actionable Track',
            processingStatus: 'complete',
            stems: {
              create: [
                {
                  id: activeStemId,
                  type: 'vocals',
                  uri: 'gs://bucket/action-vocals.mp3',
                  storageProvider: 'gcs',
                  nftMint: {
                    create: {
                      tokenId: BigInt(701001),
                      chainId: 11155111,
                      contractAddress: `0x${'C'.repeat(40)}`,
                      creatorAddress: `0x${'A'.repeat(40)}`,
                      royaltyBps: 500,
                      remixable: true,
                      metadataUri: 'ipfs://player-actions-active',
                      transactionHash: `${TEST_PREFIX}mint_active`,
                      blockNumber: BigInt(1),
                      mintedAt: now,
                    },
                  },
                },
                {
                  id: expiredStemId,
                  type: 'drums',
                  uri: 'gs://bucket/action-drums.mp3',
                  storageProvider: 'gcs',
                },
              ],
            },
          },
        },
      },
    });

    await prisma.stemListing.createMany({
      data: [
        {
          listingId: BigInt(801001),
          stemId: activeStemId,
          tokenId: BigInt(701001),
          chainId: 11155111,
          contractAddress: `0x${'C'.repeat(40)}`,
          sellerAddress,
          pricePerUnit: '1000000',
          amount: BigInt(1),
          paymentToken: `0x${'D'.repeat(40)}`,
          expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
          transactionHash: `${TEST_PREFIX}listing_active`,
          blockNumber: BigInt(2),
          licenseType: 'remix',
          status: 'active',
          listedAt: now,
        },
        {
          listingId: BigInt(801002),
          stemId: expiredStemId,
          tokenId: BigInt(701002),
          chainId: 11155111,
          contractAddress: `0x${'C'.repeat(40)}`,
          sellerAddress,
          pricePerUnit: '2000000',
          amount: BigInt(1),
          paymentToken: `0x${'D'.repeat(40)}`,
          expiresAt: new Date(now.getTime() - 24 * 60 * 60 * 1000),
          transactionHash: `${TEST_PREFIX}listing_expired`,
          blockNumber: BigInt(3),
          licenseType: 'commercial',
          status: 'active',
          listedAt: now,
        },
      ],
    });

    const result = await catalog.getPlayerTrackActions(trackId, {
      recommendationReasons: ['genre:jazz', 'raw private text should be ignored'],
    });

    expect(result).not.toBeNull();
    expect(result!.library).toBeNull();
    expect(result!.recommendation?.reasons).toEqual(['Matches your jazz preference']);

    const buyAction = result!.actions.find((action) => action.key === 'buy_license');
    expect(buyAction).toMatchObject({
      status: 'available',
      metadata: expect.objectContaining({
        listingCount: 1,
        firstListingId: '801001',
        licenseTypes: ['remix'],
      }),
    });

    const remixAction = result!.actions.find((action) => action.key === 'remix');
    expect(remixAction?.status).toBe('available');

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(sellerAddress);
    expect(serialized).not.toContain('listing_expired');
    expect(serialized).not.toContain('raw private text');

    const otherUserId = `${TEST_PREFIX}player_actions_other_user`;
    await prisma.user.create({
      data: { id: otherUserId, email: `${otherUserId}@test.resonate` },
    });
    try {
      const otherSave = await prisma.libraryTrack.create({
        data: {
          userId: otherUserId,
          source: 'remote',
          title: 'Actionable Track',
          catalogTrackId: trackId,
        },
      });
      const callerUnsaved = await catalog.getPlayerTrackActions(trackId, {
        userId: `${TEST_PREFIX}user`,
      });
      expect(callerUnsaved!.library).toEqual({ saved: false, libraryTrackId: null });

      const callerSave = await prisma.libraryTrack.create({
        data: {
          userId: `${TEST_PREFIX}user`,
          source: 'remote',
          title: 'Actionable Track',
          catalogTrackId: trackId,
        },
      });
      const callerSaved = await catalog.getPlayerTrackActions(trackId, {
        userId: `${TEST_PREFIX}user`,
      });
      expect(callerSaved!.library).toEqual({ saved: true, libraryTrackId: callerSave.id });
      expect(JSON.stringify(callerSaved)).not.toContain(otherSave.id);
    } finally {
      await prisma.libraryTrack.deleteMany({ where: { catalogTrackId: trackId } });
      await prisma.user.delete({ where: { id: otherUserId } });
    }
  });

  it('keeps marketplace player actions disabled when listings are not publicly purchasable', async () => {
    const releaseId = `${TEST_PREFIX}player_actions_no_listing_release`;
    const trackId = `${TEST_PREFIX}player_actions_no_listing_track`;

    await prisma.release.create({
      data: {
        id: releaseId,
        artistId: `${TEST_PREFIX}artist`,
        title: 'No Public Listing Release',
        status: 'published',
        type: 'single',
        primaryArtist: 'TC Test Artist',
        tracks: {
          create: {
            id: trackId,
            title: 'No Listing Track',
            processingStatus: 'complete',
            stems: {
              create: {
                id: `${TEST_PREFIX}player_actions_no_listing_stem`,
                type: 'master',
                uri: 'gs://bucket/no-listing.mp3',
                storageProvider: 'gcs',
              },
            },
          },
        },
      },
    });

    const result = await catalog.getPlayerTrackActions(trackId);

    expect(result).not.toBeNull();
    expect(result!.actions.find((action) => action.key === 'buy_license')).toMatchObject({
      status: 'disabled',
      reason: 'No active stem license is available.',
    });
    expect(result!.actions.find((action) => action.key === 'shows_campaign')).toMatchObject({
      status: 'disabled',
      reason: 'No live campaign for this artist right now.',
    });
  });

  it('links the player Support a show action to the artist active campaign', async () => {
    const artistId = `${TEST_PREFIX}player_actions_show_artist`;
    const releaseId = `${TEST_PREFIX}player_actions_show_release`;
    const trackId = `${TEST_PREFIX}player_actions_show_track`;
    const campaignId = `${TEST_PREFIX}player_actions_show_campaign`;

    await prisma.artist.create({
      data: {
        id: artistId,
        displayName: 'Player Shows Artist',
        payoutAddress: '0x' + 'E'.repeat(40),
      },
    });
    await prisma.release.create({
      data: {
        id: releaseId,
        artistId,
        title: 'Player Shows Release',
        status: 'published',
        type: 'single',
        primaryArtist: 'Player Shows Artist',
        tracks: {
          create: {
            id: trackId,
            title: 'Player Shows Track',
            processingStatus: 'complete',
          },
        },
      },
    });
    await prisma.showCampaign.create({
      data: {
        id: campaignId,
        slug: `${TEST_PREFIX}player-shows-montreal`,
        artistId,
        artistDisplayName: 'Player Shows Artist',
        title: 'Player Shows Artist',
        city: 'Montreal',
        country: 'CA',
        deadline: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        goalAmountUnits: '1000',
        raisedAmountUnits: '780',
        confirmedPledgeCount: 12,
        chainId: 84532,
        status: 'active',
        artistAuthorityStatus: 'artist_authorized',
        contractAddress: `0x${'C'.repeat(40)}`,
        contractCampaignId: '1',
      },
    });

    const result = await catalog.getPlayerTrackActions(trackId);
    const showAction = result!.actions.find((action) => action.key === 'shows_campaign');

    expect(showAction).toMatchObject({
      status: 'available',
      href: `/shows/${TEST_PREFIX}player-shows-montreal`,
      metadata: expect.objectContaining({
        campaignId,
        slug: `${TEST_PREFIX}player-shows-montreal`,
        title: 'Player Shows Artist',
        city: 'Montreal',
        progressPct: 78,
        backerCount: 12,
      }),
    });
  });

  // #1379 regression: campaigns link to the public catalog artist credit,
  // which can be a different Artist row than the uploader-profile
  // release.artistId (the exact staging shape that left the chip disabled).
  it('links Support a show through the release artist credit, not just release.artistId', async () => {
    const uploaderArtistId = `${TEST_PREFIX}player_actions_credit_uploader`;
    const publicArtistId = `${TEST_PREFIX}player_actions_credit_public`;
    const releaseId = `${TEST_PREFIX}player_actions_credit_release`;
    const trackId = `${TEST_PREFIX}player_actions_credit_track`;
    const campaignId = `${TEST_PREFIX}player_actions_credit_campaign`;

    await prisma.artist.create({
      data: {
        id: uploaderArtistId,
        displayName: 'Credit Uploader Profile',
        payoutAddress: '0x' + '9'.repeat(40),
      },
    });
    await prisma.artist.create({
      data: {
        id: publicArtistId,
        displayName: 'Credited Public Artist',
      },
    });
    await prisma.release.create({
      data: {
        id: releaseId,
        artistId: uploaderArtistId,
        title: 'Credited Campaign Release',
        status: 'published',
        type: 'single',
        primaryArtist: 'Credited Public Artist',
        artistCredits: {
          create: {
            artistId: publicArtistId,
            role: 'main',
            displayName: 'Credited Public Artist',
            sortOrder: 0,
          },
        },
        tracks: {
          create: {
            id: trackId,
            title: 'Credited Campaign Track',
            processingStatus: 'complete',
          },
        },
      },
    });
    await prisma.showCampaign.create({
      data: {
        id: campaignId,
        slug: `${TEST_PREFIX}player-shows-credited`,
        artistId: publicArtistId,
        artistDisplayName: 'Credited Public Artist',
        title: 'Credited Public Artist Live',
        city: 'Brooklyn',
        country: 'US',
        deadline: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        goalAmountUnits: '1000',
        raisedAmountUnits: '250',
        confirmedPledgeCount: 3,
        chainId: 84532,
        status: 'active',
        artistAuthorityStatus: 'artist_authorized',
        contractAddress: `0x${'C'.repeat(40)}`,
        contractCampaignId: '1',
      },
    });

    const result = await catalog.getPlayerTrackActions(trackId);
    const showAction = result!.actions.find((action) => action.key === 'shows_campaign');

    expect(showAction).toMatchObject({
      status: 'available',
      href: `/shows/${TEST_PREFIX}player-shows-credited`,
      metadata: expect.objectContaining({
        campaignId,
        title: 'Credited Public Artist Live',
        city: 'Brooklyn',
        progressPct: 25,
        backerCount: 3,
      }),
    });
  });

  it('keeps Support a show disabled when an active credited campaign lacks authority and escrow linkage', async () => {
    const uploaderArtistId = `${TEST_PREFIX}player_actions_unlinked_uploader`;
    const publicArtistId = `${TEST_PREFIX}player_actions_unlinked_public`;
    const releaseId = `${TEST_PREFIX}player_actions_unlinked_release`;
    const trackId = `${TEST_PREFIX}player_actions_unlinked_track`;

    await prisma.artist.create({
      data: {
        id: uploaderArtistId,
        displayName: 'Unlinked Uploader Profile',
        payoutAddress: '0x' + '8'.repeat(40),
      },
    });
    await prisma.artist.create({
      data: {
        id: publicArtistId,
        displayName: 'Unlinked Public Artist',
      },
    });
    await prisma.release.create({
      data: {
        id: releaseId,
        artistId: uploaderArtistId,
        title: 'Unlinked Campaign Release',
        status: 'published',
        type: 'single',
        primaryArtist: 'Unlinked Public Artist',
        artistCredits: {
          create: {
            artistId: publicArtistId,
            role: 'main',
            displayName: 'Unlinked Public Artist',
            sortOrder: 0,
          },
        },
        tracks: {
          create: {
            id: trackId,
            title: 'Unlinked Campaign Track',
            processingStatus: 'complete',
          },
        },
      },
    });
    await prisma.showCampaign.create({
      data: {
        id: `${TEST_PREFIX}player_actions_unlinked_campaign`,
        slug: `${TEST_PREFIX}player-shows-unlinked`,
        artistId: publicArtistId,
        artistDisplayName: 'Unlinked Public Artist',
        title: 'Unlinked Public Artist Live',
        city: 'Chicago',
        country: 'US',
        deadline: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        goalAmountUnits: '1000',
        raisedAmountUnits: '125',
        confirmedPledgeCount: 2,
        chainId: 84532,
        status: 'active',
        artistAuthorityStatus: 'none',
      },
    });

    const result = await catalog.getPlayerTrackActions(trackId);
    const showAction = result!.actions.find((action) => action.key === 'shows_campaign');

    expect(showAction).toMatchObject({
      status: 'disabled',
      reason: 'No live campaign for this artist right now.',
    });
  });

  it('keeps Support a show disabled when the artist campaign is not active', async () => {
    const artistId = `${TEST_PREFIX}player_actions_cancelled_show_artist`;
    const releaseId = `${TEST_PREFIX}player_actions_cancelled_show_release`;
    const trackId = `${TEST_PREFIX}player_actions_cancelled_show_track`;

    await prisma.artist.create({
      data: {
        id: artistId,
        displayName: 'Cancelled Shows Artist',
        payoutAddress: '0x' + 'F'.repeat(40),
      },
    });
    await prisma.release.create({
      data: {
        id: releaseId,
        artistId,
        title: 'Cancelled Shows Release',
        status: 'published',
        type: 'single',
        primaryArtist: 'Cancelled Shows Artist',
        tracks: {
          create: {
            id: trackId,
            title: 'Cancelled Shows Track',
            processingStatus: 'complete',
          },
        },
      },
    });
    await prisma.showCampaign.create({
      data: {
        id: `${TEST_PREFIX}player_actions_cancelled_show_campaign`,
        slug: `${TEST_PREFIX}player-shows-cancelled`,
        artistId,
        artistDisplayName: 'Cancelled Shows Artist',
        title: 'Cancelled Shows Artist',
        city: 'Paris',
        country: 'FR',
        deadline: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        goalAmountUnits: '1000',
        raisedAmountUnits: '500',
        confirmedPledgeCount: 8,
        chainId: 84532,
        status: 'cancelled',
      },
    });

    const result = await catalog.getPlayerTrackActions(trackId);

    expect(result!.actions.find((action) => action.key === 'shows_campaign')).toMatchObject({
      status: 'disabled',
      reason: 'No live campaign for this artist right now.',
    });
  });
});
