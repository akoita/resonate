/**
 * LyriaClient unit tests — Issue #446 (@google/genai SDK refactor)
 *
 * Tests SDK initialization, prompt handling, session lifecycle,
 * and error handling using mocked @google/genai client.
 */

// Mock session returned by client.live.music.connect()
const mockSession = {
  setWeightedPrompts: jest.fn().mockResolvedValue(undefined),
  setMusicGenerationConfig: jest.fn().mockResolvedValue(undefined),
  play: jest.fn().mockResolvedValue(undefined),
  stop: jest.fn().mockResolvedValue(undefined),
};

// Track the onmessage callback so tests can inject audio chunks
let capturedCallbacks: any = {};

const mockConnect = jest.fn().mockImplementation(async (opts: any) => {
  capturedCallbacks = opts.callbacks || {};
  return mockSession;
});

// Mock @google/genai
jest.mock('@google/genai', () => ({
  GoogleGenAI: jest.fn().mockImplementation(() => ({
    live: {
      music: {
        connect: mockConnect,
      },
    },
  })),
}));

// Config service with 0ms generation wait for instant test completion
const mockConfigService = {
  get: jest.fn().mockImplementation((key: string, defaultVal?: any) => {
    const map: Record<string, any> = {
      GOOGLE_AI_API_KEY: 'test-api-key-123',
      LYRIA_GENERATION_WAIT_MS: 0,
    };
    return map[key] ?? defaultVal ?? '';
  }),
};

import { LyriaClient } from '../modules/generation/lyria.client';
import { GoogleGenAI } from '@google/genai';

/**
 * Helper: injects audio chunks into the captured session callback.
 * Must be called after generate() is invoked (which triggers connect()).
 */
function injectAudioChunks(chunks: Buffer[]) {
  for (const chunk of chunks) {
    capturedCallbacks.onmessage?.({
      serverContent: {
        audioChunks: [{ data: chunk.toString('base64') }],
      },
    });
  }
}

describe('LyriaClient', () => {
  let client: LyriaClient;

  beforeEach(() => {
    jest.clearAllMocks();
    capturedCallbacks = {};
    client = new LyriaClient(mockConfigService as any);

    // After connect resolves, inject audio chunks by default
    // Tests that need no audio can override mockConnect
    mockConnect.mockImplementation(async (opts: any) => {
      capturedCallbacks = opts.callbacks || {};
      // Simulate audio arriving immediately after connect
      process.nextTick(() => {
        injectAudioChunks([Buffer.from('default-audio')]);
      });
      return mockSession;
    });
  });

  describe('SDK initialization', () => {
    it('creates GoogleGenAI with GOOGLE_AI_API_KEY and v1alpha version', () => {
      expect(GoogleGenAI).toHaveBeenCalledWith({
        apiKey: 'test-api-key-123',
        apiVersion: 'v1alpha',
      });
    });
  });

  describe('generation session', () => {
    it('connects to lyria-realtime-exp model', async () => {
      const audioData = Buffer.from('test-audio-data');
      mockConnect.mockImplementation(async (opts: any) => {
        capturedCallbacks = opts.callbacks || {};
        process.nextTick(() => injectAudioChunks([audioData]));
        return mockSession;
      });

      const result = await client.generate({ prompt: 'jazz piano' });

      expect(mockConnect).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'models/lyria-realtime-exp',
          callbacks: expect.any(Object),
        }),
      );

      expect(result.audioBytes).toEqual(audioData);
      expect(result.sampleRate).toBe(48000);
      expect(result.durationSeconds).toBe(30);
    });

    it('sets weighted prompts with correct text and weight', async () => {
      await client.generate({ prompt: 'dreamy ambient' });

      expect(mockSession.setWeightedPrompts).toHaveBeenCalledWith({
        weightedPrompts: [{ text: 'dreamy ambient', weight: 1.0 }],
      });
    });

    it('includes negative prompt with negative weight', async () => {
      await client.generate({ prompt: 'jazz', negativePrompt: 'vocals' });

      expect(mockSession.setWeightedPrompts).toHaveBeenCalledWith({
        weightedPrompts: [
          { text: 'jazz', weight: 1.0 },
          { text: 'vocals', weight: -1.0 },
        ],
      });
    });

    it('calls play() to start and stop() to end generation', async () => {
      await client.generate({ prompt: 'test' });

      expect(mockSession.play).toHaveBeenCalled();
      expect(mockSession.stop).toHaveBeenCalled();
    });

    it('uses provided seed', async () => {
      const result = await client.generate({ prompt: 'test', seed: 42 });
      expect(result.seed).toBe(42);
    });

    it('generates random seed when not provided', async () => {
      const result = await client.generate({ prompt: 'test' });
      expect(result.seed).toBeDefined();
      expect(typeof result.seed).toBe('number');
    });
  });

  describe('error handling', () => {
    it('throws when no audio chunks received', async () => {
      // Override mock to NOT inject any chunks
      mockConnect.mockImplementation(async (opts: any) => {
        capturedCallbacks = opts.callbacks || {};
        return mockSession;
      });

      await expect(client.generate({ prompt: 'test' })).rejects.toThrow(
        'Lyria API returned no audio chunks',
      );
    });

    it('reports synthIdPresent as true', async () => {
      const result = await client.generate({ prompt: 'test' });
      expect(result.synthIdPresent).toBe(true);
    });
  });

  describe('response parsing', () => {
    it('concatenates multiple audio chunks', async () => {
      const chunk1 = Buffer.from('first-chunk');
      const chunk2 = Buffer.from('second-chunk');

      mockConnect.mockImplementation(async (opts: any) => {
        capturedCallbacks = opts.callbacks || {};
        process.nextTick(() => injectAudioChunks([chunk1, chunk2]));
        return mockSession;
      });

      const result = await client.generate({ prompt: 'test' });

      expect(result.audioBytes).toEqual(Buffer.concat([chunk1, chunk2]));
    });
  });
});
