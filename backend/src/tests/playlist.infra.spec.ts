/**
 * Playlist Service — Infra-backed Tests
 *
 * Tests PlaylistService against a real Postgres database (no mocks).
 * Validates folder/playlist CRUD, ownership checks, and folder dissociation.
 *
 * Requires: make dev-up (Postgres at localhost:5432)
 * Run: npm run test:integration
 */

import { PrismaClient } from '@prisma/client';
import { PlaylistService } from '../modules/playlist/playlist.service';

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://resonate:resonate@localhost:5432/resonate';

let prisma: PrismaClient;
let service: PlaylistService;
let dbAvailable = false;

const TEST_PREFIX = `pl_infra_${Date.now()}_`;
const userId = `${TEST_PREFIX}user`;

async function isPostgresAvailable(): Promise<boolean> {
  try {
    const p = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });
    await p.$connect();
    await p.$disconnect();
    return true;
  } catch {
    return false;
  }
}

describe('PlaylistService (infra-backed)', () => {
  beforeAll(async () => {
    dbAvailable = await isPostgresAvailable();
    if (!dbAvailable) {
      console.warn('⚠️  Postgres not available. Start with: make dev-up');
      return;
    }

    prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });
    await prisma.$connect();
    service = new PlaylistService();

    await prisma.user.upsert({
      where: { id: userId },
      update: {},
      create: { id: userId, email: `${userId}@test.resonate` },
    });
  });

  afterAll(async () => {
    if (!dbAvailable) return;
    try {
      await prisma.playlist.deleteMany({ where: { userId } });
      await prisma.folder.deleteMany({ where: { userId } });
      await prisma.user.delete({ where: { id: userId } });
    } catch (err) {
      console.warn('Cleanup warning:', err);
    }
    await prisma.$disconnect();
  });

  // ===== Folders =====

  it('creates a folder in real DB', async () => {
    if (!dbAvailable) return;
    const folder = await service.createFolder(userId, 'My Beats');
    expect(folder.id).toBeDefined();
    expect(folder.name).toBe('My Beats');
    expect(folder.userId).toBe(userId);
  });

  it('lists folders with playlists included', async () => {
    if (!dbAvailable) return;
    await service.createFolder(userId, 'Folder A');

    const folders = await service.listFolders(userId);
    expect(folders.length).toBeGreaterThanOrEqual(1);
    // Each folder should have a playlists array
    expect(folders[0]).toHaveProperty('playlists');
  });

  it('updates a folder name', async () => {
    if (!dbAvailable) return;
    const folder = await service.createFolder(userId, 'Old Name');
    const updated = await service.updateFolder(userId, folder.id, 'New Name');
    expect(updated.name).toBe('New Name');
  });

  it('rejects folder update for wrong user', async () => {
    if (!dbAvailable) return;
    const folder = await service.createFolder(userId, 'Guarded');
    await expect(
      service.updateFolder('wrong-user', folder.id, 'Hacked'),
    ).rejects.toThrow('Folder not found');
  });

  it('deletes folder and dissociates playlists', async () => {
    if (!dbAvailable) return;
    const folder = await service.createFolder(userId, 'Deletable');
    const playlist = await service.createPlaylist(userId, {
      name: 'Orphaned',
      folderId: folder.id,
    });

    await service.deleteFolder(userId, folder.id);

    // Folder gone
    const deleted = await prisma.folder.findUnique({ where: { id: folder.id } });
    expect(deleted).toBeNull();

    // Playlist still exists but folderId is null
    const orphaned = await prisma.playlist.findUnique({ where: { id: playlist.id } });
    expect(orphaned).not.toBeNull();
    expect(orphaned!.folderId).toBeNull();
  });

  // ===== Playlists =====

  it('creates a playlist with trackIds', async () => {
    if (!dbAvailable) return;
    const playlist = await service.createPlaylist(userId, {
      name: 'Chill Vibes',
      trackIds: ['track-1', 'track-2'],
    });
    expect(playlist.name).toBe('Chill Vibes');
    expect(playlist.trackIds).toEqual(['track-1', 'track-2']);
  });

  it('creates a playlist inside a folder', async () => {
    if (!dbAvailable) return;
    const folder = await service.createFolder(userId, 'Parent');
    const playlist = await service.createPlaylist(userId, {
      name: 'Child Playlist',
      folderId: folder.id,
    });
    expect(playlist.folderId).toBe(folder.id);
  });

  it('lists playlists filtered by folder', async () => {
    if (!dbAvailable) return;
    const folder = await service.createFolder(userId, 'Filter Test');
    await service.createPlaylist(userId, { name: 'In Folder', folderId: folder.id });
    await service.createPlaylist(userId, { name: 'No Folder' });

    const inFolder = await service.listPlaylists(userId, folder.id);
    expect(inFolder.every(p => p.folderId === folder.id)).toBe(true);
  });

  it('updates playlist name and trackIds', async () => {
    if (!dbAvailable) return;
    const playlist = await service.createPlaylist(userId, { name: 'V1' });
    const updated = await service.updatePlaylist(userId, playlist.id, {
      name: 'V2',
      trackIds: ['new-track'],
    });
    expect(updated.name).toBe('V2');
    expect(updated.trackIds).toEqual(['new-track']);
  });

  it('deletes a playlist', async () => {
    if (!dbAvailable) return;
    const playlist = await service.createPlaylist(userId, { name: 'Delete Me' });
    await service.deletePlaylist(userId, playlist.id);

    const gone = await prisma.playlist.findUnique({ where: { id: playlist.id } });
    expect(gone).toBeNull();
  });

  it('rejects playlist access for wrong user', async () => {
    if (!dbAvailable) return;
    const playlist = await service.createPlaylist(userId, { name: 'Private' });
    await expect(
      service.getPlaylist('wrong-user', playlist.id),
    ).rejects.toThrow('Playlist not found');
  });
});
