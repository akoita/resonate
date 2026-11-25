/**
 * Top-bar search (#2671) against real Postgres: grouped results, and nothing
 * a listener cannot open (withdrawn, unfinished, removed or private).
 */
import { prisma } from "../db/prisma";
import { PlaylistService } from "../modules/playlist/playlist.service";
import { SearchService } from "../modules/search/search.service";

const TEST_PREFIX = `search_${Date.now()}_`;
// A token no other suite's titles contain, so global search results are ours.
const TOKEN = `zq${Date.now().toString(36)}`;
const ownerUser = `${TEST_PREFIX}owner`;
const artistId = `${TEST_PREFIX}artist`;
const hiddenArtistId = `${TEST_PREFIX}hiddenartist`;
const liveRelease = `${TEST_PREFIX}live`;
const withdrawnRelease = `${TEST_PREFIX}withdrawn`;
const draftRelease = `${TEST_PREFIX}draft`;
const liveTrack = `${TEST_PREFIX}livetrk`;
const removedTrack = `${TEST_PREFIX}removedtrk`;
const withdrawnTrack = `${TEST_PREFIX}withdrawntrk`;
const draftTrack = `${TEST_PREFIX}drafttrk`;
const publicPlaylist = `${TEST_PREFIX}publicpl`;
const privatePlaylist = `${TEST_PREFIX}privatepl`;
const deadPlaylist = `${TEST_PREFIX}deadpl`;

describe("top-bar search (#2671)", () => {
  const service = new SearchService(new PlaylistService());

  beforeAll(async () => {
    await prisma.user.create({ data: { id: ownerUser, email: `${ownerUser}@test.resonate` } });
    await prisma.artist.create({ data: { id: artistId, userId: ownerUser, displayName: `Live ${TOKEN} Artist` } });
    // An artist whose only release is withdrawn must not be listed.
    await prisma.artist.create({ data: { id: hiddenArtistId, displayName: `Hidden ${TOKEN} Artist` } });
    await prisma.release.create({
      data: {
        id: liveRelease,
        artistId,
        title: `Live ${TOKEN} Album`,
        status: "published",
        artworkMimeType: "image/png",
        tracks: {
          create: [
            { id: liveTrack, title: `Live ${TOKEN} Song`, position: 1 },
            { id: removedTrack, title: `Removed ${TOKEN} Song`, position: 2, contentStatus: "dmca_removed" },
          ],
        },
      },
    });
    await prisma.release.create({
      data: {
        id: withdrawnRelease,
        artistId: hiddenArtistId,
        title: `Withdrawn ${TOKEN} Album`,
        status: "withdrawn",
        statusBeforeWithdrawal: "published",
        tracks: { create: [{ id: withdrawnTrack, title: `Withdrawn ${TOKEN} Song`, position: 1 }] },
      },
    });
    await prisma.release.create({
      data: {
        id: draftRelease,
        artistId,
        title: `Draft ${TOKEN} Album`,
        status: "processing",
        tracks: { create: [{ id: draftTrack, title: `Draft ${TOKEN} Song`, position: 1 }] },
      },
    });
    const libraryRow = (trackId: string, releaseId: string) => ({
      userId: ownerUser,
      source: "remote",
      title: trackId,
      catalogTrackId: trackId,
      remoteUrl: `/catalog/releases/${releaseId}/tracks/${trackId}/stream`,
    });
    await prisma.libraryTrack.createMany({
      data: [libraryRow(liveTrack, liveRelease), libraryRow(withdrawnTrack, withdrawnRelease)],
    });
    await prisma.playlist.createMany({
      data: [
        { id: publicPlaylist, userId: ownerUser, name: `Public ${TOKEN} Mix`, visibility: "public", trackIds: [liveTrack] },
        { id: privatePlaylist, userId: ownerUser, name: `Private ${TOKEN} Mix`, visibility: "private", trackIds: [liveTrack] },
        { id: deadPlaylist, userId: ownerUser, name: `Dead ${TOKEN} Mix`, visibility: "public", trackIds: [withdrawnTrack] },
      ],
    });
  });

  afterAll(async () => {
    await prisma.playlist.deleteMany({ where: { id: { in: [publicPlaylist, privatePlaylist, deadPlaylist] } } });
    await prisma.libraryTrack.deleteMany({ where: { userId: ownerUser } });
    await prisma.track.deleteMany({ where: { id: { in: [liveTrack, removedTrack, withdrawnTrack, draftTrack] } } });
    await prisma.release.deleteMany({ where: { id: { in: [liveRelease, withdrawnRelease, draftRelease] } } });
    await prisma.artist.deleteMany({ where: { id: { in: [artistId, hiddenArtistId] } } });
    await prisma.user.deleteMany({ where: { id: ownerUser } });
  });

  it("returns each group, and only what a listener can open", async () => {
    const results = await service.search(`  ${TOKEN}  `);
    expect(results.query).toBe(TOKEN);
    expect(results.artists.map((a) => a.id)).toEqual([artistId]);
    expect(results.releases).toEqual([
      expect.objectContaining({ id: liveRelease, artistName: `Live ${TOKEN} Artist`, hasArtwork: true }),
    ]);
    expect(results.tracks).toEqual([
      expect.objectContaining({ id: liveTrack, releaseId: liveRelease, releaseTitle: `Live ${TOKEN} Album` }),
    ]);
    expect(results.playlists.map((p) => p.id)).toEqual([publicPlaylist]);
  });

  it("never shows a withdrawn release or its tracks", async () => {
    const results = await service.search(`Withdrawn ${TOKEN}`);
    expect(results.releases).toEqual([]);
    expect(results.tracks).toEqual([]);
    const byArtist = await service.search(`Hidden ${TOKEN}`);
    expect(byArtist.artists).toEqual([]);
  });

  it("answers nothing for a query that is too short", async () => {
    await expect(service.search("z")).resolves.toEqual({ query: "z", artists: [], releases: [], tracks: [], playlists: [] });
    await expect(service.search(undefined)).resolves.toMatchObject({ query: "", artists: [] });
  });
});
