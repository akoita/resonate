const mockConnect = jest.fn();

jest.mock('@google/genai', () => ({
  GoogleGenAI: jest.fn().mockImplementation(() => ({
    live: { music: { connect: mockConnect } },
  })),
}));

import { EventBus } from '../shared/event_bus';
import {
  LyriaRealtimeService,
  RealtimeSessionOwner,
} from './lyria_realtime.service';

describe('LyriaRealtimeService', () => {
  const owner: RealtimeSessionOwner = { userId: 'user-1', socketId: 'socket-a' };
  const otherUser = { userId: 'user-2', socketId: 'socket-a' };
  const otherSocket = { userId: 'user-1', socketId: 'socket-b' };
  let service: LyriaRealtimeService;
  let eventBus: EventBus;
  let sdkSession: {
    setWeightedPrompts: jest.Mock;
    setMusicGenerationConfig: jest.Mock;
    resetContext: jest.Mock;
    play: jest.Mock;
    stop: jest.Mock;
  };
  let callbacks: { onmessage: (message: any) => void; onclose: () => void };

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    eventBus = new EventBus();
    sdkSession = {
      setWeightedPrompts: jest.fn().mockResolvedValue(undefined),
      setMusicGenerationConfig: jest.fn().mockResolvedValue(undefined),
      resetContext: jest.fn().mockResolvedValue(undefined),
      play: jest.fn().mockResolvedValue(undefined),
      stop: jest.fn().mockResolvedValue(undefined),
    };
    callbacks = undefined as any;
    mockConnect.mockImplementation(async ({ callbacks: nextCallbacks }) => {
      callbacks = nextCallbacks;
      return sdkSession;
    });
    const configService = {
      get: jest.fn().mockImplementation((key: string, fallback?: string) => {
        if (key === 'GOOGLE_AI_API_KEY') return 'test-api-key';
        return fallback ?? '';
      }),
    };
    service = new LyriaRealtimeService(configService as any, eventBus);
  });

  afterEach(() => {
    service.onModuleDestroy();
    eventBus.onModuleDestroy();
    jest.useRealTimers();
  });

  async function start() {
    return service.startSession({ trackId: 'track-1', owner });
  }

  it('uses opaque UUID session ids and stores the complete owner context', async () => {
    const sessionId = await start();

    expect(sessionId).toMatch(/^rt_[0-9a-f]{8}-[0-9a-f-]{27}$/i);
    expect(service.getSessionState(sessionId, owner)).toEqual(expect.objectContaining({
      isActive: true,
      isRecording: false,
    }));
    expect(service.getSessionState(sessionId, otherSocket)).toBeNull();
  });

  it('requires both user and socket ownership for every control operation', async () => {
    const sessionId = await start();

    await expect(service.updateControls(sessionId, otherUser, { bpm: 160 }))
      .rejects.toThrow('Realtime session unavailable');
    await expect(service.updateControls(sessionId, otherSocket, { bpm: 160 }))
      .rejects.toThrow('Realtime session unavailable');
    expect(service.getSessionState(sessionId, owner)?.controls.bpm).toBe(120);

    expect(() => service.stopSession(sessionId, otherUser))
      .toThrow('Realtime session unavailable');
    expect(() => service.startRecording(sessionId, otherSocket))
      .toThrow('Realtime session unavailable');
    expect(() => service.stopRecording(sessionId, otherUser))
      .toThrow('Realtime session unavailable');
    expect(service.getSessionState(sessionId, owner)?.isActive).toBe(true);
  });

  it('does not disclose recorded chunks to a non-owner', async () => {
    const sessionId = await start();
    service.startRecording(sessionId, owner);
    callbacks.onmessage({
      serverContent: { audioChunks: [{ data: Buffer.from('pcm').toString('base64') }] },
    });

    expect(() => service.stopRecording(sessionId, otherSocket))
      .toThrow('Realtime session unavailable');
    expect(service.getSessionState(sessionId, owner)?.isRecording).toBe(true);
    const wav = service.stopRecording(sessionId, owner);
    expect(wav.subarray(44).toString()).toBe('pcm');
  });

  it('cleans provider-close sessions and publishes one disconnect event', async () => {
    const disconnected = jest.fn();
    eventBus.subscribe('realtime.disconnected', disconnected);
    const sessionId = await start();

    callbacks.onclose();
    callbacks.onclose();

    expect(service.getSessionState(sessionId, owner)).toBeNull();
    expect((service as any).sessions.size).toBe(0);
    expect(disconnected).toHaveBeenCalledTimes(1);
    expect(disconnected).toHaveBeenCalledWith(expect.objectContaining({
      sessionId,
      userId: owner.userId,
      reason: 'Connection lost',
    }));
  });

  it('cancels pending provider setup when the owning socket disconnects', async () => {
    let resolveConnect!: (value: typeof sdkSession) => void;
    mockConnect.mockImplementationOnce(({ callbacks: nextCallbacks }) => {
      callbacks = nextCallbacks;
      return new Promise<typeof sdkSession>((resolve) => {
        resolveConnect = resolve;
      });
    });

    const pendingStart = service.startSession({ trackId: 'track-1', owner });
    await Promise.resolve();
    expect((service as any).sessions.size).toBe(1);

    service.stopSessionsForSocket(owner.socketId);
    resolveConnect(sdkSession);

    await expect(pendingStart).rejects.toThrow('Realtime session was cancelled');
    expect((service as any).sessions.size).toBe(0);
    expect(sdkSession.stop).toHaveBeenCalledTimes(1);
  });

  it('cleans idle-timeout and shutdown sessions without retaining timers or chunks', async () => {
    const disconnected = jest.fn();
    eventBus.subscribe('realtime.disconnected', disconnected);
    const sessionId = await start();
    service.startRecording(sessionId, owner);
    callbacks.onmessage({
      serverContent: { audioChunks: [{ data: Buffer.from('pcm').toString('base64') }] },
    });

    jest.advanceTimersByTime(60_000);

    expect(service.getSessionState(sessionId, owner)).toBeNull();
    expect((service as any).sessions.size).toBe(0);
    expect(disconnected).toHaveBeenCalledTimes(1);

    const shutdownSessionId = await start();
    service.onModuleDestroy();
    expect(service.getSessionState(shutdownSessionId, owner)).toBeNull();
    expect((service as any).sessions.size).toBe(0);
  });

  it('ignores provider audio after an explicit stop', async () => {
    const audio = jest.fn();
    eventBus.subscribe('realtime.audio', audio);
    const sessionId = await start();
    service.startRecording(sessionId, owner);

    const chunk = Buffer.from('pcm').toString('base64');
    callbacks.onmessage({ serverContent: { audioChunks: [{ data: chunk }] } });
    service.stopSession(sessionId, owner);
    callbacks.onmessage({ serverContent: { audioChunks: [{ data: chunk }] } });

    expect(audio).toHaveBeenCalledTimes(1);
    expect(() => service.stopRecording(sessionId, owner))
      .toThrow('Realtime session unavailable');
  });
});
