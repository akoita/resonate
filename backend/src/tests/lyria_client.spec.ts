/**
 * LyriaClient unit tests
 *
 * Covers the Lyria 3 Pro generateContent path used by /create, including
 * Vertex-first auth with Gemini API-key fallback when Vertex returns Not Found.
 */

const mockGenerateContent = jest.fn();

jest.mock('@google/genai', () => ({
  GoogleGenAI: jest.fn().mockImplementation(() => ({
    models: {
      generateContent: mockGenerateContent,
    },
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
    setConfig({});
    client = new LyriaClient(mockConfigService as any);
    mockGenerateContent.mockResolvedValue(
      buildResponse([
        { text: '[Intro]\nInstrumental only' },
        { inlineData: { data: Buffer.from('fake-mp3-data').toString('base64'), mimeType: 'audio/mpeg' } },
      ]),
    );
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

    expect(GoogleGenAI).toHaveBeenCalledWith({
      vertexai: true,
      project: 'resonate-vertex',
      location: 'us-central1',
      apiVersion: 'v1beta',
    });
    expect(GoogleGenAI).toHaveBeenCalledWith({
      apiKey: 'test-api-key-123',
      apiVersion: 'v1beta',
    });
  });

  it('falls back to the Gemini API key path when Vertex returns not found', async () => {
    setConfig({
      LYRIA_PROJECT_ID: 'resonate-vertex',
      LYRIA_LOCATION: 'us-central1',
    });

    mockGenerateContent
      .mockRejectedValueOnce({ error: { code: 404, status: 'NOT_FOUND' } })
      .mockResolvedValueOnce(
        buildResponse([
          { inlineData: { data: Buffer.from('fallback-audio').toString('base64'), mimeType: 'audio/mpeg' } },
        ]),
      );

    client = new LyriaClient(mockConfigService as any);
    const result = await client.generate({ prompt: 'vertex groove', durationSeconds: 30, seed: 123 });

    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
    expect(result.provider).toBe('lyria-3-pro-preview');
    expect(result.durationSeconds).toBe(30);
    expect(result.sampleRate).toBe(44_100);
    expect(result.mimeType).toBe('audio/mpeg');
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

  it('does not fall back when Vertex fails with a non-not-found error', async () => {
    setConfig({
      LYRIA_PROJECT_ID: 'resonate-vertex',
      LYRIA_LOCATION: 'us-central1',
    });
    mockGenerateContent.mockRejectedValueOnce({ error: { code: 429, status: 'RESOURCE_EXHAUSTED' } });

    client = new LyriaClient(mockConfigService as any);

    await expect(client.generate({ prompt: 'vertex quota fail', durationSeconds: 30 })).rejects.toEqual({
      error: { code: 429, status: 'RESOURCE_EXHAUSTED' },
    });
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
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
