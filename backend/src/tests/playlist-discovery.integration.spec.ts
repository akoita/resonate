/**
 * Public Playlist Discovery — Integration Test (Testcontainers)
 *
 * Covers PlaylistService.listPublicPlaylists, which powers the global-catalog
 * "Playlists" tab: visibility filtering, the playable-track gate (no dead-end
 * playlists in discovery), cover-mosaic resolution + dedup, counts, ordering by
 * recency, and the requested-limit cap.
 *
 * Run: npm run test:integration
 */

import { prisma } from '../db/prisma';
import { PlaylistService } from '../modules/playlist/playlist.service';

const TEST_PREFIX = `pldisc_${Date.now()}_`;
const owner = `${TEST_PREFIX}owner`;
const artistId = `${TEST_PREFIX}artist`;

let service: PlaylistService;

/** Create a catalog-backed (streamable) library track for the owner with a given release id. */
async function remoteTrack(releaseId: string, label: string) {
  const ctid = `${TEST_PREFIX}ct_${label}`;
  const track = await prisma.libraryTrack.create({
    data: {
      userId: owner,
      source: 'remote',
      title: `Catalog ${label}`,
      artist: 'Disco Curator',
      duration: 200,
      catalogTrackId: ctid,
      remoteUrl: `/catalog/releases/${releaseId}/tracks/${ctid}/stream`,
      remoteArtworkUrl: `/catalog/releases/${releaseId}/artwork`,
    },
  });
  return track.id;
}

/** Create a device-only library track (visible to the owner, not streamable by others). */
async function localTrack(label: string) {
  const track = await prisma.libraryTrack.create({
    data: {
      userId: owner,
      source: 'local',
      title: `Device ${label}`,
      artist: 'Disco Curator',
      duration: 100,
      sourcePath: `/music/${TEST_PREFIX}${label}.mp3`,
      fileSize: 4096,
    },
  });
  return track.id;
}

