import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI } from '@google/genai';
import { randomUUID } from 'crypto';
import { EventBus } from '../shared/event_bus';
import { RealtimeAudioEvent, RealtimeDisconnectedEvent } from '../../events/event_types';

/** Verified identity and connection that own a realtime session. */
export interface RealtimeSessionOwner {
  userId: string;
  socketId: string;
}

/** Parameters for starting a realtime session */
export interface RealtimeSessionParams {
  trackId: string;
  owner: RealtimeSessionOwner;
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
  socketId: string;
  trackId: string;
  sdkSession: any | null; // @google/genai music session
  controls: Required<RealtimeControlUpdate>;
  chunks: Buffer[];
  isRecording: boolean;
  isActive: boolean;
  lastActivity: number;
  cleanupTimer?: ReturnType<typeof setTimeout>;
  disconnectPublished: boolean;
}

class RealtimeSessionCancelledError extends Error {
  constructor() {
    super('Realtime session was cancelled');
    this.name = 'RealtimeSessionCancelledError';
  }
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
  private shuttingDown = false;

  constructor(
    private readonly configService: ConfigService,
    private readonly eventBus: EventBus,
  ) {
    this.apiKey = this.configService.get<string>('GOOGLE_AI_API_KEY', '');
    this.client = new GoogleGenAI({ apiKey: this.apiKey, apiVersion: 'v1alpha' });
  }

