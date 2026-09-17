/**
 * Release withdrawal (#1793) — Testcontainers Integration Test
 *
 * Withdrawal removes a licence to stream, not a purchase:
 *   - a withdrawn release disappears from discovery and from public streaming;
 *   - a buyer who owns a stem keeps downloading it, unchanged;
 *   - libraries and playlists KEEP their entries, reported as withdrawn;
 *   - restore puts the release back where it was and every reference lights up.
 *
 * Run: npm run test:integration -- release_withdrawal
 */

import request from 'supertest';
import { BadRequestException, ForbiddenException, INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { prisma } from '../db/prisma';
import { CatalogService } from '../modules/catalog/catalog.service';
import { PlaylistService } from '../modules/playlist/playlist.service';
import { LibraryService } from '../modules/library/library.service';
import { EventBus } from '../modules/shared/event_bus';
import { LocalStorageProvider } from '../modules/storage/local_storage_provider';
import { EncryptionService } from '../modules/encryption/encryption.service';
import { EncryptionController } from '../modules/encryption/encryption.controller';
import { AuthService } from '../modules/auth/auth.service';
import { AesEncryptionProvider } from '../modules/encryption/providers/aes_encryption_provider';
import { UploadRightsRoutingService } from '../modules/rights/upload-rights-routing.service';
import { authToken, createControllerTestApp } from './e2e-helpers';

const TEST_PREFIX = `wdr_${Date.now()}_`;
const artistUserId = `${TEST_PREFIX}artist_user`;
const artistId = `${TEST_PREFIX}artist`;
const otherArtistUserId = `${TEST_PREFIX}other_user`;
const otherArtistId = `${TEST_PREFIX}other_artist`;
const listenerId = `${TEST_PREFIX}listener`;
const buyerUserId = `${TEST_PREFIX}buyer`;
const buyerAddress = `0x${'b'.repeat(40)}`;
const releaseId = `${TEST_PREFIX}release`;
const trackId = `${TEST_PREFIX}track`;
const stemId = `${TEST_PREFIX}stem`;
const listingRowId = `${TEST_PREFIX}listing`;

let catalog: CatalogService;
let playlists: PlaylistService;
let library: LibraryService;
let eventBus: EventBus;
let downloadApp: INestApplication;

const mockEncryptionForDownload = {
  providerName: 'aes',
  decrypt: jest.fn(),
  loadSourceBuffer: jest.fn(),
};
const mockAuthService = { isAddressForUser: jest.fn() };

/** Put the release back to a known published state between tests. */
async function republish() {
  await prisma.release.update({
    where: { id: releaseId },
    data: {
      status: 'published',
      statusBeforeWithdrawal: null,
      withdrawnAt: null,
      withdrawalReason: null,
    },
  });
}

describe('Release withdrawal (integration)', () => {
  beforeAll(async () => {
    eventBus = new EventBus();
    const configService = new ConfigService({
      ENCRYPTION_SECRET: process.env.ENCRYPTION_SECRET || 'test-encryption-secret-for-integration',
    });
    const encryption = new EncryptionService(
      new AesEncryptionProvider(configService) as any,
      configService,
    );
    catalog = new CatalogService(
      eventBus,
      encryption as any,
      new LocalStorageProvider(),
      new UploadRightsRoutingService(),
    );
    catalog.onModuleInit();
    playlists = new PlaylistService(eventBus);
    library = new LibraryService();

    downloadApp = await createControllerTestApp(EncryptionController, [
      { provide: EncryptionService, useValue: mockEncryptionForDownload },
      { provide: AuthService, useValue: mockAuthService },
    ]);

    await prisma.user.createMany({
      data: [
        { id: artistUserId, email: `${artistUserId}@test.resonate` },
        { id: otherArtistUserId, email: `${otherArtistUserId}@test.resonate` },
        { id: listenerId, email: `${listenerId}@test.resonate` },
        { id: buyerUserId, email: `${buyerUserId}@test.resonate` },
      ],
    });
    await prisma.artist.createMany({
      data: [
        { id: artistId, userId: artistUserId, displayName: 'Withdrawal Artist' },
        { id: otherArtistId, userId: otherArtistUserId, displayName: 'Other Artist' },
      ],
    });
    await prisma.release.create({
      data: { id: releaseId, artistId, title: 'Withdrawable Album', status: 'published' },
    });
    await prisma.track.create({
      data: { id: trackId, releaseId, title: 'Withdrawable Track', artist: 'Withdrawal Artist' },
    });
    await prisma.stem.create({
      data: {
        id: stemId,
        trackId,
        type: 'original',
        uri: `local://${stemId}.mp3`,
        data: Buffer.from('audio-bytes'),
        mimeType: 'audio/mpeg',
      },
    });

    // A buyer who paid for the stem, recorded exactly as the marketplace does.
    await prisma.stemListing.create({
      data: {
        id: listingRowId,
        listingId: BigInt(1),
        stemId,
        tokenId: BigInt(1),
        chainId: 31337,
        contractAddress: `0x${'c'.repeat(40)}`,
        sellerAddress: `0x${'a'.repeat(40)}`,
        pricePerUnit: '1000',
        amount: BigInt(1),
        paymentToken: `0x${'0'.repeat(40)}`,
        expiresAt: new Date(Date.now() + 86_400_000),
        transactionHash: `0x${TEST_PREFIX}listing`,
        blockNumber: BigInt(1),
        listedAt: new Date(),
      },
    });
    await prisma.stemPurchase.create({
      data: {
        id: `${TEST_PREFIX}purchase`,
        listingId: listingRowId,
        buyerAddress: buyerAddress.toLowerCase(),
        amount: BigInt(1),
        totalPaid: '1000',
        royaltyPaid: '0',
        protocolFeePaid: '0',
        sellerReceived: '1000',
        transactionHash: `0x${TEST_PREFIX}purchase`,
        blockNumber: BigInt(2),
        purchasedAt: new Date(),
      },
    });
  });

  afterAll(async () => {
    await downloadApp?.close();
    await prisma.savedPlaylist.deleteMany({ where: { userId: { startsWith: TEST_PREFIX } } }).catch(() => {});
    await prisma.playlist.deleteMany({ where: { userId: { startsWith: TEST_PREFIX } } });
    await prisma.libraryTrack.deleteMany({ where: { userId: { startsWith: TEST_PREFIX } } });
    await prisma.stemPurchase.deleteMany({ where: { listingId: listingRowId } });
    await prisma.stemListing.deleteMany({ where: { id: listingRowId } });
    await prisma.stem.deleteMany({ where: { track: { release: { artistId: { startsWith: TEST_PREFIX } } } } });
    await prisma.track.deleteMany({ where: { release: { artistId: { startsWith: TEST_PREFIX } } } });
    await prisma.release.deleteMany({ where: { artistId: { startsWith: TEST_PREFIX } } });
    await prisma.artist.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.user.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    eventBus.destroy();
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    mockAuthService.isAddressForUser.mockResolvedValue(true);
    mockEncryptionForDownload.loadSourceBuffer.mockResolvedValue(Buffer.from('audio-bytes'));
    await republish();
  });

  it('withdraws a published release from discovery and from public streaming', async () => {
    expect(await catalog.getTrackStream(trackId)).not.toBeNull();
    const publishedBefore = await catalog.listPublished(100);
    expect(publishedBefore.some((release: any) => release.id === releaseId)).toBe(true);

    const state = await catalog.withdrawRelease(releaseId, artistUserId, {
      reason: 'Sample cleared for a limited window only.',
    });

    expect(state).toMatchObject({
      releaseId,
      status: 'withdrawn',
      statusBeforeWithdrawal: 'published',
      withdrawalReason: 'Sample cleared for a limited window only.',
      alreadyInState: false,
    });
    expect(state.withdrawnAt).toBeInstanceOf(Date);

    // Public stream is gone; discovery no longer lists it.
    expect(await catalog.getTrackStream(trackId)).toBeNull();
    const publishedAfter = await catalog.listPublished(100);
    expect(publishedAfter.some((release: any) => release.id === releaseId)).toBe(false);

    // The artist can still play their own withdrawn release to decide about it.
    const ownerStream = await catalog.getTrackStreamForUser(releaseId, trackId, artistUserId);
    expect(ownerStream?.data.length).toBeGreaterThan(0);
  });

  it('closes the public stem blob door, without closing it on the app itself', async () => {
    // `GET /catalog/stems/:id/blob` is unauthenticated and serves the whole
    // stem. Gating only `getTrackStream` would leave a withdrawal anyone could
    // step around with a URL, so this asserts the side door specifically —
    // it is invisible from the player, which uses the stream route.
    expect(await catalog.getStemBlob(stemId)).not.toBeNull();

    await catalog.withdrawRelease(releaseId, artistUserId, { reason: 'Pulled from streaming' });

    // What the public controller route passes: a range, and nothing else.
    expect(await catalog.getStemBlob(stemId, {})).toBeNull();

    // What every internal caller passes. Ingestion, stem-quality analysis and
    // the artist's own playback must keep working through a withdrawal.
    const internal = await catalog.getStemBlob(stemId, { includeRestricted: true });
    expect(internal?.data.length).toBeGreaterThan(0);

    // And it comes back on restore, like everything else.
    await catalog.restoreRelease(releaseId, artistUserId);
    expect(await catalog.getStemBlob(stemId, {})).not.toBeNull();
  });

  it('keeps a buyer downloading the stem they purchased after withdrawal', async () => {
    await catalog.withdrawRelease(releaseId, artistUserId, { reason: 'Pulled from streaming' });

    const response = await request(downloadApp.getHttpServer())
      .post('/encryption/download')
      .set('Authorization', `Bearer ${authToken(buyerUserId)}`)
      .send({ stemId, walletAddress: buyerAddress })
      // 201 is Nest's default for POST; the download path is untouched by #1793.
      .expect(201);

    expect(response.headers['content-disposition']).toContain('attachment');
    expect(mockEncryptionForDownload.loadSourceBuffer).toHaveBeenCalledWith(`local://${stemId}.mp3`);
    // The purchase itself is untouched by withdrawal.
    const purchase = await prisma.stemPurchase.findFirst({
      where: { buyerAddress: buyerAddress.toLowerCase(), listing: { stem: { id: stemId } } },
    });
    expect(purchase).not.toBeNull();
  });

  it('is idempotent: withdrawing an already-withdrawn release is a no-op, not an error', async () => {
    const first = await catalog.withdrawRelease(releaseId, artistUserId, { reason: 'First call' });
    const second = await catalog.withdrawRelease(releaseId, artistUserId, { reason: 'Second call' });

    expect(second.status).toBe('withdrawn');
    expect(second.alreadyInState).toBe(true);
    expect(second.withdrawalReason).toBe('First call');
    expect(second.withdrawnAt?.toISOString()).toBe(first.withdrawnAt?.toISOString());
    expect(second.statusBeforeWithdrawal).toBe('published');
  });

  it('restores a release to published — where it came from — not to ready', async () => {
    await catalog.withdrawRelease(releaseId, artistUserId, {});
    const restored = await catalog.restoreRelease(releaseId, artistUserId);

    expect(restored).toMatchObject({
      releaseId,
      status: 'published',
      statusBeforeWithdrawal: null,
      withdrawnAt: null,
      withdrawalReason: null,
    });
    expect(await catalog.getTrackStream(trackId)).not.toBeNull();

    // A release withdrawn from "ready" comes back to "ready".
    await prisma.release.update({ where: { id: releaseId }, data: { status: 'ready' } });
    await catalog.withdrawRelease(releaseId, artistUserId, {});
    expect((await catalog.restoreRelease(releaseId, artistUserId)).status).toBe('ready');

    // A row whose origin was never recorded falls back to "ready".
    await prisma.release.update({
      where: { id: releaseId },
      data: { status: 'withdrawn', statusBeforeWithdrawal: null },
    });
    expect((await catalog.restoreRelease(releaseId, artistUserId)).status).toBe('ready');
  });

  it('refuses withdrawal and restore from the wrong lifecycle state or the wrong artist', async () => {
    await expect(catalog.restoreRelease(releaseId, artistUserId)).rejects.toBeInstanceOf(BadRequestException);

    await prisma.release.update({ where: { id: releaseId }, data: { status: 'processing' } });
    await expect(catalog.withdrawRelease(releaseId, artistUserId, {})).rejects.toBeInstanceOf(BadRequestException);
    await republish();

    // Ownership comes from the authenticated user, never from the request.
    await expect(catalog.withdrawRelease(releaseId, otherArtistUserId, {})).rejects.toBeInstanceOf(ForbiddenException);
    await catalog.withdrawRelease(releaseId, artistUserId, {});
    await expect(catalog.restoreRelease(releaseId, otherArtistUserId)).rejects.toBeInstanceOf(ForbiddenException);
    expect((await prisma.release.findUniqueOrThrow({ where: { id: releaseId } })).status).toBe('withdrawn');
  });

  it('saves a playlist containing a withdrawn track and reads it back, present and marked withdrawn', async () => {
    await catalog.withdrawRelease(releaseId, artistUserId, { reason: 'Rights review' });

    const playlist = await playlists.createPlaylist(listenerId, {
      name: 'Still mine',
      trackIds: [trackId],
      queueContext: {
        origin: 'player_queue',
        sourceKind: 'ad_hoc',
        queueCount: 1,
        omittedCount: 0,
      },
    });
    expect(playlist.trackIds).toEqual([trackId]);

    await playlists.updatePlaylist(listenerId, playlist.id, { visibility: 'public' });
    const view = await playlists.getPublicPlaylist(playlist.id, listenerId);
    expect(view.tracks).toHaveLength(1);
    expect(view.tracks[0]).toMatchObject({
      catalogTrackId: trackId,
      playable: false,
      availability: { state: 'withdrawn', reason: 'Rights review' },
    });
    expect(view.playableTrackCount).toBe(0);

    const owned = await playlists.getPlaylist(listenerId, playlist.id);
    expect(owned.trackAvailability[trackId]).toMatchObject({ state: 'withdrawn' });
    const listed = await playlists.listPlaylists(listenerId);
    expect(listed.find((entry) => entry.id === playlist.id)?.trackAvailability[trackId]).toMatchObject({
      state: 'withdrawn',
    });

    // Restoring lights the same entry back up — nothing was repointed.
    await catalog.restoreRelease(releaseId, artistUserId);
    const afterRestore = await playlists.getPublicPlaylist(playlist.id, listenerId);
    expect(afterRestore.tracks[0]).toMatchObject({
      playable: true,
      availability: { state: 'available' },
    });
    expect(afterRestore.playableTrackCount).toBe(1);

    await prisma.playlist.delete({ where: { id: playlist.id } });
  });

  it('still rejects a playlist write for an id that resolves to nothing', async () => {
    await expect(
      playlists.createPlaylist(listenerId, {
        name: 'Bad ids',
        trackIds: [trackId, `${TEST_PREFIX}ghost`],
        queueContext: { origin: 'player_queue', sourceKind: 'ad_hoc', queueCount: 2, omittedCount: 0 },
      }),
    ).rejects.toThrow('no longer available');
    expect(await prisma.playlist.count({ where: { userId: listenerId, name: 'Bad ids' } })).toBe(0);
  });

  it('keeps a library row through withdrawal and marks it unavailable', async () => {
    await library.saveTrack(listenerId, {
      source: 'remote',
      title: 'Withdrawable Track',
      catalogTrackId: trackId,
      remoteUrl: `/catalog/releases/${releaseId}/tracks/${trackId}/stream`,
      remoteArtworkUrl: `/catalog/releases/${releaseId}/artwork`,
    });

    await catalog.withdrawRelease(releaseId, artistUserId, { reason: 'Taken down for now' });

    const tracks = await library.listTracks(listenerId);
    const saved = tracks.find((track: any) => track.catalogTrackId === trackId);
    expect(saved).toBeDefined();
    expect(saved!.availability).toMatchObject({
      state: 'withdrawn',
      reason: 'Taken down for now',
    });
    // The row itself survives in the database: nothing was deleted.
    expect(
      await prisma.libraryTrack.count({ where: { userId: listenerId, catalogTrackId: trackId } }),
    ).toBe(1);

    await catalog.restoreRelease(releaseId, artistUserId);
    const afterRestore = await library.listTracks(listenerId);
    expect(
      afterRestore.find((track: any) => track.catalogTrackId === trackId)!.availability,
    ).toEqual({ state: 'available' });

    await prisma.libraryTrack.deleteMany({ where: { userId: listenerId } });
  });
});
