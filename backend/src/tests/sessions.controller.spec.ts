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

const mockPlaybackIntentsService = {
  capabilitiesForOwner: jest.fn().mockReturnValue({ available: false }),
  createCapability: jest.fn().mockReturnValue({ id: 'cap-1' }),
  revokeCapability: jest.fn().mockReturnValue({ status: 'revoked' }),
  registerDevice: jest.fn().mockReturnValue({ deviceId: 'web-1' }),
  resolve: jest.fn().mockResolvedValue({ outcome: 'queued', candidates: [] }),
  requestQueue: jest.fn().mockReturnValue({ outcome: 'queued' }),
  requestPlay: jest.fn().mockReturnValue({ outcome: 'confirmation_required' }),
  requestControl: jest.fn().mockReturnValue({ outcome: 'queued' }),
  confirmCommand: jest.fn().mockReturnValue({ outcome: 'playing' }),
  status: jest.fn().mockReturnValue({ commands: [] }),
};

function makeController() {
  return new SessionsController(mockSessionsService as any, mockPlaybackIntentsService as any);
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

  describe('agent-mediated playback intents', () => {
    const req = { user: { userId: 'owner-1' } };

    it('resolves playback intents for the authenticated owner', async () => {
      const ctrl = makeController();

      await ctrl.resolvePlaybackIntent({
        query: 'late night',
        constraints: { maxTracks: 2, explicit: false },
        initiator: 'external_agent',
      }, req);

      expect(mockPlaybackIntentsService.resolve).toHaveBeenCalledWith('owner-1', {
        query: 'late night',
        constraints: { maxTracks: 2, explicit: false, source: undefined, genres: undefined, mood: undefined },
        capabilityId: undefined,
        initiator: 'external_agent',
        sessionId: undefined,
      });
    });

    it('queues playback commands without trusting a body user id', () => {
      const ctrl = makeController();

      ctrl.queuePlaybackIntent({
        trackIds: ['track-1'],
        deviceId: 'web-1',
        initiator: 'external_agent',
      }, req);

      expect(mockPlaybackIntentsService.requestQueue).toHaveBeenCalledWith('owner-1', {
        trackIds: ['track-1'],
        deviceId: 'web-1',
        sessionId: undefined,
        capabilityId: undefined,
        source: undefined,
        initiator: 'external_agent',
        agentOriginated: undefined,
      });
    });

    it('confirms playback commands through the authenticated owner boundary', () => {
      const ctrl = makeController();

      ctrl.confirmPlaybackCommand('cmd-1', {
        deviceId: 'web-1',
        outcome: 'playing',
        currentTrackId: 'track-1',
      }, req);

      expect(mockPlaybackIntentsService.confirmCommand).toHaveBeenCalledWith('owner-1', {
        commandId: 'cmd-1',
        deviceId: 'web-1',
        outcome: 'playing',
        status: undefined,
        currentTrackId: 'track-1',
        reason: undefined,
      });
    });
  });
});
