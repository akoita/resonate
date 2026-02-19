import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

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
 * Wrapper service for Google Vertex AI Lyria 002 model.
 *
 * Uses the Vertex AI REST API with `google-auth-library` for authentication.
 * The Lyria model generates 30-second 48kHz WAV clips from text prompts.
 */
@Injectable()
export class LyriaClient {
  private readonly logger = new Logger(LyriaClient.name);
  private readonly projectId: string;
  private readonly location: string;
  private readonly modelId: string;

  constructor(private readonly configService: ConfigService) {
    this.projectId = this.configService.get<string>('LYRIA_PROJECT_ID', '');
    this.location = this.configService.get<string>('LYRIA_LOCATION', 'us-central1');
    this.modelId = this.configService.get<string>('LYRIA_MODEL_ID', 'lyria-002');
  }

  /**
   * Generate music from a text prompt via Vertex AI Lyria 002.
   *
   * @returns WAV audio bytes and generation metadata
   */
  async generate(params: LyriaGenerationParams): Promise<LyriaGenerationResult> {
    const { prompt, negativePrompt, seed } = params;
    const actualSeed = seed ?? Math.floor(Math.random() * 2147483647);

    this.logger.log(`Generating audio: prompt="${prompt.substring(0, 50)}..." seed=${actualSeed}`);

    const endpoint = `https://${this.location}-aiplatform.googleapis.com/v1/projects/${this.projectId}/locations/${this.location}/publishers/google/models/${this.modelId}:predict`;

    // Obtain access token via google-auth-library
    const { GoogleAuth } = await import('google-auth-library');
    const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
    const client = await auth.getClient();
    const accessToken = (await client.getAccessToken()).token;

    if (!accessToken) {
      throw new Error('Failed to obtain GCP access token for Lyria API');
    }

    const requestBody = {
      instances: [
        {
          prompt,
          ...(negativePrompt ? { negative_prompt: negativePrompt } : {}),
          seed: actualSeed,
        },
      ],
      parameters: {
        sampleRate: 48000,
        durationSeconds: 30,
      },
    };

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      this.logger.error(`Lyria API error ${response.status}: ${errorBody}`);
      throw new Error(`Lyria API returned ${response.status}: ${errorBody}`);
    }

    const responseData = await response.json() as any;

    // Extract audio bytes from the Vertex AI response
    const prediction = responseData.predictions?.[0];
    if (!prediction?.audioContent) {
      throw new Error('Lyria API response missing audioContent');
    }

    const audioBytes = Buffer.from(prediction.audioContent, 'base64');
    this.logger.log(`Generated ${audioBytes.length} bytes of audio`);

    return {
      audioBytes,
      synthIdPresent: prediction.synthIdPresent ?? true,
      seed: actualSeed,
      durationSeconds: 30,
      sampleRate: 48000,
    };
  }
}