describe('PlaylistService — public playlist discovery (integration)', () => {
  let pubA: string;
  let pubDedup: string;
  let priv: string;
  let pubLocalOnly: string;
  let pubEmpty: string;
  let pubSingle: string;

  beforeAll(async () => {
    service = new PlaylistService();

    await prisma.user.create({ data: { id: owner, email: `${owner}@test.resonate` } });
    await prisma.artist.create({
      data: {
        id: artistId,
        userId: owner,
        displayName: 'Disco Curator',
        payoutAddress: '0x' + 'D'.repeat(40),
      },
    });

    const r1 = await remoteTrack(`${TEST_PREFIX}rel1`, 'r1');
    const r2 = await remoteTrack(`${TEST_PREFIX}rel2`, 'r2');
    const r2b = await remoteTrack(`${TEST_PREFIX}rel2`, 'r2b'); // same release as r2 → same artwork
    const r3 = await remoteTrack(`${TEST_PREFIX}rel3`, 'r3');
    const r4 = await remoteTrack(`${TEST_PREFIX}rel4`, 'r4');
    const r5 = await remoteTrack(`${TEST_PREFIX}rel5`, 'r5');
    const loc = await localTrack('loc');

    // Created oldest → newest; updatedAt mirrors creation order for ordering checks.
    pubA = (await makePublic({ name: 'Big Mix', trackIds: [r1, r2, r3, r4, r5, loc] })).id;
    pubDedup = (await makePublic({ name: 'Same Album', trackIds: [r2, r2b] })).id;
    priv = (await service.createPlaylist(owner, { name: 'Secret', trackIds: [r1, r2] })).id;
    pubLocalOnly = (await makePublic({ name: 'Device Only', trackIds: [loc] })).id;
    pubEmpty = (await makePublic({ name: 'Empty', trackIds: [] })).id;
    pubSingle = (await makePublic({ name: 'One Track', trackIds: [r1] })).id;
  });

  afterAll(async () => {
    await prisma.playlist.deleteMany({ where: { userId: owner } }).catch(() => {});
    await prisma.libraryTrack.deleteMany({ where: { userId: owner } }).catch(() => {});
    await prisma.artist.delete({ where: { id: artistId } }).catch(() => {});
    await prisma.user.delete({ where: { id: owner } }).catch(() => {});
  });

  async function makePublic(data: { name: string; trackIds: string[] }) {
    const pl = await service.createPlaylist(owner, data);
    await service.updatePlaylist(owner, pl.id, { visibility: 'public' });
    return pl;
  }

  /** Only this suite's playlists — the discovery feed is global, so filter by owner. */
  async function ownPublicPlaylists(limit?: number) {
    const all = await service.listPublicPlaylists(limit === undefined ? undefined : { limit });
    return all.filter((p) => p.ownerUserId === owner);
  }

  it('surfaces only public playlists that have at least one playable track', async () => {
    const mine = await ownPublicPlaylists(100);
    const ids = mine.map((p) => p.id);

    expect(ids).toContain(pubA);
    expect(ids).toContain(pubDedup);
    expect(ids).toContain(pubSingle);

    // Private, all-local, and empty public playlists are never dead-ends in discovery.
    expect(ids).not.toContain(priv);
    expect(ids).not.toContain(pubLocalOnly);
    expect(ids).not.toContain(pubEmpty);
  });

  it('reports counts and the curator name, excluding non-resolvable tracks from playable count', async () => {
    const mine = await ownPublicPlaylists(100);
    const big = mine.find((p) => p.id === pubA)!;

    expect(big.name).toBe('Big Mix');
    expect(big.ownerDisplayName).toBe('Disco Curator');
    expect(big.trackCount).toBe(6); // 5 catalog + 1 local, all still in the owner's library
    expect(big.playableTrackCount).toBe(5); // local file is not streamable by others
  });

  it('builds a cover mosaic of up to 4 distinct artworks from playable tracks', async () => {
    const mine = await ownPublicPlaylists(100);
    const big = mine.find((p) => p.id === pubA)!;

    expect(big.coverArtworkPaths).toHaveLength(4);
    expect(new Set(big.coverArtworkPaths).size).toBe(4); // distinct
    for (const path of big.coverArtworkPaths) {
      expect(path).toMatch(/\/catalog\/releases\/.+\/artwork/);
    }
  });

  it('dedupes covers drawn from the same release', async () => {
    const mine = await ownPublicPlaylists(100);
    const dedup = mine.find((p) => p.id === pubDedup)!;

    expect(dedup.playableTrackCount).toBe(2);
    expect(dedup.coverArtworkPaths).toHaveLength(1); // both tracks share one release artwork
  });

  it('returns a single cover for a one-track playlist', async () => {
    const mine = await ownPublicPlaylists(100);
    const single = mine.find((p) => p.id === pubSingle)!;
    expect(single.coverArtworkPaths).toHaveLength(1);
  });

  it('orders the feed most-recently-updated first', async () => {
    const mine = await ownPublicPlaylists(100);
    const order = mine.map((p) => p.id);
    // pubSingle was created last, pubA first.
    expect(order.indexOf(pubSingle)).toBeLessThan(order.indexOf(pubDedup));
    expect(order.indexOf(pubDedup)).toBeLessThan(order.indexOf(pubA));
  });

  it('never returns more than the requested limit', async () => {
    const limited = await service.listPublicPlaylists({ limit: 2 });
    expect(limited.length).toBeLessThanOrEqual(2);
    for (const p of limited) {
      expect(p.playableTrackCount).toBeGreaterThanOrEqual(1);
    }
  });

  it('matches catalog-id trackIds and scopes resolution to the playlist owner', async () => {
    const cid = `${TEST_PREFIX}disc_cat`;
    const rid = `${TEST_PREFIX}disc_rel`;
    const owner2 = `${TEST_PREFIX}owner2`;
    const artist2 = `${TEST_PREFIX}artist2`;
    await prisma.user.create({ data: { id: owner2, email: `${owner2}@test.resonate` } });
    await prisma.artist.create({
      data: { id: artist2, userId: owner2, displayName: 'Other Curator', payoutAddress: '0x' + 'E'.repeat(40) },
    });
    try {
      // `owner` has the catalog track in their library (per-user uuid id, carries catalogTrackId).
      await prisma.libraryTrack.create({
        data: {
          userId: owner,
          source: 'remote',
          title: 'Disc Catalog',
          artist: 'Disco Curator',
          catalogTrackId: cid,
          remoteUrl: `/catalog/releases/${rid}/tracks/${cid}/stream`,
          remoteArtworkUrl: `/catalog/releases/${rid}/artwork`,
        },
      });

      // owner's public playlist references the CATALOG id → resolves & surfaces.
      const ownerPl = await makePublic({ name: 'Owner By Catalog Id', trackIds: [cid] });
      // owner2's public playlist references the SAME catalog id, but owner2 has no
      // library row for it → must NOT surface (owner-scoped, not another user's row).
      const owner2Pl = await service.createPlaylist(owner2, { name: 'Other By Catalog Id', trackIds: [cid] });
      await service.updatePlaylist(owner2, owner2Pl.id, { visibility: 'public' });

      const all = await service.listPublicPlaylists({ limit: 100 });
      const ownerEntry = all.find((p) => p.id === ownerPl.id);

      expect(ownerEntry).toBeDefined();
      expect(ownerEntry!.playableTrackCount).toBe(1);
      expect(ownerEntry!.coverArtworkPaths[0]).toContain(`/catalog/releases/${rid}/artwork`);
      expect(all.map((p) => p.id)).not.toContain(owner2Pl.id);
    } finally {
      await prisma.playlist.deleteMany({ where: { userId: owner2 } });
      await prisma.libraryTrack.deleteMany({ where: { userId: owner2 } });
      await prisma.artist.deleteMany({ where: { id: artist2 } });
      await prisma.user.deleteMany({ where: { id: owner2 } });
    }
  });
});
