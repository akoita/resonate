/**
 * Public Playlists — Integration Test (Testcontainers)
 *
 * Covers visibility access control, server-side track resolution for non-owners,
 * saved (followed) playlists with live re-resolution, and the domain events.
 *
 * Run: npm run test:integration
 */

import { prisma } from '../db/prisma';
import { PlaylistService } from '../modules/playlist/playlist.service';
import { EventBus } from '../modules/shared/event_bus';
import type { ResonateEvent } from '../events/event_types';

const TEST_PREFIX = `plpub_${Date.now()}_`;
const owner = `${TEST_PREFIX}owner`;
const viewer = `${TEST_PREFIX}viewer`;
const artistId = `${TEST_PREFIX}artist`;
const releaseId = `${TEST_PREFIX}release`;
const catalogTrackId = `${TEST_PREFIX}ctrack`;

let service: PlaylistService;
let eventBus: EventBus;
let events: ResonateEvent[];

let seedCount = 0;

/** Seed a catalog-backed (streamable) and a local-only (non-streamable) library track for the owner.
 *  Ids are unique per call so repeated seeding does not hit LibraryTrack unique constraints. */
async function seedOwnerLibrary() {
  seedCount += 1;
  const rid = `${releaseId}_${seedCount}`;
  const ctid = `${catalogTrackId}_${seedCount}`;
  const remote = await prisma.libraryTrack.create({
    data: {
      userId: owner,
      source: 'remote',
      title: 'Catalog Anthem',
      artist: 'The Owner',
      album: 'Shared Sounds',
      duration: 210,
      catalogTrackId: ctid,
      remoteUrl: `/catalog/releases/${rid}/tracks/${ctid}/stream`,
      remoteArtworkUrl: `/catalog/releases/${rid}/artwork`,
    },
  });
  const local = await prisma.libraryTrack.create({
    data: {
      userId: owner,
      source: 'local',
      title: 'Device Demo',
      artist: 'The Owner',
      duration: 120,
      sourcePath: `/music/demo_${seedCount}.mp3`,
      fileSize: 4096,
    },
  });
  return { remoteId: remote.id, localId: local.id, releaseId: rid, catalogTrackId: ctid };
}

