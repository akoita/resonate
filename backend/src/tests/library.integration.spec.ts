/**
 * Library Service — Testcontainers Integration Test
 *
 * Verifies library metadata behavior against real Postgres.
 */

import { prisma } from '../db/prisma';
import { LibraryService } from '../modules/library/library.service';

const TEST_PREFIX = `library_${Date.now()}_`;

describe('LibraryService (integration)', () => {
  const service = new LibraryService();
  const userId = `${TEST_PREFIX}user`;
  const artistId = `${TEST_PREFIX}artist`;
  const releaseId = `${TEST_PREFIX}release`;
  const catalogTrackId = `${TEST_PREFIX}catalog_track`;
  const localTrackId = `${TEST_PREFIX}local_track`;
  const staleTrackId = `${TEST_PREFIX}stale_library_track`;
  const staleUrlTrackId = `${TEST_PREFIX}stale_url_library_track`;
  const liveUrlTrackId = `${TEST_PREFIX}live_url_library_track`;

  beforeAll(async () => {
    await prisma.user.create({
      data: { id: userId, email: `${userId}@test.resonate` },
    });
    await prisma.artist.create({
      data: {
        id: artistId,
        userId,
        displayName: 'Library Test Artist',
        payoutAddress: '0x' + 'B'.repeat(40),
      },
    });
    await prisma.release.create({
      data: {
        id: releaseId,
        artistId,
        title: 'Library Test Release',
        status: 'ready',
      },
    });
    await prisma.track.create({
      data: {
        id: catalogTrackId,
        releaseId,
        title: 'Live Catalog Track',
        position: 1,
      },
    });
  });

  afterAll(async () => {
    await prisma.playlist.deleteMany({ where: { userId } });
    await prisma.libraryTrack.deleteMany({ where: { userId } });
    await prisma.track.deleteMany({ where: { id: catalogTrackId } }).catch(() => {});
    await prisma.release.deleteMany({ where: { id: releaseId } }).catch(() => {});
    await prisma.artist.deleteMany({ where: { id: artistId } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: userId } }).catch(() => {});
  });

  it('filters and removes stale remote tracks whose catalog track was deleted', async () => {
    const playlist = await prisma.playlist.create({
      data: {
        userId,
        name: 'Stale Track Playlist',
        trackIds: [staleTrackId, staleUrlTrackId, localTrackId],
      },
    });
    await prisma.libraryTrack.createMany({
      data: [
        {
          id: catalogTrackId,
          userId,
          source: 'remote',
          title: 'Live Catalog Track',
          catalogTrackId,
        },
        {
          id: liveUrlTrackId,
          userId,
          source: 'remote',
          title: 'Live URL Track',
          remoteUrl: `/catalog/releases/${releaseId}/tracks/${catalogTrackId}/stream`,
        },
        {
          id: staleTrackId,
          userId,
          source: 'remote',
          title: 'Deleted Catalog Track',
          catalogTrackId: `${TEST_PREFIX}missing_catalog_track`,
        },
        {
          id: staleUrlTrackId,
          userId,
          source: 'remote',
          title: 'Deleted URL Track',
          remoteUrl: `/catalog/releases/${TEST_PREFIX}missing_release/tracks/${TEST_PREFIX}missing_track/stream`,
        },
        {
          id: localTrackId,
          userId,
          source: 'local',
          title: 'Local Track',
        },
      ],
    });

    const tracks = await service.listTracks(userId);

    expect(tracks.map((track) => track.id)).toEqual(expect.arrayContaining([catalogTrackId, liveUrlTrackId, localTrackId]));
    expect(tracks.map((track) => track.id)).not.toContain(staleTrackId);
    expect(tracks.map((track) => track.id)).not.toContain(staleUrlTrackId);
    expect(await prisma.libraryTrack.findUnique({ where: { id: staleTrackId } })).toBeNull();
    expect(await prisma.libraryTrack.findUnique({ where: { id: staleUrlTrackId } })).toBeNull();
    const updatedPlaylist = await prisma.playlist.findUnique({ where: { id: playlist.id } });
    expect(updatedPlaylist?.trackIds).toEqual([localTrackId]);
  });

  it('keeps per-user rows when two users save the same catalog track (no ownership hijack)', async () => {
    // The frontend saves catalog tracks with `id` = the SHARED catalog track id.
    // A naive upsert-by-id would let the second saver overwrite the first user's
    // row and steal its userId; remote catalog tracks must dedup per-user instead.
    const userId2 = `${TEST_PREFIX}user2`;
    await prisma.user.create({ data: { id: userId2, email: `${userId2}@test.resonate` } });
    const sharedCatalogId = `${TEST_PREFIX}shared_catalog_track`;
    const save = (uid: string, title: string) =>
      service.saveTrack(uid, { id: sharedCatalogId, source: 'remote', title, catalogTrackId: sharedCatalogId });

    try {
      const a = await save(userId, 'Shared Track');
      const b = await save(userId2, 'Shared Track');

      // Distinct per-user rows; neither uses the shared catalog id as its PK.
      expect(a.userId).toBe(userId);
      expect(b.userId).toBe(userId2);
      expect(a.id).not.toBe(b.id);
      expect(a.id).not.toBe(sharedCatalogId);

      // The first user's row is intact and still theirs — not hijacked by user2.
      const aRows = await prisma.libraryTrack.findMany({ where: { userId, catalogTrackId: sharedCatalogId } });
      expect(aRows).toHaveLength(1);
      expect(aRows[0].userId).toBe(userId);

      // Re-saving by the same user updates in place (no duplicate row).
      await save(userId, 'Shared Track v2');
      const aRowsAfter = await prisma.libraryTrack.findMany({ where: { userId, catalogTrackId: sharedCatalogId } });
      expect(aRowsAfter).toHaveLength(1);
      expect(aRowsAfter[0].title).toBe('Shared Track v2');
    } finally {
      await prisma.libraryTrack.deleteMany({ where: { userId: userId2 } });
      await prisma.user.deleteMany({ where: { id: userId2 } });
    }
  });

  it('purges catalog-id playlist references when a remote track is stale', async () => {
    // Post per-user-row fix, LibraryTrack.id is a generated uuid but the frontend
    // adds catalog tracks to playlists by their SHARED catalog id. Stale cleanup
    // must remove both keys from playlist.trackIds, not just the per-user id.
    const missingCatalogId = `${TEST_PREFIX}stale_catalog_for_cleanup`;
    const staleRow = await prisma.libraryTrack.create({
      data: {
        userId,
        source: 'remote',
        title: 'Catalog Track Pending Stale',
        catalogTrackId: missingCatalogId,
      },
    });
    const playlist = await prisma.playlist.create({
      data: {
        userId,
        name: 'Catalog-Id Stale Playlist',
        // Playlist references the SHARED catalog id, not the per-user uuid.
        trackIds: [missingCatalogId],
      },
    });

    try {
      await service.listTracks(userId);

      expect(await prisma.libraryTrack.findUnique({ where: { id: staleRow.id } })).toBeNull();
      const updatedPlaylist = await prisma.playlist.findUnique({ where: { id: playlist.id } });
      expect(updatedPlaylist?.trackIds).toEqual([]);
    } finally {
      await prisma.playlist.deleteMany({ where: { id: playlist.id } });
      await prisma.libraryTrack.deleteMany({ where: { id: staleRow.id } });
    }
  });

  it('resolves and deletes a catalog track via its catalog id (frontend back-compat)', async () => {
    // Some frontend code paths still pass the catalog id when calling
    // getTrack/deleteTrack. After the per-user-row fix, the row's primary key is
    // a generated uuid; lookups must accept catalogTrackId as an alias.
    const aliasCatalogId = `${TEST_PREFIX}alias_catalog_track`;
    const row = await prisma.libraryTrack.create({
      data: {
        userId,
        source: 'remote',
        title: 'Aliased Catalog Track',
        catalogTrackId: aliasCatalogId,
      },
    });

    try {
      const fetched = await service.getTrack(userId, aliasCatalogId);
      expect(fetched.id).toBe(row.id);

      await service.deleteTrack(userId, aliasCatalogId);
      expect(await prisma.libraryTrack.findUnique({ where: { id: row.id } })).toBeNull();
    } finally {
      await prisma.libraryTrack.deleteMany({ where: { id: row.id } });
    }
  });
});
