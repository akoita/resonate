import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI } from '@google/genai';
import { GoogleAuth } from 'google-auth-library';
import { SupportedGenerationDuration } from './generation.dto';

export interface LyriaGenerationResult {
  audioBytes: Buffer;
  mimeType: string;
  synthIdPresent: boolean;
  seed: number;
  durationSeconds: number;
  sampleRate: number;
  provider: 'lyria-002' | 'lyria-3-pro-preview';
  lyrics: string[];
}

export interface LyriaGenerationParams {
  prompt: string;
  negativePrompt?: string;
  seed?: number;
  durationSeconds?: SupportedGenerationDuration;
}

/**
 * Wrapper service for Google AI Lyria music generation.
 *
 * Uses the @google/genai SDK against Vertex AI via ADC when project/location
 * are configured, and falls back to the Google AI Studio API key path for
 * local/non-Vertex environments.
 * Lyria 3 Pro uses generateContent and returns inline audio data for clips up to
 * a few minutes when prompted for duration/structure.
 */
@Injectable()
export class LyriaClient {
  private readonly logger = new Logger(LyriaClient.name);
  private readonly apiClient: GoogleGenAI | null;
  private readonly vertexProject: string;
  private readonly vertexLocation: string;
  private readonly vertexAuth: GoogleAuth | null;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('GOOGLE_AI_API_KEY', '');
    this.vertexProject = this.configService.get<string>('LYRIA_PROJECT_ID', '');
    this.vertexLocation = this.configService.get<string>('LYRIA_LOCATION', '');

