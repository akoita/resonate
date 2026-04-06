import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI } from '@google/genai';
import { EventBus } from '../shared/event_bus';
import { RealtimeAudioEvent, RealtimeDisconnectedEvent } from '../../events/event_types';

/** Parameters for starting a realtime session */
export interface RealtimeSessionParams {
  trackId: string;
  userId: string;
  bpm?: number;
  key?: string;
  density?: number;
  brightness?: number;
}

/** Control update parameters */
export interface RealtimeControlUpdate {
  bpm?: number;
  key?: string;
  density?: number;
  brightness?: number;
}

/** Active session state */
interface RealtimeSession {
  id: string;
  userId: string;
  trackId: string;
  sdkSession: any | null; // @google/genai music session
  controls: Required<RealtimeControlUpdate>;
  chunks: Buffer[];
  isRecording: boolean;
  isActive: boolean;
  lastActivity: number;
  cleanupTimer?: ReturnType<typeof setTimeout>;
}

/**
 * Manages Lyria RealTime sessions for live AI music generation.
 *
 * Uses the @google/genai SDK's `client.live.music.connect()` to establish
 * WebSocket sessions with the Lyria RealTime API. Streams audio chunks
 * back to the frontend via the EventBus. The service handles:
 * - Session lifecycle (start/stop/timeout) via SDK session controls
 * - Control mapping (BPM, key, density, brightness)
 * - Session recording (concatenate chunks into WAV)
 *
 * EXPERIMENTAL: Lyria RealTime API may change. The service degrades
 * gracefully if the API is unavailable.
 */
@Injectable()
export class LyriaRealtimeService implements OnModuleDestroy {
  private readonly logger = new Logger(LyriaRealtimeService.name);
  private readonly sessions = new Map<string, RealtimeSession>();
  private readonly client: GoogleGenAI;
  private readonly apiKey: string;
  private readonly idleTimeoutMs = 60_000; // 60s idle timeout

  constructor(
    private readonly configService: ConfigService,
    private readonly eventBus: EventBus,
  ) {
    this.apiKey = this.configService.get<string>('GOOGLE_AI_API_KEY', '');
    this.client = new GoogleGenAI({ apiKey: this.apiKey, apiVersion: 'v1alpha' });
  }

  onModuleDestroy() {
    // Clean up all active sessions on shutdown
    for (const [id] of this.sessions) {
      this.stopSession(id);
    }
  }

  /**
   * Check whether the Lyria RealTime API is configured and available.
   */
  isAvailable(): boolean {
    return !!this.apiKey;
  }

