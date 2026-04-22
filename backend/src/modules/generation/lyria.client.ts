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
   * audio chunks → stop. Lyria returns raw PCM chunks, so we wrap them in
   * a standard WAV container before handing them off to storage/playback.
   *
   * @returns WAV audio bytes and generation metadata
   */
  async generate(params: LyriaGenerationParams): Promise<LyriaGenerationResult> {
    const { prompt, negativePrompt, seed } = params;
    const actualSeed = seed ?? Math.floor(Math.random() * 2147483647);

    this.logger.log(`Generating audio: prompt="${prompt.substring(0, 50)}..." seed=${actualSeed}`);

    // Collect audio chunks from the realtime session
    const audioChunks: Buffer[] = [];
    let filteredPromptReason: string | null = null;
    let setupCompleted = false;
    let sessionClosed = false;
    let sessionError: string | null = null;

    const session = await this.client.live.music.connect({
      model: 'models/lyria-realtime-exp',
      callbacks: {
        onmessage: (message: any) => {
          if (message.setupComplete) {
            setupCompleted = true;
          }

          if (message.filteredPrompt) {
            filteredPromptReason =
              message.filteredPrompt.filteredReason ||
              'Prompt was filtered by the Lyria API';
            this.logger.warn(
              `Lyria filtered prompt "${message.filteredPrompt.text || prompt.substring(0, 80)}": ${filteredPromptReason}`,
            );
          }

          if (message.serverContent?.audioChunks) {
            for (const chunk of message.serverContent.audioChunks) {
              audioChunks.push(Buffer.from(chunk.data, 'base64'));
            }
          }
        },
        onerror: (error: any) => {
          sessionError = error instanceof Error ? error.message : String(error);
          this.logger.error(`Lyria session error: ${error}`);
        },
        onclose: () => {
          sessionClosed = true;
          if (!setupCompleted) {
            this.logger.warn('Lyria session closed before setup completed');
          }
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
        seed: actualSeed,
      },
    });

    // Start generation and collect for ~30 seconds
    await session.play();

    // Wait for audio generation to complete
    await new Promise<void>((resolve) => setTimeout(resolve, this.generationWaitMs));

    await session.stop();

    if (audioChunks.length === 0) {
      if (filteredPromptReason) {
        throw new Error(`Lyria prompt was filtered: ${filteredPromptReason}`);
      }
      if (sessionError) {
        throw new Error(`Lyria session error before audio generation: ${sessionError}`);
      }
      if (sessionClosed && !setupCompleted) {
        throw new Error('Lyria session closed before audio generation started');
      }
      throw new Error('Lyria API returned no audio chunks');
    }

    const pcmBytes = Buffer.concat(audioChunks);
    const audioBytes = this.wrapPcmAsWav(pcmBytes, 48_000, 2, 16);
    this.logger.log(
      `Generated ${pcmBytes.length} bytes of PCM audio (${audioChunks.length} chunks), wrapped to ${audioBytes.length} bytes WAV`,
    );

    return {
      audioBytes,
      synthIdPresent: true, // Lyria always embeds SynthID
      seed: actualSeed,
      durationSeconds: 30,
      sampleRate: 48000,
    };
  }

  private wrapPcmAsWav(
    pcmData: Buffer,
    sampleRate: number,
    channels: number,
    bitDepth: number,
  ): Buffer {
    const bytesPerSample = bitDepth / 8;
    const blockAlign = channels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;

    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + pcmData.length, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(channels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(bitDepth, 34);
    header.write('data', 36);
    header.writeUInt32LE(pcmData.length, 40);

    return Buffer.concat([header, pcmData]);
  }
}
