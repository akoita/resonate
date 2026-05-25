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
    await prisma.user.delete({ where: { id: userId } }).catch(() => {});
    eventBus.destroy();
  });

  beforeEach(() => {
    events.length = 0;
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
