/**
 * PlaylistController — Unit Test
 *
 * Tests controller-specific concern:
 *   - All endpoints extract req.user.userId correctly
 */

import { PlaylistController } from '../modules/playlist/playlist.controller';

const mockPlaylistService = {
  createFolder: jest.fn().mockResolvedValue({ id: 'f1' }),
  listFolders: jest.fn().mockResolvedValue([]),
  updateFolder: jest.fn().mockResolvedValue({ id: 'f1' }),
  deleteFolder: jest.fn().mockResolvedValue({ ok: true }),
  createPlaylist: jest.fn().mockResolvedValue({ id: 'p1' }),
  listPlaylists: jest.fn().mockResolvedValue([]),
  getPlaylist: jest.fn().mockResolvedValue({ id: 'p1' }),
  updatePlaylist: jest.fn().mockResolvedValue({ id: 'p1' }),
  deletePlaylist: jest.fn().mockResolvedValue({ ok: true }),
};

function makeController() {
  return new PlaylistController(mockPlaylistService as any);
}

const req = { user: { userId: 'user-42' } } as any;

beforeEach(() => jest.clearAllMocks());

describe('PlaylistController', () => {
  describe('userId extraction', () => {
    it('createFolder passes userId', () => {
      const ctrl = makeController();
      ctrl.createFolder(req, 'My Folder');
      expect(mockPlaylistService.createFolder).toHaveBeenCalledWith('user-42', 'My Folder');
    });

    it('listFolders passes userId', () => {
      const ctrl = makeController();
      ctrl.listFolders(req);
      expect(mockPlaylistService.listFolders).toHaveBeenCalledWith('user-42');
    });

    it('createPlaylist passes userId', () => {
      const ctrl = makeController();
      ctrl.createPlaylist(req, { name: 'Chill', trackIds: ['t1'] });
      expect(mockPlaylistService.createPlaylist).toHaveBeenCalledWith('user-42', {
        name: 'Chill',
        trackIds: ['t1'],
      });
    });

    it('deletePlaylist passes userId', () => {
      const ctrl = makeController();
      ctrl.deletePlaylist(req, 'p1');
      expect(mockPlaylistService.deletePlaylist).toHaveBeenCalledWith('user-42', 'p1');
    });
  });
});
