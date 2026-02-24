import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
  ws: WebSocket | null;
  controls: Required<RealtimeControlUpdate>;
  chunks: Buffer[];
  isRecording: boolean;
  isActive: boolean;
  lastActivity: number;
  cleanupTimer?: ReturnType<typeof setTimeout>;
}

/**
 * Manages Lyria RealTime WebSocket sessions for live AI music generation.
 * 
 * Each session opens a WebSocket to the Lyria RealTime API and streams
 * audio chunks back to the frontend via the EventBus. The service handles:
 * - Session lifecycle (start/stop/timeout)
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
  private readonly projectId: string;
  private readonly location: string;
  private readonly idleTimeoutMs = 60_000; // 60s idle timeout

  constructor(
    private readonly configService: ConfigService,
    private readonly eventBus: EventBus,
  ) {
    this.projectId = this.configService.get<string>('LYRIA_PROJECT_ID', '');
    this.location = this.configService.get<string>('LYRIA_LOCATION', 'us-central1');
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
    return !!this.projectId;
  }

  /**
   * Start a new realtime generation session.
   * 
   * Opens a WebSocket to the Lyria RealTime API and begins streaming
   * audio chunks. Emits `realtime.audio` events via EventBus.
   */
  async startSession(params: RealtimeSessionParams): Promise<string> {
    const sessionId = `rt_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    if (!this.isAvailable()) {
      this.logger.warn('Lyria RealTime API not configured, creating mock session');
    }

    const session: RealtimeSession = {
      id: sessionId,
      userId: params.userId,
      trackId: params.trackId,
      ws: null,
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

    // Attempt to connect to Lyria RealTime API
    try {
      await this.connectWebSocket(session);
      this.logger.log(`Started realtime session ${sessionId} for user ${params.userId}`);
    } catch (error) {
      this.logger.warn(`Failed to connect to Lyria RealTime API: ${error}. Session ${sessionId} in degraded mode.`);
      // Session stays active but in degraded mode (no WebSocket)
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
    if (update.bpm !== undefined) session.controls.bpm = Math.max(60, Math.min(200, update.bpm));
    if (update.key !== undefined) session.controls.key = update.key;
    if (update.density !== undefined) session.controls.density = Math.max(0, Math.min(100, update.density));
    if (update.brightness !== undefined) session.controls.brightness = Math.max(0, Math.min(100, update.brightness));

    session.lastActivity = Date.now();
    this.resetIdleTimeout(session);

    // Send control update to Lyria RealTime API
    if (session.ws && session.ws.readyState === WebSocket.OPEN) {
      const controlMessage = JSON.stringify({
        type: 'control_update',
        params: {
          bpm: session.controls.bpm,
          scale: session.controls.key,
          note_density: session.controls.density / 100,
          spectral_brightness: session.controls.brightness / 100,
        },
      });
      session.ws.send(controlMessage);
      this.logger.debug(`Sent control update to session ${sessionId}: ${controlMessage}`);
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

    // Wrap PCM data in WAV header (48kHz, 16-bit, mono)
    const wavBuffer = this.createWavHeader(pcmData, 48000, 1, 16);
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

    // Close WebSocket
    if (session.ws) {
      try {
        session.ws.close(1000, 'Session ended');
      } catch (e) {
        // Ignore close errors
      }
      session.ws = null;
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
   * Connect to the Lyria RealTime WebSocket API.
   */
  private async connectWebSocket(session: RealtimeSession): Promise<void> {
    if (!this.projectId) {
      // No API configured — session works in degraded mode
      return;
    }

    // Obtain access token
    const { GoogleAuth } = await import('google-auth-library');
    const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
    const client = await auth.getClient();
    const accessToken = (await client.getAccessToken()).token;

    if (!accessToken) {
      throw new Error('Failed to obtain GCP access token for Lyria RealTime');
    }

    const wsUrl = `wss://${this.location}-aiplatform.googleapis.com/ws/v1/projects/${this.projectId}/locations/${this.location}/publishers/google/models/lyria-realtime:streamGenerate`;

    const ws = new WebSocket(wsUrl, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
    } as any);

    session.ws = ws;

    ws.onopen = () => {
      this.logger.log(`WebSocket connected for session ${session.id}`);

      // Send initial configuration
      const initMessage = JSON.stringify({
        type: 'init',
        params: {
          bpm: session.controls.bpm,
          scale: session.controls.key,
          note_density: session.controls.density / 100,
          spectral_brightness: session.controls.brightness / 100,
          sample_rate: 48000,
          channels: 1,
          bit_depth: 16,
        },
      });
      ws.send(initMessage);
    };

    ws.onmessage = (event: MessageEvent) => {
      try {
        const data = typeof event.data === 'string'
          ? JSON.parse(event.data)
          : event.data;

        if (data.type === 'audio_chunk' && data.audio) {
          const chunk = Buffer.from(data.audio, 'base64');

          // Store for recording
          if (session.isRecording) {
            session.chunks.push(chunk);
          }

          // Emit to frontend via EventBus
          this.eventBus.publish({
            eventName: 'realtime.audio',
            eventVersion: 1,
            occurredAt: new Date().toISOString(),
            sessionId: session.id,
            userId: session.userId,
            chunk: data.audio, // Keep as base64 for Socket.IO transport
            timestamp: Date.now(),
          } satisfies RealtimeAudioEvent);

          session.lastActivity = Date.now();
        } else if (data.type === 'error') {
          this.logger.error(`Lyria RealTime error in session ${session.id}: ${data.message}`);
        }
      } catch (err) {
        this.logger.error(`Failed to process WebSocket message: ${err}`);
      }
    };

    ws.onerror = (error: Event) => {
      this.logger.error(`WebSocket error in session ${session.id}: ${error}`);
    };

    ws.onclose = (event: CloseEvent) => {
      this.logger.log(`WebSocket closed for session ${session.id}: code=${event.code} reason=${event.reason}`);
      session.ws = null;

      // Auto-cleanup if unexpected close
      if (session.isActive && event.code !== 1000) {
        this.logger.warn(`Unexpected WebSocket close for session ${session.id}, marking inactive`);
        session.isActive = false;
        this.eventBus.publish({
          eventName: 'realtime.disconnected',
          eventVersion: 1,
          occurredAt: new Date().toISOString(),
          sessionId: session.id,
          userId: session.userId,
          reason: event.reason || 'Connection lost',
        } satisfies RealtimeDisconnectedEvent);
      }
    };
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
