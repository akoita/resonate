/**
 * LyriaClient unit tests
 *
 * Covers the Lyria 3 Pro generateContent path and the Vertex Lyria 2 fallback
 * used by /create.
 */

const mockGenerateContent = jest.fn();
const mockGetAccessToken = jest.fn();

jest.mock('@google/genai', () => ({
  GoogleGenAI: jest.fn().mockImplementation(() => ({
    models: {
      generateContent: mockGenerateContent,
    },
  })),
}));

jest.mock('google-auth-library', () => ({
  GoogleAuth: jest.fn().mockImplementation(() => ({
    getAccessToken: mockGetAccessToken,
  })),
}));

const mockConfigService = {
  get: jest.fn().mockImplementation((key: string, defaultVal?: any) => {
    const map: Record<string, any> = {
      GOOGLE_AI_API_KEY: 'test-api-key-123',
      LYRIA_PROJECT_ID: '',
      LYRIA_LOCATION: '',
    };
    return map[key] ?? defaultVal ?? '';
  }),
};

import { LyriaClient } from '../modules/generation/lyria.client';
import { GoogleGenAI } from '@google/genai';
import { GoogleAuth } from 'google-auth-library';

function buildResponse(
  parts: Array<{ text?: string; inlineData?: { data: string; mimeType?: string } }>,
  promptFeedback?: any,
) {
  return {
    candidates: [
      {
        content: {
          parts,
        },
      },
    ],
    promptFeedback,
  };
}

