import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface SynthIdResult {
  /** Whether SynthID watermark was detected */
  isAiGenerated: boolean;
  /** Confidence score (0-1) */
  confidence: number;
  /** Detected AI provider (if identifiable) */
  provider?: string;
  /** Raw API response for debugging */
  rawResponse?: Record<string, unknown>;
}

/**
 * Service for verifying SynthID watermarks in audio content.
 * 
 * SynthID is Google's watermarking technology embedded in AI-generated audio.
 * This service wraps Google's SynthID verification API to detect whether
 * uploaded audio contains a SynthID watermark.
 * 
 * Use cases:
 * - Verify AI-generated stems during upload
 * - Content moderation (flag misattributed AI content)
 * - Display verification badges in marketplace
 */
@Injectable()
export class SynthIdService {
  private readonly logger = new Logger(SynthIdService.name);
  private readonly projectId: string;
  private readonly location: string;

  constructor(private readonly configService: ConfigService) {
    this.projectId = this.configService.get<string>('LYRIA_PROJECT_ID', '');
    this.location = this.configService.get<string>('LYRIA_LOCATION', 'us-central1');
  }

  /**
   * Check whether SynthID verification is available.
   */
  isAvailable(): boolean {
    return !!this.projectId;
  }

  /**
   * Verify whether an audio buffer contains a SynthID watermark.
   * 
   * @param audioBuffer - Raw audio bytes (WAV, MP3, or other supported format)
   * @returns Verification result with confidence score
   */
  async verify(audioBuffer: Buffer): Promise<SynthIdResult> {
    if (!this.isAvailable()) {
      this.logger.warn('SynthID verification not configured (no project ID)');
      return {
        isAiGenerated: false,
        confidence: 0,
        provider: undefined,
      };
    }

    try {
      // Obtain access token
      const { GoogleAuth } = await import('google-auth-library');
      const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
      const client = await auth.getClient();
      const accessToken = (await client.getAccessToken()).token;

      if (!accessToken) {
        throw new Error('Failed to obtain GCP access token for SynthID API');
      }

      const endpoint = `https://${this.location}-aiplatform.googleapis.com/v1/projects/${this.projectId}/locations/${this.location}/publishers/google/models/synthid-audio:verify`;

      const audioBase64 = audioBuffer.toString('base64');

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          instances: [
            {
              audioContent: audioBase64,
            },
          ],
        }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        this.logger.error(`SynthID API error ${response.status}: ${errorBody}`);
        // Non-blocking: return negative result on API error
        return {
          isAiGenerated: false,
          confidence: 0,
          rawResponse: { error: errorBody, status: response.status },
        };
      }

      const responseData = await response.json() as any;
      const prediction = responseData.predictions?.[0];

      if (!prediction) {
        this.logger.warn('SynthID API returned no predictions');
        return {
          isAiGenerated: false,
          confidence: 0,
          rawResponse: responseData,
        };
      }

      const confidence = prediction.confidence ?? prediction.score ?? 0;
      const isAiGenerated = confidence > 0.5; // Threshold for positive detection

      this.logger.log(`SynthID verification: isAI=${isAiGenerated}, confidence=${confidence}`);

      return {
        isAiGenerated,
        confidence,
        provider: prediction.provider || (isAiGenerated ? 'google-lyria' : undefined),
        rawResponse: prediction,
      };
    } catch (error) {
      this.logger.error(`SynthID verification failed: ${error}`);
      // Non-blocking: return negative result on error
      return {
        isAiGenerated: false,
        confidence: 0,
      };
    }
  }

  /**
   * Verify a stem by its ID (reads audio from storage).
   */
  async verifyStemById(stemId: string): Promise<SynthIdResult> {
    // Lazy import prisma to avoid circular deps
    const { prisma } = await import('../../db/prisma');

    const stem = await prisma.stem.findUnique({
      where: { id: stemId },
      select: { uri: true, storageProvider: true },
    });

    if (!stem?.uri) {
      throw new Error(`Stem ${stemId} not found or has no URI`);
    }

    // Fetch audio bytes from storage URI
    let audioBuffer: Buffer;
    if (stem.uri.startsWith('http')) {
      const response = await fetch(stem.uri);
      if (!response.ok) {
        throw new Error(`Failed to fetch stem audio: ${response.status}`);
      }
      audioBuffer = Buffer.from(await response.arrayBuffer());
    } else {
      // Local file
      const { readFile } = await import('fs/promises');
      const { join } = await import('path');
      const path = stem.uri.startsWith('/') ? stem.uri : join(process.cwd(), stem.uri);
      audioBuffer = await readFile(path);
    }

    return this.verify(audioBuffer);
  }
}