  /**
   * Start a new realtime generation session.
   *
   * Connects to the Lyria RealTime API via the @google/genai SDK and
   * begins streaming audio chunks. Emits `realtime.audio` events via EventBus.
   */
  async startSession(params: RealtimeSessionParams): Promise<string> {
    const sessionId = `rt_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    if (!this.isAvailable()) {
      this.logger.warn('Lyria RealTime API not configured (no API key), creating mock session');
    }

    const session: RealtimeSession = {
      id: sessionId,
      userId: params.userId,
      trackId: params.trackId,
      sdkSession: null,
      controls: {
        bpm: params.bpm ?? 120,
        key: params.key ?? 'C major',
        density: params.density ?? 50,
        brightness: params.brightness ?? 50,
      },
      chunks: [],
      isRecording: false,
      isActive: true,
      lastActivity: Date.now(),
    };

    this.sessions.set(sessionId, session);

    // Attempt to connect via SDK
    try {
      await this.connectSession(session);
      this.logger.log(`Started realtime session ${sessionId} for user ${params.userId}`);
    } catch (error) {
      this.logger.warn(`Failed to connect to Lyria RealTime API: ${error}. Session ${sessionId} in degraded mode.`);
      // Session stays active but in degraded mode (no SDK session)
      // Frontend can still use existing stems
    }

    // Start idle timeout
    this.resetIdleTimeout(session);

    return sessionId;
  }

  /**
   * Update generation controls for an active session.
   */
  async updateControls(sessionId: string, update: RealtimeControlUpdate): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session || !session.isActive) {
      throw new Error(`Session ${sessionId} not found or inactive`);
    }

    // Merge updates
    const bpmChanged = update.bpm !== undefined && update.bpm !== session.controls.bpm;
    const keyChanged = update.key !== undefined && update.key !== session.controls.key;

    if (update.bpm !== undefined) session.controls.bpm = Math.max(60, Math.min(200, update.bpm));
    if (update.key !== undefined) session.controls.key = update.key;
    if (update.density !== undefined) session.controls.density = Math.max(0, Math.min(100, update.density));
    if (update.brightness !== undefined) session.controls.brightness = Math.max(0, Math.min(100, update.brightness));

    session.lastActivity = Date.now();
    this.resetIdleTimeout(session);

    // Send control update to Lyria RealTime via SDK
    if (session.sdkSession) {
      try {
        await session.sdkSession.setMusicGenerationConfig({
          musicGenerationConfig: {
            bpm: session.controls.bpm,
            density: session.controls.density / 100,
            brightness: session.controls.brightness / 100,
          },
        });

        // BPM or key changes require context reset for the model to adapt
        if (bpmChanged || keyChanged) {
          await session.sdkSession.resetContext();
          this.logger.debug(`Reset context for session ${sessionId} (BPM/key change)`);
        }

        this.logger.debug(`Sent control update to session ${sessionId}`);
      } catch (error) {
        this.logger.error(`Failed to update controls for session ${sessionId}: ${error}`);
      }
    }
  }

  /**
   * Start recording the session output.
   */
  startRecording(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session || !session.isActive) {
      throw new Error(`Session ${sessionId} not found or inactive`);
    }

    session.isRecording = true;
    session.chunks = []; // Clear previous recording
    this.logger.log(`Started recording session ${sessionId}`);
  }

  /**
   * Stop recording and return the recorded audio as a WAV buffer.
   */
  stopRecording(sessionId: string): Buffer {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    session.isRecording = false;
    const pcmData = Buffer.concat(session.chunks);

    // Wrap PCM data in WAV header (48kHz, 16-bit, stereo)
    const wavBuffer = this.createWavHeader(pcmData, 48000, 2, 16);
    this.logger.log(`Stopped recording session ${sessionId}: ${wavBuffer.length} bytes`);

    session.chunks = [];
    return wavBuffer;
  }

  /**
   * Stop and clean up a session.
   */
  stopSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.isActive = false;

    // Stop SDK session
    if (session.sdkSession) {
      try {
        session.sdkSession.stop();
      } catch (e) {
        // Ignore stop errors
      }
      session.sdkSession = null;
    }

    // Clear timeout
    if (session.cleanupTimer) {
      clearTimeout(session.cleanupTimer);
    }

    this.sessions.delete(sessionId);
    this.logger.log(`Stopped realtime session ${sessionId}`);
  }

  /**
   * Get current session state (for frontend sync).
   */
  getSessionState(sessionId: string): { controls: Required<RealtimeControlUpdate>; isRecording: boolean; isActive: boolean } | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    return {
      controls: { ...session.controls },
      isRecording: session.isRecording,
      isActive: session.isActive,
    };
  }

  // ============ Private Helpers ============

  /**
   * Connect to the Lyria RealTime API via @google/genai SDK.
   */
  private async connectSession(session: RealtimeSession): Promise<void> {
    if (!this.apiKey) {
      // No API key configured — session works in degraded mode
      return;
    }

    const sdkSession = await this.client.live.music.connect({
      model: 'models/lyria-realtime-exp',
      callbacks: {
        onmessage: (message: any) => {
          if (message.serverContent?.audioChunks) {
            for (const chunk of message.serverContent.audioChunks) {
              const audioBuffer = Buffer.from(chunk.data, 'base64');

              // Store for recording
              if (session.isRecording) {
                session.chunks.push(audioBuffer);
              }

              // Emit to frontend via EventBus
              this.eventBus.publish({
                eventName: 'realtime.audio',
                eventVersion: 1,
                occurredAt: new Date().toISOString(),
                sessionId: session.id,
                userId: session.userId,
                chunk: chunk.data, // Keep as base64 for Socket.IO transport
                timestamp: Date.now(),
              } satisfies RealtimeAudioEvent);

              session.lastActivity = Date.now();
            }
          }
        },
        onerror: (error: any) => {
          this.logger.error(`Lyria RealTime error in session ${session.id}: ${error}`);
        },
        onclose: () => {
          this.logger.log(`Lyria RealTime closed for session ${session.id}`);
          session.sdkSession = null;

          // Auto-cleanup on unexpected close
          if (session.isActive) {
            this.logger.warn(`Unexpected close for session ${session.id}, marking inactive`);
            session.isActive = false;
            this.eventBus.publish({
              eventName: 'realtime.disconnected',
              eventVersion: 1,
              occurredAt: new Date().toISOString(),
              sessionId: session.id,
              userId: session.userId,
              reason: 'Connection lost',
            } satisfies RealtimeDisconnectedEvent);
          }
        },
      },
    });

    session.sdkSession = sdkSession;

    // Set initial prompt based on track context
    await sdkSession.setWeightedPrompts({
      weightedPrompts: [
        { text: `${session.controls.key} music`, weight: 1.0 },
      ],
    });

    // Set initial configuration
    await sdkSession.setMusicGenerationConfig({
      musicGenerationConfig: {
        bpm: session.controls.bpm,
        density: session.controls.density / 100,
        brightness: session.controls.brightness / 100,
      },
    });

    // Start playback
    await sdkSession.play();
  }

  /**
   * Reset the idle timeout for a session.
   */
  private resetIdleTimeout(session: RealtimeSession): void {
    if (session.cleanupTimer) {
      clearTimeout(session.cleanupTimer);
    }
    session.cleanupTimer = setTimeout(() => {
      if (session.isActive) {
        this.logger.warn(`Session ${session.id} idle timeout, stopping`);
        this.stopSession(session.id);
        this.eventBus.publish({
          eventName: 'realtime.disconnected',
          eventVersion: 1,
          occurredAt: new Date().toISOString(),
          sessionId: session.id,
          userId: session.userId,
          reason: 'Idle timeout',
        } satisfies RealtimeDisconnectedEvent);
      }
    }, this.idleTimeoutMs);
  }

  /**
   * Create a WAV file header for raw PCM data.
   */
  private createWavHeader(pcmData: Buffer, sampleRate: number, channels: number, bitDepth: number): Buffer {
    const dataLength = pcmData.length;
    const bytesPerSample = bitDepth / 8;
    const blockAlign = channels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;

    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + dataLength, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16); // Subchunk1Size
    header.writeUInt16LE(1, 20);  // AudioFormat (PCM)
    header.writeUInt16LE(channels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(bitDepth, 34);
    header.write('data', 36);
    header.writeUInt32LE(dataLength, 40);

    return Buffer.concat([header, pcmData]);
  }
}
