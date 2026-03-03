/**
 * PlaylistService unit tests — Issue #362
 *
 * Tests CRUD operations for playlists and folders, including ownership
 * validation and folder-playlist relationship management.
 */

const mockPlaylists = new Map<string, any>();
const mockFolders = new Map<string, any>();

jest.mock('../db/prisma', () => ({
  prisma: {
    playlist: {
      create: jest.fn(async ({ data }: any) => {
        const id = `pl-${mockPlaylists.size + 1}`;
        const record = { id, ...data, createdAt: new Date(), updatedAt: new Date() };
        mockPlaylists.set(id, record);
        return record;
      }),
      findUnique: jest.fn(async ({ where }: any) => mockPlaylists.get(where.id) ?? null),
      findMany: jest.fn(async ({ where }: any) => {
        return Array.from(mockPlaylists.values()).filter(p => {
          if (p.userId !== where.userId) return false;
          if (where.folderId !== undefined && p.folderId !== where.folderId) return false;
          return true;
        });
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const existing = mockPlaylists.get(where.id);
        if (!existing) throw new Error('Not found');
        const updated = { ...existing, ...data };
        mockPlaylists.set(where.id, updated);
        return updated;
      }),
      updateMany: jest.fn(),
      delete: jest.fn(async ({ where }: any) => {
        const deleted = mockPlaylists.get(where.id);
        mockPlaylists.delete(where.id);
        return deleted;
      }),
    },
    folder: {
      create: jest.fn(async ({ data }: any) => {
        const id = `folder-${mockFolders.size + 1}`;
        const record = { id, ...data, playlists: [], createdAt: new Date() };
        mockFolders.set(id, record);
        return record;
      }),
      findUnique: jest.fn(async ({ where }: any) => mockFolders.get(where.id) ?? null),
      findMany: jest.fn(async ({ where }: any) => {
        return Array.from(mockFolders.values()).filter(f => f.userId === where.userId);
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const existing = mockFolders.get(where.id);
        if (!existing) throw new Error('Not found');
        const updated = { ...existing, ...data };
        mockFolders.set(where.id, updated);
        return updated;
      }),
      delete: jest.fn(async ({ where }: any) => {
        const deleted = mockFolders.get(where.id);
        mockFolders.delete(where.id);
        return deleted;
      }),
    },
  },
}));

import { PlaylistService } from '../modules/playlist/playlist.service';

describe('PlaylistService', () => {
  let service: PlaylistService;

  beforeEach(() => {
    mockPlaylists.clear();
    mockFolders.clear();
    service = new PlaylistService();
  });

  describe('createPlaylist', () => {
    it('creates a playlist with name and trackIds', async () => {
      const result = await service.createPlaylist('user-1', {
        name: 'My Playlist',
        trackIds: ['t-1', 't-2'],
      });
      expect(result.name).toBe('My Playlist');
      expect(result.trackIds).toEqual(['t-1', 't-2']);
      expect(result.userId).toBe('user-1');
    });

    it('defaults trackIds to empty array', async () => {
      const result = await service.createPlaylist('user-1', { name: 'Empty' });
      expect(result.trackIds).toEqual([]);
    });
  });

  describe('getPlaylist', () => {
    it('returns playlist owned by user', async () => {
      const created = await service.createPlaylist('user-1', { name: 'Test' });
      const result = await service.getPlaylist('user-1', created.id);
      expect(result.name).toBe('Test');
    });

    it('throws NotFoundException for wrong user', async () => {
      const created = await service.createPlaylist('user-1', { name: 'Test' });
      await expect(service.getPlaylist('user-2', created.id)).rejects.toThrow('Playlist not found');
    });

    it('throws NotFoundException for non-existent playlist', async () => {
      await expect(service.getPlaylist('user-1', 'nonexistent')).rejects.toThrow('Playlist not found');
    });
  });

  describe('updatePlaylist', () => {
    it('updates playlist name', async () => {
      const created = await service.createPlaylist('user-1', { name: 'Old' });
      const updated = await service.updatePlaylist('user-1', created.id, { name: 'New' });
      expect(updated.name).toBe('New');
    });

    it('throws NotFoundException for wrong user', async () => {
      const created = await service.createPlaylist('user-1', { name: 'Test' });
      await expect(service.updatePlaylist('user-2', created.id, { name: 'Hack' }))
        .rejects.toThrow('Playlist not found');
    });
  });

  describe('deletePlaylist', () => {
    it('deletes playlist owned by user', async () => {
      const created = await service.createPlaylist('user-1', { name: 'ToDelete' });
      await service.deletePlaylist('user-1', created.id);
      await expect(service.getPlaylist('user-1', created.id)).rejects.toThrow();
    });

    it('throws for wrong user', async () => {
      const created = await service.createPlaylist('user-1', { name: 'Test' });
      await expect(service.deletePlaylist('user-2', created.id)).rejects.toThrow('Playlist not found');
    });
  });

  describe('createFolder', () => {
    it('creates a folder', async () => {
      const folder = await service.createFolder('user-1', 'Favorites');
      expect(folder.name).toBe('Favorites');
      expect(folder.userId).toBe('user-1');
    });
  });

  describe('listFolders', () => {
    it('returns only user folders', async () => {
      await service.createFolder('user-1', 'A');
      await service.createFolder('user-2', 'B');
      const folders = await service.listFolders('user-1');
      expect(folders).toHaveLength(1);
      expect(folders[0].name).toBe('A');
    });
  });

  describe('updateFolder', () => {
    it('updates folder name', async () => {
      const folder = await service.createFolder('user-1', 'Old');
      const updated = await service.updateFolder('user-1', folder.id, 'New');
      expect(updated.name).toBe('New');
    });

    it('throws for wrong user', async () => {
      const folder = await service.createFolder('user-1', 'Test');
      await expect(service.updateFolder('user-2', folder.id, 'Hack'))
        .rejects.toThrow('Folder not found');
    });
  });

  describe('deleteFolder', () => {
    it('throws for wrong user', async () => {
      const folder = await service.createFolder('user-1', 'Test');
      await expect(service.deleteFolder('user-2', folder.id))
        .rejects.toThrow('Folder not found');
    });
  });
});
