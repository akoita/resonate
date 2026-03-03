/**
 * LyriaClient unit tests — Issue #362
 *
 * Tests Vertex AI endpoint construction, auth token handling,
 * request body format, and error responses.
 */

const mockFetch = jest.fn();
global.fetch = mockFetch;

// Mock google-auth-library
jest.mock('google-auth-library', () => ({
  GoogleAuth: jest.fn().mockImplementation(() => ({
    getClient: jest.fn().mockResolvedValue({
      getAccessToken: jest.fn().mockResolvedValue({ token: 'mock-gcp-token' }),
    }),
  })),
}));

const mockConfigService = {
  get: jest.fn().mockImplementation((key: string, defaultVal?: string) => {
    const map: Record<string, string> = {
      LYRIA_PROJECT_ID: 'test-project-123',
      LYRIA_LOCATION: 'us-central1',
      LYRIA_MODEL_ID: 'lyria-002',
    };
    return map[key] ?? defaultVal ?? '';
  }),
};

import { LyriaClient } from '../modules/generation/lyria.client';

describe('LyriaClient', () => {
  let client: LyriaClient;

  beforeEach(() => {
    jest.clearAllMocks();
    client = new LyriaClient(mockConfigService as any);
  });

  describe('endpoint construction', () => {
    it('constructs correct Vertex AI endpoint URL', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          predictions: [{
            audioContent: Buffer.from('test-audio').toString('base64'),
            synthIdPresent: true,
          }],
        }),
      });

      await client.generate({ prompt: 'jazz piano' });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://us-central1-aiplatform.googleapis.com/v1/projects/test-project-123/locations/us-central1/publishers/google/models/lyria-002:predict',
        expect.any(Object),
      );
    });
  });

  describe('auth token', () => {
    it('includes Bearer token in Authorization header', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          predictions: [{
            audioContent: Buffer.from('audio').toString('base64'),
          }],
        }),
      });

      await client.generate({ prompt: 'test' });

      const fetchCall = mockFetch.mock.calls[0];
      expect(fetchCall[1].headers.Authorization).toBe('Bearer mock-gcp-token');
    });
  });

  describe('request body', () => {
    it('sends prompt and default seed', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          predictions: [{
            audioContent: Buffer.from('audio').toString('base64'),
          }],
        }),
      });

      await client.generate({ prompt: 'dreamy ambient' });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.instances[0].prompt).toBe('dreamy ambient');
      expect(body.instances[0].seed).toBeDefined();
      expect(body.parameters.sampleRate).toBe(48000);
      expect(body.parameters.durationSeconds).toBe(30);
    });

    it('uses provided seed', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          predictions: [{
            audioContent: Buffer.from('audio').toString('base64'),
          }],
        }),
      });

      await client.generate({ prompt: 'test', seed: 42 });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.instances[0].seed).toBe(42);
    });

    it('includes negative prompt when provided', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          predictions: [{
            audioContent: Buffer.from('audio').toString('base64'),
          }],
        }),
      });

      await client.generate({ prompt: 'jazz', negativePrompt: 'vocals' });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.instances[0].negative_prompt).toBe('vocals');
    });
  });

  describe('error handling', () => {
    it('throws on non-OK response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        text: async () => 'Rate limited',
      });

      await expect(client.generate({ prompt: 'test' }))
        .rejects.toThrow('Lyria API returned 429: Rate limited');
    });

    it('throws when no audio content in response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ predictions: [{}] }),
      });

      await expect(client.generate({ prompt: 'test' }))
        .rejects.toThrow('missing audioContent');
    });
  });

  describe('response parsing', () => {
    it('returns decoded audio bytes and metadata', async () => {
      const audioData = Buffer.from('wav-audio-data-here');
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          predictions: [{
            audioContent: audioData.toString('base64'),
            synthIdPresent: true,
          }],
        }),
      });

      const result = await client.generate({ prompt: 'test', seed: 42 });

      expect(result.audioBytes).toEqual(audioData);
      expect(result.seed).toBe(42);
      expect(result.durationSeconds).toBe(30);
      expect(result.sampleRate).toBe(48000);
    });

    it('handles alternative response field names', async () => {
      const audioData = Buffer.from('audio');
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          predictions: [{
            bytesBase64Encoded: audioData.toString('base64'),
          }],
        }),
      });

      const result = await client.generate({ prompt: 'test' });
      expect(result.audioBytes).toEqual(audioData);
    });
  });
});
