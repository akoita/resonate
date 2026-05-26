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
  it('forwards session intent preferences when starting a session', () => {
    const ctrl = makeController();

    ctrl.start({
      userId: 'user-1',
      budgetCapUsd: 15,
      preferences: {
        mood: 'Hype',
        energy: 'high',
        genres: ['Bass', 'Club', 'Trap'],
        licenseType: 'remix',
        sessionIntent: 'Hype',
        sessionIntentName: 'Pulse Raid',
        queueStyle: 'Fast cuts',
        source: 'agent_session_intent',
      },
    });

    expect(mockSessionsService.startSession).toHaveBeenCalledWith({
      userId: 'user-1',
      budgetCapUsd: 15,
      preferences: {
        mood: 'Hype',
        energy: 'high',
        genres: ['Bass', 'Club', 'Trap'],
        licenseType: 'remix',
        sessionIntent: 'Hype',
        sessionIntentName: 'Pulse Raid',
        queueStyle: 'Fast cuts',
        source: 'agent_session_intent',
      },
    });
  });

  it('forwards session intent preferences for next AI pick requests', () => {
    const ctrl = makeController();

    ctrl.agentNext({
      sessionId: 'session-1',
      preferences: {
        mood: 'Focus',
        energy: 'medium',
        genres: ['Ambient', 'Lo-fi'],
        licenseType: 'personal',
        sessionIntent: 'Focus',
        sessionIntentName: 'Neural Flow',
        queueStyle: 'Stable pacing',
        source: 'agent_session_intent',
      },
    });

    expect(mockSessionsService.agentNext).toHaveBeenCalledWith({
      sessionId: 'session-1',
      preferences: {
        mood: 'Focus',
        energy: 'medium',
        genres: ['Ambient', 'Lo-fi'],
        licenseType: 'personal',
        sessionIntent: 'Focus',
        sessionIntentName: 'Neural Flow',
        queueStyle: 'Stable pacing',
        source: 'agent_session_intent',
      },
    });
  });

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
