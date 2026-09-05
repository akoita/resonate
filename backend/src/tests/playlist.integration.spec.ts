/**
 * Playlist Service — Integration Test (Testcontainers)
 *
 * Tests PlaylistService against a real Postgres via Testcontainers.
 * Validates folder/playlist CRUD, ownership checks, and folder dissociation.
 *
 * Run: npm run test:integration
 */

import { prisma } from '../db/prisma';
import { PlaylistService } from '../modules/playlist/playlist.service';
import { EventBus } from '../modules/shared/event_bus';
import type { ResonateEvent } from '../events/event_types';

const TEST_PREFIX = `pl_${Date.now()}_`;
const userId = `${TEST_PREFIX}user`;

let service: PlaylistService;
let eventBus: EventBus;
let events: ResonateEvent[];

describe('PlaylistService (integration)', () => {
  beforeAll(async () => {
    eventBus = new EventBus();
    events = [];
    eventBus.subscribe('playlist.created', (event) => events.push(event));
    eventBus.subscribe('playlist.updated', (event) => events.push(event));
    eventBus.subscribe('playlist.deleted', (event) => events.push(event));
    eventBus.subscribe('playlist.track_added', (event) => events.push(event));
    eventBus.subscribe('playlist.track_removed', (event) => events.push(event));
    service = new PlaylistService(eventBus);
    await prisma.user.create({
      data: { id: userId, email: `${userId}@test.resonate` },
    });
  });

  afterAll(async () => {
    await prisma.playlist.deleteMany({ where: { userId } }).catch(() => {});
    await prisma.folder.deleteMany({ where: { userId } }).catch(() => {});
    await prisma.libraryTrack.deleteMany({ where: { userId } });
    await prisma.track.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.release.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.artist.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.user.delete({ where: { id: userId } }).catch(() => {});
    eventBus.destroy();
  });

  beforeEach(() => {
    events.length = 0;
  });

  it('saves a queue atomically in manifest order with one canonical creation event', async () => {
    const artist = await prisma.artist.create({ data: { id: `${TEST_PREFIX}artist`, displayName: 'Queue Artist' } });
    const release = await prisma.release.create({ data: { id: `${TEST_PREFIX}release`, artistId: artist.id, title: 'Queue', status: 'ready' } });
    const a = await prisma.track.create({ data: { id: `${TEST_PREFIX}a`, title: 'A', releaseId: release.id } });
    const b = await prisma.track.create({ data: { id: `${TEST_PREFIX}b`, title: 'B', releaseId: release.id } });
    const queueContext = { origin: 'player_queue' as const, sourceKind: 'ad_hoc' as const, queueCount: 3, omittedCount: 1 };
    const playlist = await service.createPlaylist(userId, { name: 'Snapshot', trackIds: [b.id, a.id], queueContext });
    expect(playlist.trackIds).toEqual([b.id, a.id]);
    expect(playlist.visibility).toBe('private');
    expect(await prisma.libraryTrack.count({ where: { userId, catalogTrackId: { in: [a.id, b.id] } } })).toBe(2);
    const savedTrack = await prisma.libraryTrack.findFirstOrThrow({ where: { userId, catalogTrackId: a.id } });
    expect(savedTrack.remoteUrl).toBe(`/catalog/releases/${release.id}/tracks/${a.id}/stream`);
    const created = events.filter(e => e.eventName === 'playlist.created');
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ origin: 'player_queue', sourceKind: 'ad_hoc', queueCount: 3, savedTrackCount: 2, omittedCount: 1 });
    const before = await prisma.playlist.count({ where: { userId } });
    await expect(service.createPlaylist(userId, { name: 'Invalid', trackIds: [a.id, 'deleted'], queueContext })).rejects.toThrow('no longer available');
    expect(await prisma.playlist.count({ where: { userId } })).toBe(before);
    await prisma.release.update({ where: { id: release.id }, data: { rightsRoute: 'PRIVATE' } });
    await expect(service.createPlaylist(userId, { name: 'Restricted', trackIds: [a.id], queueContext: { ...queueContext, queueCount: 1, omittedCount: 0 } })).rejects.toThrow('no longer available');
    expect(await prisma.playlist.count({ where: { userId } })).toBe(before);
  });

  it('rejects empty snapshots, malformed counts and folders belonging to someone else', async () => {
    const queueContext = { origin: 'player_queue' as const, sourceKind: 'ad_hoc' as const, queueCount: 1, omittedCount: 0 };
    await expect(service.createPlaylist(userId, { name: 'Empty', trackIds: [], queueContext })).rejects.toThrow('Invalid queue');
    await expect(service.createPlaylist(userId, { name: 'Wrong counts', trackIds: ['a'], queueContext: { ...queueContext, queueCount: -1 } })).rejects.toThrow('Invalid queue');
    await expect(service.createPlaylist(userId, { name: 'Wrong folder', folderId: 'not-owned', trackIds: ['a'], queueContext })).rejects.toThrow('Folder not found');
  });

  // ===== Folders =====

  it('creates a folder in real DB', async () => {
    const folder = await service.createFolder(userId, 'My Beats');
    expect(folder.id).toBeDefined();
    expect(folder.name).toBe('My Beats');
    expect(folder.userId).toBe(userId);
  });

  it('lists folders with playlists included', async () => {
    await service.createFolder(userId, 'Folder A');
    const folders = await service.listFolders(userId);
    expect(folders.length).toBeGreaterThanOrEqual(1);
    expect(folders[0]).toHaveProperty('playlists');
  });

  it('updates a folder name', async () => {
    const folder = await service.createFolder(userId, 'Old Name');
    const updated = await service.updateFolder(userId, folder.id, 'New Name');
    expect(updated.name).toBe('New Name');
  });

  it('rejects folder update for wrong user', async () => {
    const folder = await service.createFolder(userId, 'Guarded');
    await expect(
      service.updateFolder('wrong-user', folder.id, 'Hacked'),
    ).rejects.toThrow('Folder not found');
  });

  it('deletes folder and dissociates playlists', async () => {
    const folder = await service.createFolder(userId, 'Deletable');
    const playlist = await service.createPlaylist(userId, {
      name: 'Orphaned',
      folderId: folder.id,
    });

    await service.deleteFolder(userId, folder.id);

    const deleted = await prisma.folder.findUnique({ where: { id: folder.id } });
    expect(deleted).toBeNull();

    const orphaned = await prisma.playlist.findUnique({ where: { id: playlist.id } });
    expect(orphaned).not.toBeNull();
    expect(orphaned!.folderId).toBeNull();
  });

  // ===== Playlists =====

  it('creates a playlist with trackIds', async () => {
    const playlist = await service.createPlaylist(userId, {
      name: 'Chill Vibes',
      trackIds: ['track-1', 'track-2'],
    });
    expect(playlist.name).toBe('Chill Vibes');
    expect(playlist.trackIds).toEqual(['track-1', 'track-2']);
  });

  it('creates a playlist inside a folder', async () => {
    const folder = await service.createFolder(userId, 'Parent');
    const playlist = await service.createPlaylist(userId, {
      name: 'Child Playlist',
      folderId: folder.id,
    });
    expect(playlist.folderId).toBe(folder.id);
  });

  it('lists playlists filtered by folder', async () => {
    const folder = await service.createFolder(userId, 'Filter Test');
    await service.createPlaylist(userId, { name: 'In Folder', folderId: folder.id });
    await service.createPlaylist(userId, { name: 'No Folder' });

    const inFolder = await service.listPlaylists(userId, folder.id);
    expect(inFolder.every(p => p.folderId === folder.id)).toBe(true);
  });

  it('updates playlist name and trackIds', async () => {
    const playlist = await service.createPlaylist(userId, { name: 'V1' });
    events.length = 0;
    const updated = await service.updatePlaylist(userId, playlist.id, {
      name: 'V2',
      trackIds: ['new-track'],
    });
    expect(updated.name).toBe('V2');
    expect(updated.trackIds).toEqual(['new-track']);
    expect(events).toEqual([
      expect.objectContaining({
        eventName: 'playlist.updated',
        userId,
        playlistId: playlist.id,
        changedFields: ['name', 'tracks'],
        trackCount: 1,
      }),
      expect.objectContaining({
        eventName: 'playlist.track_added',
        userId,
        playlistId: playlist.id,
        trackIds: ['new-track'],
        addedCount: 1,
        trackCount: 1,
      }),
    ]);
  });

  it('deletes a playlist', async () => {
    const playlist = await service.createPlaylist(userId, { name: 'Delete Me' });
    events.length = 0;
    await service.deletePlaylist(userId, playlist.id);

    const gone = await prisma.playlist.findUnique({ where: { id: playlist.id } });
    expect(gone).toBeNull();
    expect(events).toEqual([
      expect.objectContaining({
        eventName: 'playlist.deleted',
        userId,
        playlistId: playlist.id,
      }),
    ]);
  });

  it('rejects playlist access for wrong user', async () => {
    const playlist = await service.createPlaylist(userId, { name: 'Private' });
    await expect(
      service.getPlaylist('wrong-user', playlist.id),
    ).rejects.toThrow('Playlist not found');
  });
});
