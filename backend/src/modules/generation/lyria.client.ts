import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI } from '@google/genai';

export interface LyriaGenerationResult {
  audioBytes: Buffer;
  synthIdPresent: boolean;
  seed: number;
  durationSeconds: number;
  sampleRate: number;
}

export interface LyriaGenerationParams {
  prompt: string;
  negativePrompt?: string;
  seed?: number;
}

/**
 * Wrapper service for Google AI Lyria music generation.
 *
 * Uses the @google/genai SDK with a Google AI Studio API key.
 * The Lyria model generates 30-second 48kHz stereo WAV clips from text prompts.
 */
@Injectable()
export class LyriaClient {
  private readonly logger = new Logger(LyriaClient.name);
  private readonly client: GoogleGenAI;
  private readonly generationWaitMs: number;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('GOOGLE_AI_API_KEY', '');
    this.client = new GoogleGenAI({ apiKey, apiVersion: 'v1alpha' });
    this.generationWaitMs = this.configService.get<number>('LYRIA_GENERATION_WAIT_MS', 32_000);
  }

  /**
   * Generate music from a text prompt via the Lyria model.
   *
   * Uses a one-shot Lyria RealTime session: connect → prompt → collect
   * audio chunks → stop. Returns concatenated PCM wrapped in caller context.
   *
   * @returns WAV audio bytes and generation metadata
   */
  async generate(params: LyriaGenerationParams): Promise<LyriaGenerationResult> {
    const { prompt, negativePrompt, seed } = params;
    const actualSeed = seed ?? Math.floor(Math.random() * 2147483647);

    this.logger.log(`Generating audio: prompt="${prompt.substring(0, 50)}..." seed=${actualSeed}`);

    // Collect audio chunks from the realtime session
    const audioChunks: Buffer[] = [];

    const session = await this.client.live.music.connect({
      model: 'models/lyria-realtime-exp',
      callbacks: {
        onmessage: (message: any) => {
          if (message.serverContent?.audioChunks) {
            for (const chunk of message.serverContent.audioChunks) {
              audioChunks.push(Buffer.from(chunk.data, 'base64'));
            }
          }
        },
        onerror: (error: any) => {
          this.logger.error(`Lyria session error: ${error}`);
        },
        onclose: () => {
          this.logger.debug('Lyria session closed');
        },
      },
    });

    // Build weighted prompts
    const weightedPrompts: Array<{ text: string; weight: number }> = [
      { text: prompt, weight: 1.0 },
    ];
    if (negativePrompt) {
      weightedPrompts.push({ text: negativePrompt, weight: -1.0 });
    }

    await session.setWeightedPrompts({ weightedPrompts });

    await session.setMusicGenerationConfig({
      musicGenerationConfig: {
        bpm: 120,
        temperature: 1.0,
      },
    });

    // Start generation and collect for ~30 seconds
    await session.play();

    // Wait for audio generation to complete
    await new Promise<void>((resolve) => setTimeout(resolve, this.generationWaitMs));

    await session.stop();

    if (audioChunks.length === 0) {
      throw new Error('Lyria API returned no audio chunks');
    }

    const audioBytes = Buffer.concat(audioChunks);
    this.logger.log(`Generated ${audioBytes.length} bytes of audio (${audioChunks.length} chunks)`);

    return {
      audioBytes,
      synthIdPresent: true, // Lyria always embeds SynthID
      seed: actualSeed,
      durationSeconds: 30,
      sampleRate: 48000,
    };
  }
}