    this.vertexAuth =
      this.vertexProject && this.vertexLocation
        ? new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] })
        : null;
    this.apiClient = apiKey ? new GoogleGenAI({ apiKey, apiVersion: 'v1beta' }) : null;

    if (this.vertexAuth) {
      this.logger.log(`Configured Lyria client for Vertex AI (${this.vertexProject}/${this.vertexLocation}) via ADC`);
    } else if (this.apiClient) {
      this.logger.warn('Configured Lyria client with GOOGLE_AI_API_KEY fallback; Vertex AI ADC not enabled');
    } else {
      this.logger.warn('Lyria client has no Vertex AI config or GOOGLE_AI_API_KEY fallback');
    }
  }

  /**
   * Generate music from a text prompt via the Lyria model.
   *
   * Uses Lyria 3 Pro via generateContent so we can request longer songs.
   * The model returns inline audio data with its own mime type; we preserve that
   * instead of forcing an unsupported responseMimeType.
   *
   * @returns Audio bytes and generation metadata
   */
  async generate(params: LyriaGenerationParams): Promise<LyriaGenerationResult> {
    const { prompt, negativePrompt, seed, durationSeconds = 30 } = params;
    const actualSeed = seed ?? Math.floor(Math.random() * 2147483647);
    if (durationSeconds === 30 && this.vertexAuth) {
      return this.generateWithVertexLyria2({ prompt, negativePrompt, seed: actualSeed });
    }

    if (this.apiClient) {
      return this.generateWithGeminiLyria3({
        prompt,
        negativePrompt,
        seed: actualSeed,
        durationSeconds,
      });
    }

    if (this.vertexAuth) {
      throw new Error(
        'Longer-than-30-second Lyria generation requires the Gemini API key path; Vertex ADC currently supports 30-second lyria-002 clips only.',
      );
    }

    throw new Error('Lyria generation is not configured');
  }

  private async generateWithGeminiLyria3(params: {
    prompt: string;
    negativePrompt?: string;
    seed: number;
    durationSeconds: SupportedGenerationDuration;
  }): Promise<LyriaGenerationResult> {
    const { prompt, negativePrompt, seed, durationSeconds } = params;
    const composedPrompt = this.buildPrompt(prompt, durationSeconds, negativePrompt);

    this.logger.log(
      `Generating audio with Lyria 3 Pro: duration=${durationSeconds}s prompt="${prompt.substring(0, 80)}..." seed=${seed}`,
    );

    const response = await this.apiClient!.models.generateContent({
      model: 'lyria-3-pro-preview',
      contents: composedPrompt,
      config: {
        responseModalities: ['AUDIO', 'TEXT'],
      },
    });

    const parts = response.candidates?.[0]?.content?.parts ?? [];
    const lyrics: string[] = [];
    let audioBytes: Buffer | null = null;
    let mimeType: string | undefined;

    for (const part of parts) {
      if (part.text) {
        lyrics.push(part.text);
      } else if (part.inlineData?.data) {
        audioBytes = Buffer.from(part.inlineData.data, 'base64');
        mimeType = part.inlineData.mimeType || mimeType;
      }
    }

    if (!audioBytes || audioBytes.length === 0) {
      const blockReason = response.promptFeedback?.blockReason;
      if (blockReason) {
        throw new Error(`Lyria prompt was blocked: ${blockReason}`);
      }
      throw new Error('Lyria 3 returned no audio data');
    }

    this.logger.log(
      `Generated ${audioBytes.length} bytes of ${mimeType || 'audio'} via Lyria 3 Pro (${durationSeconds}s target, ${lyrics.length} text parts)`,
    );

    return {
      audioBytes,
      mimeType: mimeType || this.detectAudioMimeType(audioBytes),
      synthIdPresent: true, // Lyria always embeds SynthID
      seed,
      durationSeconds,
      sampleRate: 44_100,
      provider: 'lyria-3-pro-preview',
      lyrics,
    };
  }

  private async generateWithVertexLyria2(params: {
    prompt: string;
    negativePrompt?: string;
    seed: number;
  }): Promise<LyriaGenerationResult> {
    const { prompt, negativePrompt, seed } = params;
    this.logger.log(
      `Generating audio with Vertex Lyria 2: duration=30s prompt="${prompt.substring(0, 80)}..." seed=${seed}`,
    );

    const token = await this.vertexAuth!.getAccessToken();
    if (!token) {
      throw new Error('Vertex AI ADC did not provide an access token for Lyria generation');
    }

    const endpoint =
      `https://${this.vertexLocation}-aiplatform.googleapis.com/v1/projects/${this.vertexProject}` +
      `/locations/${this.vertexLocation}/publishers/google/models/lyria-002:predict`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        instances: [
          {
            prompt: prompt.trim(),
            ...(negativePrompt?.trim() ? { negative_prompt: negativePrompt.trim() } : {}),
            seed,
          },
        ],
        parameters: {},
      }),
    });

    if (!response.ok) {
      let errorPayload: unknown = null;
      try {
        errorPayload = await response.json();
      } catch {
        errorPayload = await response.text();
      }
      throw new Error(
        typeof errorPayload === 'string' && errorPayload
          ? errorPayload
          : JSON.stringify(errorPayload),
      );
    }

    const payload = (await response.json()) as {
      predictions?: Array<{
        audioContent?: string;
        bytesBase64Encoded?: string;
        mimeType?: string;
      }>;
    };
    const prediction = payload.predictions?.[0];
    const encodedAudio = prediction?.audioContent || prediction?.bytesBase64Encoded;
    if (!encodedAudio) {
      throw new Error('Vertex Lyria 2 returned no audio data');
    }

    const audioBytes = Buffer.from(encodedAudio, 'base64');
    const mimeType = prediction.mimeType || this.detectAudioMimeType(audioBytes);

    this.logger.log(`Generated ${audioBytes.length} bytes of ${mimeType} via Vertex Lyria 2`);

    return {
      audioBytes,
      mimeType,
      synthIdPresent: true,
      seed,
      durationSeconds: 30,
      sampleRate: 48_000,
      provider: 'lyria-002',
      lyrics: [],
    };
  }

  private buildPrompt(
    prompt: string,
    durationSeconds: SupportedGenerationDuration,
    negativePrompt?: string,
  ): string {
    const durationLabel =
      durationSeconds >= 60
        ? `${durationSeconds / 60}-minute`
        : `${durationSeconds}-second`;

    const parts = [
      `Create a ${durationLabel} track.`,
      prompt.trim(),
    ];

    if (negativePrompt?.trim()) {
      parts.push(`Avoid these elements: ${negativePrompt.trim()}.`);
    }

    return parts.join(' ');
  }

  private detectAudioMimeType(audioBytes: Buffer): string {
    if (
      audioBytes.length >= 12 &&
      audioBytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
      audioBytes.subarray(8, 12).toString('ascii') === 'WAVE'
    ) {
      return 'audio/wav';
    }

    if (
      audioBytes.length >= 3 &&
      audioBytes.subarray(0, 3).toString('ascii') === 'ID3'
    ) {
      return 'audio/mpeg';
    }

    if (audioBytes.length >= 2 && audioBytes[0] === 0xff && (audioBytes[1] & 0xe0) === 0xe0) {
      return 'audio/mpeg';
    }

    return 'audio/mpeg';
  }
}
