import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI } from '@google/genai';
import { SupportedGenerationDuration } from './generation.dto';

export interface LyriaGenerationResult {
  audioBytes: Buffer;
  mimeType: string;
  synthIdPresent: boolean;
  seed: number;
  durationSeconds: number;
  sampleRate: number;
  provider: 'lyria-3-pro-preview';
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
  private readonly client: GoogleGenAI;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('GOOGLE_AI_API_KEY', '');
    const project = this.configService.get<string>('LYRIA_PROJECT_ID', '');
    const location = this.configService.get<string>('LYRIA_LOCATION', '');

    if (project && location) {
      this.client = new GoogleGenAI({
        vertexai: true,
        project,
        location,
        apiVersion: 'v1beta',
      });
      this.logger.log(`Configured Lyria client for Vertex AI (${project}/${location}) via ADC`);
      return;
    }

    this.client = new GoogleGenAI({ apiKey, apiVersion: 'v1beta' });
    if (apiKey) {
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
    const composedPrompt = this.buildPrompt(prompt, durationSeconds, negativePrompt);

    this.logger.log(
      `Generating audio with Lyria 3 Pro: duration=${durationSeconds}s prompt="${prompt.substring(0, 80)}..." seed=${actualSeed}`,
    );

    const response = await this.client.models.generateContent({
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
      seed: actualSeed,
      durationSeconds,
      sampleRate: 44_100,
      provider: 'lyria-3-pro-preview',
      lyrics,
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