describe('PlaylistService — public playlists (integration)', () => {
  beforeAll(async () => {
    eventBus = new EventBus();
    events = [];
    eventBus.subscribe('playlist.visibility_changed', (e) => events.push(e));
    eventBus.subscribe('playlist.saved_to_library', (e) => events.push(e));
    eventBus.subscribe('playlist.removed_from_library', (e) => events.push(e));
    service = new PlaylistService(eventBus);

    await prisma.user.create({ data: { id: owner, email: `${owner}@test.resonate` } });
    await prisma.user.create({ data: { id: viewer, email: `${viewer}@test.resonate` } });
    // Owner has an artist profile so the public view exposes a curator name.
    await prisma.artist.create({
      data: {
        id: artistId,
        userId: owner,
        displayName: 'The Owner',
        payoutAddress: '0x' + 'C'.repeat(40),
      },
    });
  });

  afterAll(async () => {
    await prisma.savedPlaylist.deleteMany({ where: { userId: { in: [owner, viewer] } } }).catch(() => {});
    await prisma.playlist.deleteMany({ where: { userId: { in: [owner, viewer] } } }).catch(() => {});
    await prisma.libraryTrack.deleteMany({ where: { userId: { in: [owner, viewer] } } }).catch(() => {});
    await prisma.artist.delete({ where: { id: artistId } }).catch(() => {});
    await prisma.user.delete({ where: { id: owner } }).catch(() => {});
    await prisma.user.delete({ where: { id: viewer } }).catch(() => {});
    eventBus.destroy();
  });

  beforeEach(() => {
    events.length = 0;
  });

  it('defaults new playlists to private', async () => {
    const pl = await service.createPlaylist(owner, { name: 'Fresh' });
    expect(pl.visibility).toBe('private');
  });

  it('hides a private playlist from non-owners but lets the owner read it', async () => {
    const pl = await service.createPlaylist(owner, { name: 'Secret' });

    await expect(service.getPublicPlaylist(pl.id, viewer)).rejects.toThrow(/not found/i);
    await expect(service.getPublicPlaylist(pl.id)).rejects.toThrow(/not found/i);

    const ownerView = await service.getPublicPlaylist(pl.id, owner);
    expect(ownerView.isOwner).toBe(true);
    expect(ownerView.visibility).toBe('private');
  });

  it('rejects an invalid visibility value', async () => {
    const pl = await service.createPlaylist(owner, { name: 'Bad visibility' });
    await expect(
      service.updatePlaylist(owner, pl.id, { visibility: 'unlisted' }),
    ).rejects.toThrow(/visibility/i);
  });

  it('emits visibility_changed and resolves catalog tracks for anonymous viewers', async () => {
    const { remoteId, localId, releaseId: rid, catalogTrackId: ctid } = await seedOwnerLibrary();
    const pl = await service.createPlaylist(owner, {
      name: 'Public Mix',
      trackIds: [remoteId, localId],
    });

    const updated = await service.updatePlaylist(owner, pl.id, { visibility: 'public' });
    expect(updated.visibility).toBe('public');
    expect(events.some((e) => e.eventName === 'playlist.visibility_changed')).toBe(true);

    // Anonymous viewer can now read it.
    const view = await service.getPublicPlaylist(pl.id);
    expect(view.visibility).toBe('public');
    expect(view.ownerDisplayName).toBe('The Owner');
    expect(view.trackCount).toBe(2);
    // Catalog track is streamable; local device file is not.
    expect(view.playableTrackCount).toBe(1);

    const remoteTrack = view.tracks.find((t) => t.id === remoteId)!;
    expect(remoteTrack.playable).toBe(true);
    expect(remoteTrack.streamPath).toContain(`/catalog/releases/${rid}/tracks/${ctid}/stream`);
    expect(remoteTrack.artworkPath).toContain(`/catalog/releases/${rid}/artwork`);

    const localTrack = view.tracks.find((t) => t.id === localId)!;
    expect(localTrack.playable).toBe(false);
    expect(localTrack.streamPath).toBeNull();
  });

  it('resolves a catalog track added to a playlist by its catalog id, scoped to the owner', async () => {
    const ctid = `${TEST_PREFIX}cat_byid`;
    const rid = `${TEST_PREFIX}rel_byid`;
    // Owner's library row has a per-user uuid id but carries the catalog track id.
    await prisma.libraryTrack.create({
      data: {
        userId: owner,
        source: 'remote',
        title: 'Added By Catalog Id',
        artist: 'The Owner',
        catalogTrackId: ctid,
        remoteUrl: `/catalog/releases/${rid}/tracks/${ctid}/stream`,
        remoteArtworkUrl: `/catalog/releases/${rid}/artwork`,
      },
    });
    // A different user also saved the same catalog track (their own row).
    await prisma.libraryTrack.create({
      data: { userId: viewer, source: 'remote', title: 'Viewer Copy', catalogTrackId: ctid },
    });

    // The playlist stores the CATALOG id (what the frontend uses for catalog tracks),
    // not the owner's LibraryTrack uuid.
    const pl = await service.createPlaylist(owner, { name: 'By Catalog Id', trackIds: [ctid] });
    await service.updatePlaylist(owner, pl.id, { visibility: 'public' });

    const view = await service.getPublicPlaylist(pl.id);
    expect(view.trackCount).toBe(1); // resolves owner's row only — no cross-user duplicate
    expect(view.playableTrackCount).toBe(1);
    expect(view.tracks[0].streamPath).toContain(`/catalog/releases/${rid}/tracks/${ctid}/stream`);
  });

  it('emits a track only once when a playlist references both its per-user uuid and catalog id', async () => {
    const ctid = `${TEST_PREFIX}dup_cat`;
    const rid = `${TEST_PREFIX}dup_rel`;
    const row = await prisma.libraryTrack.create({
      data: {
        userId: owner,
        source: 'remote',
        title: 'Dup-Keyed Track',
        artist: 'The Owner',
        catalogTrackId: ctid,
        remoteUrl: `/catalog/releases/${rid}/tracks/${ctid}/stream`,
        remoteArtworkUrl: `/catalog/releases/${rid}/artwork`,
      },
    });
    // Playlist references the SAME track twice — once by its LibraryTrack uuid,
    // once by its catalog id. Both keys resolve to the same row; the public view
    // must not double-count or double-emit.
    const pl = await service.createPlaylist(owner, {
      name: 'Dup Keyed',
      trackIds: [row.id, ctid],
    });
    await service.updatePlaylist(owner, pl.id, { visibility: 'public' });

    const view = await service.getPublicPlaylist(pl.id);
    expect(view.tracks).toHaveLength(1);
    expect(view.trackCount).toBe(1);
    expect(view.playableTrackCount).toBe(1);

    const discovery = await service.listPublicPlaylists({ limit: 100 });
    const entry = discovery.find((p) => p.id === pl.id);
    expect(entry).toBeDefined();
    expect(entry!.trackCount).toBe(1);
    expect(entry!.playableTrackCount).toBe(1);
  });

  it('does not leak the private folderId on the public view', async () => {
    const folder = await service.createFolder(owner, 'Private Folder');
    const pl = await service.createPlaylist(owner, { name: 'Foldered', folderId: folder.id });
    await service.updatePlaylist(owner, pl.id, { visibility: 'public' });

    const view = await service.getPublicPlaylist(pl.id, viewer);
    expect(view as unknown as Record<string, unknown>).not.toHaveProperty('folderId');
  });

  it('saves a public playlist, blocks saving private/own, and re-resolves live', async () => {
    const { remoteId } = await seedOwnerLibrary();
    const pl = await service.createPlaylist(owner, { name: 'Saveable', trackIds: [remoteId] });

    // Private cannot be saved.
    await expect(service.savePlaylist(viewer, pl.id)).rejects.toThrow(/private/i);

    await service.updatePlaylist(owner, pl.id, { visibility: 'public' });

    // Owner cannot save their own playlist.
    await expect(service.savePlaylist(owner, pl.id)).rejects.toThrow(/own/i);

    const saved = await service.savePlaylist(viewer, pl.id);
    expect(saved.available).toBe(true);
    expect(saved.savedPlaylistId).toBeDefined();
    expect(events.some((e) => e.eventName === 'playlist.saved_to_library')).toBe(true);

    // Public view now reports it as saved for the viewer.
    const view = await service.getPublicPlaylist(pl.id, viewer);
    expect(view.isSaved).toBe(true);

    const list = await service.listSavedPlaylists(viewer);
    expect(list).toHaveLength(1);
    expect(list[0].available).toBe(true);
    expect(list[0].name).toBe('Saveable');
  });

  it('marks a saved playlist unavailable when the source goes private', async () => {
    const { remoteId } = await seedOwnerLibrary();
    const pl = await service.createPlaylist(owner, { name: 'Will Hide', trackIds: [remoteId] });
    await service.updatePlaylist(owner, pl.id, { visibility: 'public' });
    await service.savePlaylist(viewer, pl.id);

    // Owner flips it back to private.
    await service.updatePlaylist(owner, pl.id, { visibility: 'private' });

    const list = await service.listSavedPlaylists(viewer);
    const entry = list.find((s) => s.id === pl.id);
    expect(entry?.available).toBe(false);
  });

  it('removes a saved playlist and emits removed_from_library', async () => {
    const { remoteId } = await seedOwnerLibrary();
    const pl = await service.createPlaylist(owner, { name: 'Removable', trackIds: [remoteId] });
    await service.updatePlaylist(owner, pl.id, { visibility: 'public' });
    const saved = await service.savePlaylist(viewer, pl.id);

    const result = await service.removeSavedPlaylist(viewer, saved.savedPlaylistId);
    expect(result.removed).toBe(true);
    expect(events.some((e) => e.eventName === 'playlist.removed_from_library')).toBe(true);

    await expect(
      service.removeSavedPlaylist(viewer, saved.savedPlaylistId),
    ).rejects.toThrow(/not found/i);
  });
});
