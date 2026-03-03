/**
 * SessionsController — Unit Test
 *
 * Tests controller-specific concern:
 *   - playlist() limit string → Number coercion with NaN fallback
 */

import { SessionsController } from '../modules/sessions/sessions.controller';

const mockSessionsService = {
  startSession: jest.fn().mockResolvedValue({ sessionId: 's1' }),
  stopSession: jest.fn().mockResolvedValue({ ok: true }),
  playTrack: jest.fn().mockResolvedValue({ ok: true }),
  agentNext: jest.fn().mockResolvedValue({ trackId: 't1' }),
  getPlaylist: jest.fn().mockResolvedValue([]),
};

function makeController() {
  return new SessionsController(mockSessionsService as any);
}

beforeEach(() => jest.clearAllMocks());

describe('SessionsController', () => {
  describe('playlist — limit parsing', () => {
    it('defaults to 10 when limit is undefined', () => {
      const ctrl = makeController();
      ctrl.playlist(undefined);
      expect(mockSessionsService.getPlaylist).toHaveBeenCalledWith(10);
    });

    it('parses valid limit string', () => {
      const ctrl = makeController();
      ctrl.playlist('25');
      expect(mockSessionsService.getPlaylist).toHaveBeenCalledWith(25);
    });

    it('falls back to 10 for NaN limit', () => {
      const ctrl = makeController();
      ctrl.playlist('not-a-number');
      expect(mockSessionsService.getPlaylist).toHaveBeenCalledWith(10);
    });
  });
});