describe('LyriaClient', () => {
  let client: LyriaClient;
  const originalFetch = global.fetch;
  const setConfig = (map: Record<string, any>) => {
    mockConfigService.get = jest.fn().mockImplementation((key: string, defaultVal?: any) => {
      const base: Record<string, any> = {
        GOOGLE_AI_API_KEY: 'test-api-key-123',
        LYRIA_PROJECT_ID: '',
        LYRIA_LOCATION: '',
      };
      return (map[key] ?? base[key] ?? defaultVal ?? '');
    });
  };

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn() as any;
    mockGetAccessToken.mockResolvedValue('vertex-token-123');
    setConfig({});
    client = new LyriaClient(mockConfigService as any);
    mockGenerateContent.mockResolvedValue(
      buildResponse([
        { text: '[Intro]\nInstrumental only' },
        { inlineData: { data: Buffer.from('fake-mp3-data').toString('base64'), mimeType: 'audio/mpeg' } },
      ]),
    );
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('creates GoogleGenAI with GOOGLE_AI_API_KEY and v1beta version when Vertex config is absent', () => {
    expect(GoogleGenAI).toHaveBeenCalledWith({
      apiKey: 'test-api-key-123',
      apiVersion: 'v1beta',
    });
  });

  it('prefers Vertex AI ADC when LYRIA project and location are configured', () => {
    setConfig({
      LYRIA_PROJECT_ID: 'resonate-vertex',
      LYRIA_LOCATION: 'us-central1',
    });

    new LyriaClient(mockConfigService as any);

    expect(GoogleAuth).toHaveBeenCalledWith({
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    });
  });

  it('uses Vertex Lyria 2 predict for 30-second generation when Vertex config is present', async () => {
    setConfig({
      LYRIA_PROJECT_ID: 'resonate-vertex',
      LYRIA_LOCATION: 'us-central1',
    });

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        predictions: [
          {
            bytesBase64Encoded: Buffer.from('fake-wav-data').toString('base64'),
            mimeType: 'audio/wav',
          },
        ],
      }),
    });

    client = new LyriaClient(mockConfigService as any);
    const result = await client.generate({ prompt: 'vertex groove', durationSeconds: 30, seed: 123 });

    expect(GoogleAuth).toHaveBeenCalledWith({
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    });
    expect(mockGetAccessToken).toHaveBeenCalled();
    expect(global.fetch).toHaveBeenCalledWith(
      'https://us-central1-aiplatform.googleapis.com/v1/projects/resonate-vertex/locations/us-central1/publishers/google/models/lyria-002:predict',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer vertex-token-123',
          'Content-Type': 'application/json',
        }),
      }),
    );
    expect(mockGenerateContent).not.toHaveBeenCalled();
    expect(result.provider).toBe('lyria-002');
    expect(result.durationSeconds).toBe(30);
    expect(result.sampleRate).toBe(48_000);
    expect(result.mimeType).toBe('audio/wav');
  });

  it('uses lyria-3-pro-preview with audio response modalities only', async () => {
    const result = await client.generate({ prompt: 'dreamy ambient' });

    expect(mockGenerateContent).toHaveBeenCalledWith({
      model: 'lyria-3-pro-preview',
      contents: 'Create a 30-second track. dreamy ambient',
      config: {
        responseModalities: ['AUDIO', 'TEXT'],
      },
    });

    expect(result.audioBytes).toEqual(Buffer.from('fake-mp3-data'));
    expect(result.mimeType).toBe('audio/mpeg');
    expect(result.provider).toBe('lyria-3-pro-preview');
    expect(result.durationSeconds).toBe(30);
    expect(result.sampleRate).toBe(44_100);
    expect(result.lyrics).toEqual(['[Intro]\nInstrumental only']);
  });

  it('uses Gemini Lyria 3 for longer durations even when Vertex config is present', async () => {
    setConfig({
      LYRIA_PROJECT_ID: 'resonate-vertex',
      LYRIA_LOCATION: 'us-central1',
    });

    client = new LyriaClient(mockConfigService as any);
    await client.generate({ prompt: 'cinematic longform', durationSeconds: 60 });

    expect(mockGenerateContent).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'lyria-3-pro-preview',
        contents: 'Create a 1-minute track. cinematic longform',
      }),
    );
  });

  it('throws a clear error when only Vertex config is present for longer durations', async () => {
    setConfig({
      LYRIA_PROJECT_ID: 'resonate-vertex',
      LYRIA_LOCATION: 'us-central1',
      GOOGLE_AI_API_KEY: '',
    });

    client = new LyriaClient(mockConfigService as any);

    await expect(client.generate({ prompt: 'vertex only fail', durationSeconds: 60 })).rejects.toThrow(
      'Longer-than-30-second Lyria generation requires the Gemini API key path; Vertex ADC currently supports 30-second lyria-002 clips only.',
    );
  });

  it('falls back to magic-byte audio mime detection when inlineData mimeType is missing', async () => {
    const fakeWav = Buffer.concat([
      Buffer.from('RIFF'),
      Buffer.alloc(4),
      Buffer.from('WAVE'),
      Buffer.from('rest-of-wav'),
    ]);

    mockGenerateContent.mockResolvedValueOnce(
      buildResponse([
        { inlineData: { data: fakeWav.toString('base64') } },
      ]),
    );

    const result = await client.generate({ prompt: 'test wav detection' });
    expect(result.mimeType).toBe('audio/wav');
  });

  it('requests longer duration through the prompt', async () => {
    await client.generate({ prompt: 'cinematic score with strings', durationSeconds: 120 });

    expect(mockGenerateContent).toHaveBeenCalledWith(
      expect.objectContaining({
        contents: 'Create a 2-minute track. cinematic score with strings',
      }),
    );
  });

  it('injects negative prompt guidance into the prompt text', async () => {
    await client.generate({
      prompt: 'afrobeat groove with guitars',
      negativePrompt: 'no vocals, no drums',
      durationSeconds: 60,
    });

    expect(mockGenerateContent).toHaveBeenCalledWith(
      expect.objectContaining({
        contents:
          'Create a 1-minute track. afrobeat groove with guitars Avoid these elements: no vocals, no drums.',
      }),
    );
  });

  it('returns provided seed unchanged in metadata', async () => {
    const result = await client.generate({ prompt: 'test', seed: 42 });
    expect(result.seed).toBe(42);
  });

  it('generates random seed when not provided', async () => {
    const result = await client.generate({ prompt: 'test' });
    expect(result.seed).toBeDefined();
    expect(typeof result.seed).toBe('number');
  });

  it('throws when no audio inline data is returned', async () => {
    mockGenerateContent.mockResolvedValueOnce(
      buildResponse([{ text: 'Lyrics only' }]),
    );

    await expect(client.generate({ prompt: 'test' })).rejects.toThrow(
      'Lyria 3 returned no audio data',
    );
  });

  it('surfaces blocked prompt feedback', async () => {
    mockGenerateContent.mockResolvedValueOnce(
      buildResponse([], { blockReason: 'SAFETY' }),
    );

    await expect(client.generate({ prompt: 'test' })).rejects.toThrow(
      'Lyria prompt was blocked: SAFETY',
    );
  });
});