  onModuleDestroy() {
    this.shuttingDown = true;

    // Use the internal cleanup path so shutdown never needs a caller-owned
    // context and pending provider connections cannot revive a session.
    for (const session of Array.from(this.sessions.values())) {
      this.cleanupSession(session, { publishDisconnect: false });
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
    if (
      this.shuttingDown ||
      !this.isValidOwner(params?.owner) ||
      !this.isValidString(params?.trackId)
    ) {
      throw new Error('Invalid realtime session request');
    }

    const sessionId = `rt_${randomUUID()}`;

    if (!this.isAvailable()) {
      this.logger.warn('Lyria RealTime API not configured (no API key), creating mock session');
    }

    const session: RealtimeSession = {
      id: sessionId,
      userId: params.owner.userId,
      socketId: params.owner.socketId,
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
      disconnectPublished: false,
    };

    this.sessions.set(sessionId, session);

    // Attempt to connect via SDK
    try {
      await this.connectSession(session);
      this.assertCurrentActiveSession(session);
      this.logger.log(`Started realtime session ${sessionId} for user ${params.owner.userId}`);
    } catch (error) {
      if (error instanceof RealtimeSessionCancelledError || !this.isCurrentActiveSession(session)) {
        throw new RealtimeSessionCancelledError();
      }

      this.logger.warn(`Failed to connect to Lyria RealTime API: ${error}. Session ${sessionId} in degraded mode.`);
      // Session stays active but in degraded mode (no SDK session)
      // Frontend can still use existing stems
    }

    this.assertCurrentActiveSession(session);

    // Start idle timeout
    this.resetIdleTimeout(session);

    return sessionId;
  }

  /**
   * Update generation controls for an active session.
   */
  async updateControls(sessionId: string, owner: RealtimeSessionOwner, update: RealtimeControlUpdate): Promise<void> {
    const session = this.requireOwnedActiveSession(sessionId, owner);

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
  startRecording(sessionId: string, owner: RealtimeSessionOwner): void {
    const session = this.requireOwnedActiveSession(sessionId, owner);

    session.isRecording = true;
    session.chunks = []; // Clear previous recording
    this.logger.log(`Started recording session ${sessionId}`);
  }

  /**
   * Stop recording and return the recorded audio as a WAV buffer.
   */
  stopRecording(sessionId: string, owner: RealtimeSessionOwner): Buffer {
    const session = this.requireOwnedActiveSession(sessionId, owner);

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
  stopSession(sessionId: string, owner: RealtimeSessionOwner): void {
    const session = this.requireOwnedActiveSession(sessionId, owner);
    this.cleanupSession(session, { publishDisconnect: false });
    this.logger.log(`Stopped realtime session ${sessionId}`);
  }

  /**
   * Internal lifecycle cleanup for a disconnected socket. Sessions are added
   * to the map before provider setup begins, so this also cancels pending
   * starts.
   */
  stopSessionsForSocket(socketId: string): void {
    if (!this.isValidString(socketId)) return;

    for (const session of Array.from(this.sessions.values())) {
      if (session.socketId === socketId) {
        this.cleanupSession(session, { publishDisconnect: false });
        this.logger.log(`Cleaned up realtime session ${session.id} for disconnected client ${socketId}`);
      }
    }
  }

  /**
   * Get current session state (for frontend sync).
   */
  getSessionState(sessionId: string, owner: RealtimeSessionOwner): { controls: Required<RealtimeControlUpdate>; isRecording: boolean; isActive: boolean } | null {
    const session = this.getOwnedActiveSession(sessionId, owner);
    if (!session) return null;
    return {
      controls: { ...session.controls },
      isRecording: session.isRecording,
      isActive: session.isActive,
    };
  }

  // ============ Private Helpers ============

  private isValidString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0 && value.length <= 256;
  }

  private isValidOwner(value: unknown): value is RealtimeSessionOwner {
    if (!value || typeof value !== 'object') return false;
    const owner = value as Partial<RealtimeSessionOwner>;
    return this.isValidString(owner.userId) && this.isValidString(owner.socketId);
  }

  private isCurrentActiveSession(session: RealtimeSession): boolean {
    return this.sessions.get(session.id) === session && session.isActive;
  }

  private assertCurrentActiveSession(session: RealtimeSession): void {
    if (!this.isCurrentActiveSession(session)) {
      throw new RealtimeSessionCancelledError();
    }
  }

  private getOwnedActiveSession(
    sessionId: unknown,
    owner: unknown,
  ): RealtimeSession | null {
    if (!this.isValidString(sessionId) || !this.isValidOwner(owner)) {
      return null;
    }

    const session = this.sessions.get(sessionId);
    if (
      !session ||
      !session.isActive ||
      session.userId !== owner.userId ||
      session.socketId !== owner.socketId
    ) {
      return null;
    }

    return session;
  }

  private requireOwnedActiveSession(
    sessionId: unknown,
    owner: unknown,
  ): RealtimeSession {
    const session = this.getOwnedActiveSession(sessionId, owner);
    if (!session) {
      // Keep unknown, inactive, and non-owned sessions indistinguishable.
      throw new Error('Realtime session unavailable');
    }
    return session;
  }

  private stopSdkSession(sdkSession: any): void {
    if (!sdkSession || typeof sdkSession.stop !== 'function') return;

    try {
      const result = sdkSession.stop();
      if (result && typeof result.catch === 'function') {
        result.catch(() => undefined);
      }
    } catch {
      // Provider shutdown is best effort during lifecycle cleanup.
    }
  }

  private publishDisconnected(session: RealtimeSession, reason: string): void {
    if (session.disconnectPublished) return;
    session.disconnectPublished = true;
    this.eventBus.publish({
      eventName: 'realtime.disconnected',
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      sessionId: session.id,
      userId: session.userId,
      reason,
    } satisfies RealtimeDisconnectedEvent);
  }

  private cleanupSession(
    session: RealtimeSession,
    options: { publishDisconnect: boolean; reason?: string; stopProvider?: boolean },
  ): void {
    if (this.sessions.get(session.id) !== session) return;

    // Remove first so provider callbacks and pending setup cannot publish or
    // store data after this session has been cancelled.
    this.sessions.delete(session.id);
    session.isActive = false;
    session.isRecording = false;

    if (session.cleanupTimer) {
      clearTimeout(session.cleanupTimer);
      session.cleanupTimer = undefined;
    }

    const sdkSession = session.sdkSession;
    session.sdkSession = null;
    session.chunks = [];

    if (options.stopProvider !== false) {
      this.stopSdkSession(sdkSession);
    }

    if (options.publishDisconnect) {
      this.publishDisconnected(session, options.reason ?? 'Connection lost');
    }
  }

  /**
   * Connect to the Lyria RealTime API via @google/genai SDK.
   */
  private async connectSession(session: RealtimeSession): Promise<void> {
    if (!this.apiKey) {
      // No API key configured — session works in degraded mode
      return;
    }

    this.assertCurrentActiveSession(session);

    const sdkSession = await this.client.live.music.connect({
      model: 'models/lyria-realtime-exp',
      callbacks: {
        onmessage: (message: any) => {
          if (message.serverContent?.audioChunks) {
            for (const chunk of message.serverContent.audioChunks) {
              if (!this.isCurrentActiveSession(session) || typeof chunk?.data !== 'string') {
                return;
              }

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

              if (this.isCurrentActiveSession(session)) {
                session.lastActivity = Date.now();
              }
            }
          }
        },
        onerror: (error: any) => {
          this.logger.error(`Lyria RealTime error in session ${session.id}: ${error}`);
        },
        onclose: () => {
          this.logger.log(`Lyria RealTime closed for session ${session.id}`);
          if (this.isCurrentActiveSession(session)) {
            this.logger.warn(`Unexpected close for session ${session.id}, cleaning up`);
            this.cleanupSession(session, {
              publishDisconnect: true,
              reason: 'Connection lost',
              stopProvider: false,
            });
          }
        },
      },
    });

    if (!this.isCurrentActiveSession(session)) {
      this.stopSdkSession(sdkSession);
      throw new RealtimeSessionCancelledError();
    }

    session.sdkSession = sdkSession;

    try {
      this.assertCurrentActiveSession(session);

      // Set initial prompt based on track context
      await sdkSession.setWeightedPrompts({
        weightedPrompts: [
          { text: `${session.controls.key} music`, weight: 1.0 },
        ],
      });

      this.assertCurrentActiveSession(session);

      // Set initial configuration
      await sdkSession.setMusicGenerationConfig({
        musicGenerationConfig: {
          bpm: session.controls.bpm,
          density: session.controls.density / 100,
          brightness: session.controls.brightness / 100,
        },
      });

      this.assertCurrentActiveSession(session);

      // Start playback
      await sdkSession.play();
      this.assertCurrentActiveSession(session);
    } catch (error) {
      if (session.sdkSession === sdkSession) {
        session.sdkSession = null;
      }
      this.stopSdkSession(sdkSession);

      if (error instanceof RealtimeSessionCancelledError || !this.isCurrentActiveSession(session)) {
        throw new RealtimeSessionCancelledError();
      }
      throw error;
    }
  }

  /**
   * Reset the idle timeout for a session.
   */
  private resetIdleTimeout(session: RealtimeSession): void {
    if (session.cleanupTimer) {
      clearTimeout(session.cleanupTimer);
    }
    session.cleanupTimer = setTimeout(() => {
      if (this.isCurrentActiveSession(session)) {
        this.logger.warn(`Session ${session.id} idle timeout, stopping`);
        this.cleanupSession(session, {
          publishDisconnect: true,
          reason: 'Idle timeout',
        });
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
