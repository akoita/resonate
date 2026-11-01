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
  const creditedArtistId = `${TEST_PREFIX}credited_artist`;
  const releaseId = `${TEST_PREFIX}release`;
  const catalogTrackId = `${TEST_PREFIX}catalog_track`;
  const localTrackId = `${TEST_PREFIX}local_track`;
  const staleTrackId = `${TEST_PREFIX}stale_library_track`;
  const staleUrlTrackId = `${TEST_PREFIX}stale_url_library_track`;
  const liveUrlTrackId = `${TEST_PREFIX}live_url_library_track`;

  it('persists batch removal for one listener without deleting another listener’s copy', async () => {
    const otherUserId = `${TEST_PREFIX}other_user`;
    const removedIds = [`${TEST_PREFIX}remove_1`, `${TEST_PREFIX}remove_2`];
    await prisma.user.create({ data: { id: otherUserId, email: `${otherUserId}@test.resonate` } });
    try {
      await prisma.libraryTrack.createMany({
        data: [
          ...removedIds.map(id => ({ id, userId, source: 'local', title: id })),
          { id: `${TEST_PREFIX}other_copy`, userId: otherUserId, source: 'local', title: 'Other listener copy' },
        ],
      });

      await expect(service.deleteTracks(userId, [...removedIds, `${TEST_PREFIX}other_copy`])).resolves.toMatchObject({ count: 2 });
      const remaining = await service.listTracks(userId);
      for (const id of removedIds) expect(remaining.map(track => track.id)).not.toContain(id);
      expect(await prisma.libraryTrack.findUnique({ where: { id: `${TEST_PREFIX}other_copy` } })).not.toBeNull();
    } finally {
      await prisma.libraryTrack.deleteMany({ where: { userId: { in: [userId, otherUserId] }, id: { startsWith: `${TEST_PREFIX}remove_` } } });
      await prisma.libraryTrack.deleteMany({ where: { userId: otherUserId } });
      await prisma.user.delete({ where: { id: otherUserId } });
    }
  });

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
    await prisma.artist.create({
      data: {
        id: creditedArtistId,
        displayName: 'Credited Library Artist',
        payoutAddress: '0x' + 'C'.repeat(40),
      },
    });
    await prisma.release.create({
      data: {
        id: releaseId,
        artistId,
        title: 'Library Test Release',
        status: 'ready',
        primaryArtist: 'Credited Library Artist',
      },
    });
    await prisma.releaseArtistCredit.create({
      data: {
        releaseId,
        artistId: creditedArtistId,
        role: 'primary',
        displayName: 'Credited Library Artist',
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
    await prisma.artist.deleteMany({ where: { id: { in: [artistId, creditedArtistId] } } }).catch(() => {});
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
    expect(tracks.find((track) => track.catalogTrackId === catalogTrackId)).toMatchObject({
      releaseId,
      creditedArtistId,
      creditedArtistName: 'Credited Library Artist',
    });
    expect(await prisma.libraryTrack.findUnique({ where: { id: staleTrackId } })).toBeNull();
    expect(await prisma.libraryTrack.findUnique({ where: { id: staleUrlTrackId } })).toBeNull();
    const updatedPlaylist = await prisma.playlist.findUnique({ where: { id: playlist.id } });
    expect(updatedPlaylist?.trackIds).toEqual([localTrackId]);
  });

  it('keeps an ambiguous catalog credit name without asserting a profile ID', async () => {
    await prisma.releaseArtistCredit.updateMany({
      where: { releaseId, artistId: creditedArtistId },
      data: { identityStatus: 'ambiguous' },
    });
    try {
      const tracks = await service.listTracks(userId);
      expect(tracks.find((track) => track.catalogTrackId === catalogTrackId)).toMatchObject({
        creditedArtistId: null,
        creditedArtistName: 'Credited Library Artist',
      });
    } finally {
      await prisma.releaseArtistCredit.updateMany({
        where: { releaseId, artistId: creditedArtistId },
        data: { identityStatus: 'inferred' },
      });
    }
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

  describe('local vs. catalog boundary (#2505)', () => {
    const otherUserId = `${TEST_PREFIX}boundary_other`;

    beforeAll(async () => {
      await prisma.user.create({ data: { id: otherUserId, email: `${otherUserId}@test.resonate` } });
    });

    afterAll(async () => {
      await prisma.libraryTrack.deleteMany({ where: { userId: { in: [otherUserId] } } });
      await prisma.libraryTrack.deleteMany({ where: { userId, clientKey: { startsWith: 'local_boundary' } } });
      await prisma.libraryTrack.deleteMany({ where: { userId, clientKey: { startsWith: `${TEST_PREFIX}stem` } } });
      await prisma.user.deleteMany({ where: { id: otherUserId } });
    });

    it('never lets a save reach a row another listener owns', async () => {
      const victim = await service.saveTrack(otherUserId, {
        id: 'local_boundary_victim', source: 'local', title: 'Voice memo', sourcePath: 'memo.m4a', fileSize: 42,
      });
      expect(victim.id).toBe('local_boundary_victim');
      const victimRow = await prisma.libraryTrack.findFirstOrThrow({ where: { userId: otherUserId, clientKey: 'local_boundary_victim' } });

      // Same client id, and even the victim's real row id: both stay per-user.
      await service.saveTrack(userId, { id: 'local_boundary_victim', source: 'local', title: 'Mine' });
      await expect(
        service.saveTrack(userId, { id: victimRow.id, source: 'remote', title: 'x', stemType: 'vocals' }),
      ).rejects.toThrow('catalog reference');

      const after = await prisma.libraryTrack.findUniqueOrThrow({ where: { id: victimRow.id } });
      expect(after.userId).toBe(otherUserId);
      expect(after.title).toBe('Voice memo');
      expect(await prisma.libraryTrack.count({ where: { userId, clientKey: 'local_boundary_victim' } })).toBe(1);
    });

    it('lets two listeners keep the same owned stem', async () => {
      const stemId = `${TEST_PREFIX}stem_shared`;
      const stem = { id: stemId, source: 'remote', title: 'Vocals', stemType: 'vocals', isOwned: true,
        previewUrl: `/catalog/stems/${stemId}/preview` };
      const a = await service.saveTrack(userId, stem);
      const b = await service.saveTrack(otherUserId, stem);
      expect(a.id).toBe(stemId);
      expect(b.id).toBe(stemId);
      expect(await prisma.libraryTrack.count({ where: { clientKey: stemId } })).toBe(2);
      expect((await service.getTrack(userId, stemId)).userId).toBe(userId);
    });

    it('rejects a local file that carries catalog fields', async () => {
      await expect(service.saveTrack(userId, {
        id: 'local_boundary_forged', source: 'local', title: 'Forged', catalogTrackId,
      })).rejects.toThrow('catalogTrackId');
      await expect(service.saveTrack(userId, {
        id: 'local_boundary_forged', source: 'local', title: 'Forged',
        remoteUrl: `/catalog/releases/${releaseId}/tracks/${catalogTrackId}/stream`,
      })).rejects.toThrow('remoteUrl');
      await expect(service.saveTrack(userId, {
        id: 'local_boundary_forged', source: 'local', title: 'Forged', isOwned: true,
      })).rejects.toThrow('isOwned');
    });

    it('rejects a catalog row without a catalog reference or with local fields', async () => {
      await expect(service.saveTrack(userId, { source: 'remote', title: 'Nothing' })).rejects.toThrow('catalog reference');
      await expect(service.saveTrack(userId, {
        source: 'remote', title: 'Mixed', catalogTrackId, sourcePath: 'a.mp3', fileSize: 1,
      })).rejects.toThrow('local file fields');
      await expect(service.saveTrack(userId, { title: 'No source' } as any)).rejects.toThrow('source');
    });

    it('requires local ids to use the local_ namespace', async () => {
      await expect(service.saveTrack(userId, { id: catalogTrackId, source: 'local', title: 'Clash' }))
        .rejects.toThrow('local_');
    });

    it('reuses the row when the same file comes back under a new id', async () => {
      const first = await service.saveTrack(userId, {
        id: 'local_boundary_file_a', source: 'local', title: 'Song', sourcePath: 'Music/song.mp3', fileSize: 777,
      });
      const second = await service.saveTrack(userId, {
        id: 'local_boundary_file_b', source: 'local', title: 'Song', sourcePath: 'Music/song.mp3', fileSize: 777,
      });
      expect(second.id).toBe(first.id);
      expect(await prisma.libraryTrack.count({ where: { userId, sourcePath: 'Music/song.mp3', fileSize: 777 } })).toBe(1);
    });

    it('reports a local file as local even if an old row carries catalog fields', async () => {
      await prisma.libraryTrack.create({
        data: { userId, source: 'local', clientKey: 'local_boundary_legacy', title: 'Legacy', catalogTrackId: `${TEST_PREFIX}legacy_ref` },
      });
      const row = (await service.listTracks(userId)).find((t: any) => t.id === 'local_boundary_legacy');
      expect(row?.availability).toEqual({ state: 'unavailable', reason: 'local_file' });
    });
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
