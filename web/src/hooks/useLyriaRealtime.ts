"use client";

import { useState, useRef, useCallback, useEffect } from 'react';
import { io, Socket } from 'socket.io-client';

interface RealtimeControls {
  bpm: number;
  key: string;
  density: number;
  brightness: number;
}

interface UseLyriaRealtimeReturn {
  /** Whether a realtime session is active */
  isStreaming: boolean;
  /** Whether currently recording the session */
  isRecording: boolean;
  /** Whether the Lyria RealTime API is available */
  isAvailable: boolean;
  /** Current control values */
  controls: RealtimeControls;
  /** Error message if any */
  error: string | null;
  /** Start a new realtime session */
  start: (trackId: string, userId: string) => void;
  /** Stop the current session */
  stop: () => void;
  /** Update generation controls */
  updateControls: (update: Partial<RealtimeControls>) => void;
  /** Start recording the session */
  startRecording: () => void;
  /** Stop recording and get WAV audio */
  stopRecording: () => void;
  /** Last recorded audio as base64 WAV */
  recordedAudio: string | null;
}

/**
 * Hook for managing Lyria RealTime interactive generation sessions.
 *
 * Connects to the backend via Socket.IO and receives streamed PCM audio
 * chunks which are decoded and played via the Web Audio API using
 * double-buffered AudioBufferSourceNodes for gapless playback.
 */
export function useLyriaRealtime(): UseLyriaRealtimeReturn {
  const [isStreaming, setIsStreaming] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isAvailable, setIsAvailable] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [recordedAudio, setRecordedAudio] = useState<string | null>(null);
  const [controls, setControls] = useState<RealtimeControls>({
    bpm: 120,
    key: 'C major',
    density: 50,
    brightness: 50,
  });

  const socketRef = useRef<Socket | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const nextPlayTimeRef = useRef<number>(0);

  // Initialize Web Audio context lazily (requires user gesture)
  const getAudioContext = useCallback(() => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      gainNodeRef.current = audioCtxRef.current.createGain();
      gainNodeRef.current.gain.value = 0.8;
      gainNodeRef.current.connect(audioCtxRef.current.destination);
    }
    if (audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume();
    }
    return audioCtxRef.current;
  }, []);

  /**
   * Decode a base64 PCM chunk and schedule it for gapless playback.
   * Uses double-buffering: each chunk is scheduled at the end of the previous one.
   */
  const playAudioChunk = useCallback((base64Chunk: string) => {
    const ctx = getAudioContext();
    if (!ctx || !gainNodeRef.current) return;

    try {
      // Decode base64 to raw bytes
      const binaryStr = atob(base64Chunk);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }

      // Convert 16-bit PCM to Float32 for Web Audio
      const int16 = new Int16Array(bytes.buffer);
      const float32 = new Float32Array(int16.length);
      for (let i = 0; i < int16.length; i++) {
        float32[i] = int16[i] / 32768;
      }

      // Create AudioBuffer (48kHz mono)
      const audioBuffer = ctx.createBuffer(1, float32.length, 48000);
      audioBuffer.getChannelData(0).set(float32);

      // Schedule for gapless playback
      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(gainNodeRef.current);

      const now = ctx.currentTime;
      const startTime = Math.max(now, nextPlayTimeRef.current);
      source.start(startTime);
      nextPlayTimeRef.current = startTime + audioBuffer.duration;
    } catch (err) {
      console.error('[LyriaRealtime] Failed to play audio chunk:', err);
    }
  }, [getAudioContext]);

  // Get or create Socket.IO connection
  const getSocket = useCallback(() => {
    if (socketRef.current?.connected) return socketRef.current;

    const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';
    const socket = io(backendUrl, {
      transports: ['websocket', 'polling'],
    });

    socket.on('connect', () => {
      console.log('[LyriaRealtime] Socket connected');
    });

    socket.on('realtime:started', (data: { sessionId: string; available: boolean }) => {
      sessionIdRef.current = data.sessionId;
      setIsStreaming(true);
      setIsAvailable(data.available);
      setError(null);
      console.log(`[LyriaRealtime] Session started: ${data.sessionId}`);
    });

    socket.on('realtime:audio', (data: { sessionId: string; chunk: string; timestamp: number }) => {
      // Decode base64 PCM and play via Web Audio API
      playAudioChunk(data.chunk);
    });

    socket.on('realtime:stopped', () => {
      sessionIdRef.current = null;
      setIsStreaming(false);
      setIsRecording(false);
    });

    socket.on('realtime:disconnected', (data: { sessionId: string; reason: string }) => {
      console.warn(`[LyriaRealtime] Disconnected: ${data.reason}`);
      sessionIdRef.current = null;
      setIsStreaming(false);
      setIsRecording(false);
      setError(`Disconnected: ${data.reason}`);
    });

    socket.on('realtime:recording', (data: { isRecording: boolean }) => {
      setIsRecording(data.isRecording);
    });

    socket.on('realtime:recorded', (data: { audio: string }) => {
      setRecordedAudio(data.audio);
      setIsRecording(false);
    });

    socket.on('realtime:error', (data: { message: string }) => {
      setError(data.message);
      console.error(`[LyriaRealtime] Error: ${data.message}`);
    });

    socketRef.current = socket;
    return socket;
  }, [playAudioChunk]);


  const start = useCallback((trackId: string, userId: string) => {
    setError(null);
    setRecordedAudio(null);
    const socket = getSocket();
    socket.emit('realtime:start', {
      trackId,
      userId,
      bpm: controls.bpm,
      key: controls.key,
      density: controls.density,
      brightness: controls.brightness,
    });
    // Initialize audio context on user gesture
    getAudioContext();
    nextPlayTimeRef.current = 0;
  }, [getSocket, getAudioContext, controls]);

  const stop = useCallback(() => {
    if (sessionIdRef.current && socketRef.current) {
      socketRef.current.emit('realtime:stop', { sessionId: sessionIdRef.current });
    }
    sessionIdRef.current = null;
    setIsStreaming(false);
    setIsRecording(false);
  }, []);

  const updateControls = useCallback((update: Partial<RealtimeControls>) => {
    setControls(prev => {
      const next = { ...prev, ...update };
      // Send to backend if session is active
      if (sessionIdRef.current && socketRef.current) {
        socketRef.current.emit('realtime:control', {
          sessionId: sessionIdRef.current,
          ...update,
        });
      }
      return next;
    });
  }, []);

  const startRecording = useCallback(() => {
    if (sessionIdRef.current && socketRef.current) {
      socketRef.current.emit('realtime:record-start', { sessionId: sessionIdRef.current });
    }
  }, []);

  const stopRecording = useCallback(() => {
    if (sessionIdRef.current && socketRef.current) {
      socketRef.current.emit('realtime:record-stop', { sessionId: sessionIdRef.current });
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (sessionIdRef.current && socketRef.current) {
        socketRef.current.emit('realtime:stop', { sessionId: sessionIdRef.current });
      }
      socketRef.current?.disconnect();
      audioCtxRef.current?.close();
    };
  }, []);

  return {
    isStreaming,
    isRecording,
    isAvailable,
    controls,
    error,
    start,
    stop,
    updateControls,
    startRecording,
    stopRecording,
    recordedAudio,
  };
}
