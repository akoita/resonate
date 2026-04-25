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
});
