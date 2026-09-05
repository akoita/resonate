"use client";
import { getAddress } from "viem";
import { sanitizeStemUrl } from "./urlUtils";

// AuthSig type definition
interface AuthSig {
    sig: string;
    derivedVia: string;
    signedMessage: string;
    address: string;
}

// Global Shared AuthSig Cache
let cachedAuthSig: AuthSig | null = null;
let lastAuthSigAddress: string | null = null;
let authSigPromise: Promise<AuthSig> | null = null;

const devLog = (...args: unknown[]) => {
    if (process.env.NODE_ENV !== "production") {
        console.log(...args);
    }
};

/**
 * Shared function to get or generate AuthSig.
 * Prevents multiple signatures from being requested simultaneously.
 */
const getAuthSig = async (signMessage: (msg: string) => Promise<string>, address: string) => {
    const checksumAddress = getAddress(address);
    if (cachedAuthSig && lastAuthSigAddress === checksumAddress) {
        return cachedAuthSig;
    }

    if (authSigPromise) {
        devLog("[AuthSig] Waiting for existing signature process...");
        return authSigPromise;
    }

    authSigPromise = (async () => {
        try {
            devLog("[AuthSig] Requesting new signature via ZeroDev...");
            const now = new Date().toISOString();
            const nonce = Array.from(crypto.getRandomValues(new Uint8Array(16)))
                .map(b => b.toString(16).padStart(2, '0'))
                .join('');
            const expiration = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
            const siweMessage = `${window.location.host} wants you to sign in with your Ethereum account:\n${checksumAddress}\n\nLogin to Resonate\n\nURI: ${window.location.origin}\nVersion: 1\nChain ID: 11155111\nNonce: ${nonce}\nIssued At: ${now}\nExpiration Time: ${expiration}`;

            const signature = await signMessage(siweMessage);
            const isSmartContractSig = signature.length > 132;

            const authSig = {
                sig: signature,
                derivedVia: isSmartContractSig ? "EIP1271" : "web3.eth.personal.sign",
                signedMessage: siweMessage,
                address: checksumAddress,
            };

            cachedAuthSig = authSig;
            lastAuthSigAddress = checksumAddress;
            devLog("[AuthSig] Signature generated and cached.");
            return authSig;
        } finally {
            authSigPromise = null;
        }
    })();

    return authSigPromise;
};

// Global cache for decrypted blob URLs to handle React strict mode
const decryptedBlobCache = new Map<string, string>();
// Promises for in-flight decryption to allow waiting
const decryptionPromises = new Map<string, Promise<string>>();

export type RepeatMode = "none" | "one" | "all";
import { useAuth } from "../components/auth/AuthProvider";

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import { recordPlaybackCompleted, recordPlaybackEvent } from "./api";
import { LocalTrack, getTrackUrl, getArtworkUrl, savePlayerState, loadPlayerState } from "./localLibrary";
import {
    buildPlaybackCompletedPayload,
    buildPlaybackLifecyclePayload,
    createPlaybackAnalyticsInstanceId,
    getPlaybackAnalyticsSessionId,
    PLAYBACK_HEARTBEAT_SECONDS,
    type PlaybackLifecycleAction,
    shouldReportPlaybackCompleted,
} from "./playbackAnalytics";
import {
    appendQueueTracks,
    createShuffleCycleState,
    insertQueueTracksNext,
    reconcileShuffleCycle,
    shuffleNext,
    shufflePrevious,
    type QueueBatchResult,
    type ShuffleCycleState,
} from "./playerQueue";
import { setPlayerVolume, togglePlayerMute } from "./playerVolume";

import { queueSourceKind, validateSegment, createFiniteRepeat, consumeRepeat, type SegmentLoop, type FiniteRepeat, type QueueSource, type QueuePlayOptions } from "./listeningSession";

import { recordProductAnalyticsFromBrowser, type ProductAnalyticsEventName, type ProductAnalyticsPayload } from "./productAnalytics";

interface PlayerContextType {
    segmentLoop: SegmentLoop | null;
    setSegmentLoop: (start: number, end: number) => boolean;
    clearSegmentLoop: () => void;
    finiteRepeat: FiniteRepeat | null;
    setFiniteRepeat: (target: "track" | "queue", count: number) => boolean;
    clearFiniteRepeat: () => void;
    queueSource: QueueSource;
    queueSourceKind: ReturnType<typeof queueSourceKind>;
    currentTrack: LocalTrack | null;
    queue: LocalTrack[];
    currentIndex: number;
    isPlaying: boolean;
    progress: number; // 0 to 100
    currentTime: number;
    duration: number;
    artworkUrl: string | null;
    volume: number;
    muted: boolean;
    shuffle: boolean;
    repeatMode: "none" | "one" | "all";
    playQueue: (list: LocalTrack[], startIndex: number, options?: QueuePlayOptions) => Promise<void>;
    nextTrack: () => void;
    prevTrack: () => void;
    togglePlay: () => void;
    toggleShuffle: () => void;
    toggleRepeatMode: () => void;
    seek: (percent: number) => void;
    setVolume: (value: number) => void;
    toggleMute: () => void;
    stop: () => void;
    addToQueue: (track: LocalTrack) => QueueBatchResult;
    playNext: (track: LocalTrack) => QueueBatchResult;
    addTracksToQueue: (tracks: LocalTrack[]) => QueueBatchResult;
    playTracksNext: (tracks: LocalTrack[]) => QueueBatchResult;
    removeFromQueue: (index: number) => void;
    // Mixer support
    mixerMode: boolean;
    toggleMixerMode: () => void;
    setMixerVolumes: (volumes: Record<string, number>) => void;
    mixerVolumes: Record<string, number>;
}

const PlayerContext = createContext<PlayerContextType | undefined>(undefined);

interface StemAudioProps {
    stem: {
        uri: string;
        type: string;
        isEncrypted?: boolean;
        encryptionMetadata?: string | null;
    };
    masterAudio: HTMLAudioElement | null;
    isPlaying: boolean;
    volume: number;
    mixerVolume: number;
    enabled: boolean;
    onMount: (type: string, el: HTMLAudioElement) => void;
    onUnmount: (type: string) => void;
    onPlaybackStarted: (type: string) => void;
}

const StemAudio = React.memo(({ stem, masterAudio, isPlaying, volume, mixerVolume, enabled, onMount, onUnmount, onPlaybackStarted }: StemAudioProps) => {
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const [streamUrl, setStreamUrl] = useState<string | null>(null);
    const [, setIsDecrypting] = useState(false);
    const { signMessage, address, token } = useAuth();
    const type = stem.type.toLowerCase();
    const shouldLoad = enabled && mixerVolume > 0 && volume > 0;

    // 1. Handle Decryption and Object URLs
    useEffect(() => {
        let active = true;
        const currentUri = sanitizeStemUrl(stem.uri) || stem.uri;

        const loadAudio = async () => {
            if (!shouldLoad) {
                setStreamUrl(null);
                setIsDecrypting(false);
                return;
            }

            // Check if we already have a cached blob URL
            const cachedUrl = decryptedBlobCache.get(currentUri);
            if (cachedUrl) {
                devLog(`[StemAudio:${type}] Using cached blob URL`);
                setStreamUrl(cachedUrl);
                setIsDecrypting(false);
                return;
            }

            devLog(`[StemAudio:${type}] Loading... Encrypted: ${stem.isEncrypted}, URI: ${currentUri}`);

            if (!stem.isEncrypted) {
                devLog(`[StemAudio:${type}] Not encrypted, using raw URI.`);
                setStreamUrl(currentUri);
                return;
            }

            // Check if decryption is already in progress - wait for it
            const existingPromise = decryptionPromises.get(currentUri);
            if (existingPromise) {
                devLog(`[StemAudio:${type}] Waiting for existing decryption...`);
                setIsDecrypting(true);
                try {
                    const url = await existingPromise;
                    if (active) {
                        devLog(`[StemAudio:${type}] Got URL from existing decryption`);
                        setStreamUrl(url);
                    }
                } catch (err) {
                    console.error(`[StemAudio:${type}] Existing decryption failed:`, err);
                } finally {
                    if (active) setIsDecrypting(false);
                }
                return;
            }

            // Start new decryption
            const decryptionPromise = (async () => {
                // Calculate AuthSig using ZeroDev/Kernel signer
                if (!address || !token) throw new Error("Authentication required for decryption");

                const authSig = await getAuthSig(signMessage, address);

                devLog(`[StemAudio:${type}] Requesting proxy decryption from backend...`);

                // Send the raw metadata - backend handles both AES and legacy Lit formats
                const rawMetadata = stem.encryptionMetadata || "";

                const proxyResponse = await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000"}/encryption/decrypt`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": `Bearer ${token}`,
                    },
                    body: JSON.stringify({
                        uri: currentUri,
                        metadata: rawMetadata,
                        authSig
                    })
                });

                if (!proxyResponse.ok) {
                    const errorText = await proxyResponse.text();
                    throw new Error(`Proxy decryption failed: ${errorText}`);
                }

                const decryptedData = await proxyResponse.arrayBuffer();
                devLog(`[StemAudio:${type}] Proxy decryption successful. Size: ${decryptedData.byteLength}`);

                const blob = new Blob([decryptedData], { type: "audio/mpeg" });
                const url = URL.createObjectURL(blob);
                devLog(`[StemAudio:${type}] Created Blob URL: ${url}`);

                // Cache the blob URL
                decryptedBlobCache.set(currentUri, url);

                return url;
            })();

            // Store the promise so other mounts can wait for it
            decryptionPromises.set(currentUri, decryptionPromise);
            setIsDecrypting(true);

            try {
                const url = await decryptionPromise;
                if (active) {
                    setStreamUrl(url);
                }
            } catch (err) {
                console.error(`[StemAudio:${type}] Failed to decrypt stem:`, err);
                if (active) setStreamUrl(currentUri); // Fallback to raw (likely fails but safe)
            } finally {
                if (active) setIsDecrypting(false);
                // Clean up the promise after a delay (keep cache)
                setTimeout(() => decryptionPromises.delete(currentUri), 5000);
            }
        };

        loadAudio();

        return () => {
            active = false;
            // Don't revoke blob URLs - they're cached and shared
        };
    }, [stem.uri, stem.isEncrypted, stem.encryptionMetadata, address, token, signMessage, type, shouldLoad]);

    useEffect(() => {
        const el = audioRef.current;
        if (el) {
            onMount(type, el);
            devLog(`[StemAudio:${type}] Mounted`);
        }
        return () => onUnmount(type);
    }, [type, onMount, onUnmount]);

    // Track isPlaying in a ref so we can access current value without adding as dependency
    const isPlayingRef = useRef(isPlaying);
    useEffect(() => {
        isPlayingRef.current = isPlaying;
    }, [isPlaying]);

    // When streamUrl changes (after decryption), explicitly load and play the audio
    useEffect(() => {
        if (!audioRef.current || !streamUrl) {
            if (audioRef.current) {
                audioRef.current.pause();
                audioRef.current.removeAttribute("src");
                audioRef.current.load();
            }
            return;
        }

        const audio = audioRef.current;
        devLog(`[StemAudio:${type}] streamUrl available, loading audio...`);

        // Set src and load explicitly - React's attribute update doesn't trigger load
        audio.src = streamUrl;
        audio.load();

        // Set volume
        const effectiveVolume = enabled ? mixerVolume * volume : 0;
        audio.volume = effectiveVolume;
        devLog(`[StemAudio:${type}] Volume set to ${effectiveVolume}`);

        // Start playback when ready
        const playWhenReady = () => {
            // Check current playing state via ref
            if (enabled && isPlayingRef.current) {
                devLog(`[StemAudio:${type}] canplay event - starting playback`);
                // CRITICAL: Sync time with master audio BEFORE playing
                if (masterAudio) {
                    const targetTime = masterAudio.currentTime;
                    if (Math.abs(audio.currentTime - targetTime) > 0.1) {
                        devLog(`[StemAudio:${type}] Syncing to master time in canplay:`, targetTime);
                        audio.currentTime = targetTime;
                    }
                }
                audio.play()
                    .then(() => onPlaybackStarted(type))
                    .catch((err) => {
                        devLog(`[StemAudio:${type}] Play after load failed:`, err.name);
                    });
            } else {
                devLog(`[StemAudio:${type}] canplay event - not playing (isPlaying=false)`);
            }
        };

        // Listen for canplay event
        audio.addEventListener('canplay', playWhenReady, { once: true });

        return () => {
            audio.removeEventListener('canplay', playWhenReady);
        };
    }, [streamUrl, type, mixerVolume, volume, masterAudio, enabled, onPlaybackStarted]); // Include volume deps for initial volume set

    // Update volume whenever mixerVolume or master volume changes
    useEffect(() => {
        if (audioRef.current && streamUrl) {
            const effectiveVolume = enabled ? mixerVolume * volume : 0;
            devLog(`[StemAudio:${type}] Setting volume: ${effectiveVolume} (mixer: ${mixerVolume}, master: ${volume})`);
            audioRef.current.volume = effectiveVolume;
        }
    }, [mixerVolume, volume, type, streamUrl, enabled]);

    // Play/pause stems based on isPlaying state - only when streamUrl is available
    useEffect(() => {
        if (!audioRef.current || !streamUrl) {
            return;
        }

        if (enabled && isPlaying) {
            devLog(`[StemAudio:${type}] isPlaying changed to true, attempting play`);
            // CRITICAL: Sync time with master audio BEFORE playing
            if (masterAudio && audioRef.current.readyState >= 1) {
                const targetTime = masterAudio.currentTime;
                if (Math.abs(audioRef.current.currentTime - targetTime) > 0.1) {
                    devLog(`[StemAudio:${type}] Syncing to master time before play:`, targetTime);
                    audioRef.current.currentTime = targetTime;
                }
            }
            audioRef.current.play()
                .then(() => onPlaybackStarted(type))
                .catch((err) => {
                    devLog(`[StemAudio:${type}] Play failed:`, err.name);
                });
        } else {
            devLog(`[StemAudio:${type}] isPlaying changed to false, pausing`);
            audioRef.current.pause();
        }
    }, [enabled, isPlaying, type, streamUrl, masterAudio, onPlaybackStarted]);

    // Keep audio element mounted even during decryption to maintain ref stability
    // Note: src is set programmatically in useEffect to ensure load() is called
    return (
        <audio
            ref={audioRef}
            preload={shouldLoad ? "auto" : "none"}
            onLoadStart={() => {
                devLog(`[StemAudio:${type}] onLoadStart - loading audio from blob`);
            }}
            onLoadedMetadata={(e) => {
                devLog(`[StemAudio:${type}] onLoadedMetadata - duration:`, e.currentTarget.duration);
                // Set volume immediately when metadata loads
                e.currentTarget.volume = enabled ? mixerVolume * volume : 0;
                // Sync with master audio if available
                if (masterAudio) {
                    const targetTime = masterAudio.currentTime;
                    if (Math.abs(e.currentTarget.currentTime - targetTime) > 0.5) {
                        devLog(`[StemAudio:${type}] Syncing to master time:`, targetTime);
                        e.currentTarget.currentTime = targetTime;
                    }
                }
            }}
            onCanPlay={(e) => {
                // Set volume (don't log - this event fires frequently)
                e.currentTarget.volume = enabled ? mixerVolume * volume : 0;
            }}
            onPlay={() => {
                devLog(`[StemAudio:${type}] onPlay - stem is now playing`);
                if (enabled) {
                    onPlaybackStarted(type);
                }
            }}
            onPause={() => {
                devLog(`[StemAudio:${type}] onPause - stem paused`);
            }}
            onError={(e) => {
                console.error(`[StemAudio:${type}] Audio error:`, e.currentTarget.error);
            }}
        />
    );
});
StemAudio.displayName = "StemAudio";

export function PlayerProvider({ children }: { children: React.ReactNode }) {
    const { token } = useAuth();
    const [segmentLoop, setSegmentLoopState] = useState<SegmentLoop | null>(null);
    const segmentLoopRef = useRef<SegmentLoop | null>(null);
    const [finiteRepeat, setFiniteRepeatState] = useState<FiniteRepeat | null>(null);
    const finiteRepeatRef = useRef<FiniteRepeat | null>(null);
    const [queueSource, setQueueSource] = useState<QueueSource>(null);
    const [queue, setQueue] = useState<LocalTrack[]>([]);
    const [currentIndex, setCurrentIndex] = useState(-1);
    const [isPlaying, setIsPlaying] = useState(false);
    const [progress, setProgress] = useState(0);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [artworkUrl, setArtworkUrl] = useState<string | null>(null);
    const [volume, setVolumeState] = useState(0.8);
    const [muted, setMuted] = useState(false);
    const [shuffle, setShuffle] = useState(false);
    const [repeatMode, setRepeatMode] = useState<"none" | "one" | "all">("none");
    const [isHydrated, setIsHydrated] = useState(false);
    const [mixerMode, setMixerMode] = useState(false);
    const [mixerAudioActive, setMixerAudioActive] = useState(false);
    const [mixerVolumes, setMixerVolumesState] = useState<Record<string, number>>({
        vocals: 1,
        drums: 1,
        bass: 1,
        other: 1,
        piano: 1,
        guitar: 1
    });

    // Additional audio elements for stems (mixer)
    const stemAudiosRef = useRef<Record<string, HTMLAudioElement>>({});

    const audioRef = useRef<HTMLAudioElement | null>(null);
    const playPromiseRef = useRef<Promise<void> | null>(null);
    const isSeekingRef = useRef(false);
    const currentTrackIdRef = useRef<string | null>(null);
    const currentTrackUrlRef = useRef<string | null>(null);
    const pendingSeekTimeRef = useRef<number | null>(null);
    const authTokenRef = useRef<string | null>(token);
    const playbackCompletedTrackRef = useRef<string | null>(null);
    const playbackInstanceIdRef = useRef<string | null>(null);
    const playbackHeartbeatBucketsRef = useRef<Set<number>>(new Set());
    const previousNonZeroVolumeRef = useRef(0.8);
    const playbackRequestRef = useRef(0);
    const pendingShuffleNextRef = useRef<string[]>([]);

    // Stable function refs for event listeners
    const nextTrackRef = useRef<(autoAdvance?: boolean) => void>(() => { });
    const queueRef = useRef<LocalTrack[]>([]);
    const currentIndexRef = useRef(-1);
    const shuffleRef = useRef(false);
    const shuffleCycleRef = useRef<ShuffleCycleState>(createShuffleCycleState());
    const repeatModeRef = useRef<"none" | "one" | "all">("none");
    const mixerModeRef = useRef(false); // Synchronous tracker for mixer mode
    const mixerAudioActiveRef = useRef(false);
    const mixerVolumesRef = useRef(mixerVolumes);

    const currentTrack = currentIndex >= 0 ? queue[currentIndex] : null;

    const reportControl = useCallback((eventName: ProductAnalyticsEventName, payload: ProductAnalyticsPayload) => {
        const track = queueRef.current[currentIndexRef.current];
        recordProductAnalyticsFromBrowser(eventName, {
            source: "player", sessionId: getPlaybackAnalyticsSessionId(),
            subjectType: track ? "track" : undefined, subjectId: track?.catalogTrackId || track?.id,
            payload: { trackId: track?.catalogTrackId || track?.id, artistId: track?.artistId,
                releaseId: track?.releaseId, playbackInstanceId: playbackInstanceIdRef.current,
                queueLength: queueRef.current.length, shuffle: shuffleRef.current, ...payload },
        });
    }, []);
    const updateFiniteRepeat = useCallback((plan: FiniteRepeat | null) => {
        finiteRepeatRef.current = plan;
        setFiniteRepeatState(plan);
    }, []);
    const clearFiniteRepeat = useCallback(() => {
        if (finiteRepeatRef.current) reportControl("player.repeat_count_cleared", { ...finiteRepeatRef.current });
        updateFiniteRepeat(null);
    }, [reportControl, updateFiniteRepeat]);
    const setFiniteRepeat = useCallback((target: "track" | "queue", count: number) => {
        const plan = createFiniteRepeat(target, count);
        if (!plan || !queueRef.current.length) return false;
        reportControl(finiteRepeatRef.current ? "player.repeat_count_updated" : "player.repeat_count_set", { ...plan });
        repeatModeRef.current = "none";
        setRepeatMode("none");
        updateFiniteRepeat(plan);
        return true;
    }, [reportControl, updateFiniteRepeat]);
    const clearSegmentLoop = useCallback(() => {
        const loop = segmentLoopRef.current;
        if (loop) reportControl("player.segment_loop_disabled", { startMs: loop.start * 1000, endMs: loop.end * 1000, segmentDurationMs: (loop.end - loop.start) * 1000 });
        segmentLoopRef.current = null;
        setSegmentLoopState(null);
    }, [reportControl]);
    const setSegmentLoop = useCallback((start: number, end: number) => {
        const loop = validateSegment(start, end, audioRef.current?.duration ?? 0);
        if (!loop) return false;
        reportControl(segmentLoopRef.current ? "player.segment_loop_updated" : "player.segment_loop_enabled",
            { startMs: Math.round(loop.start * 1000), endMs: Math.round(loop.end * 1000), segmentDurationMs: Math.round((loop.end - loop.start) * 1000) });
        segmentLoopRef.current = loop;
        setSegmentLoopState(loop);
        const audio = audioRef.current;
        if (audio && (audio.currentTime < loop.start || audio.currentTime >= loop.end)) audio.currentTime = loop.start;
        return true;
    }, [reportControl]);


    useEffect(() => {
        authTokenRef.current = token;
    }, [token]);

    const recordPlaybackLifecycleEvent = useCallback((
        action: PlaybackLifecycleAction,
        trackOverride?: LocalTrack | null,
        currentTimeOverride?: number,
        reason?: string,
    ) => {
        const token = authTokenRef.current;
        const playbackInstanceId = playbackInstanceIdRef.current;
        const activeTrack = trackOverride ?? queueRef.current[currentIndexRef.current] ?? null;
        if (!token || !playbackInstanceId || !activeTrack) {
            return;
        }

        const audio = audioRef.current;
        const payload = buildPlaybackLifecyclePayload({
            action,
            track: activeTrack,
            sessionId: getPlaybackAnalyticsSessionId(),
            playbackInstanceId,
            currentTimeSeconds: currentTimeOverride ?? audio?.currentTime ?? 0,
            durationSeconds: audio?.duration,
            heartbeatIntervalSeconds: action === "heartbeat" ? PLAYBACK_HEARTBEAT_SECONDS : undefined,
            reason,
            queueIndex: currentIndexRef.current >= 0 ? currentIndexRef.current : undefined,
            queueLength: queueRef.current.length || undefined,
            repeatMode: repeatModeRef.current,
            shuffle: shuffleRef.current,
        });
        if (!payload) {
            return;
        }

        recordPlaybackEvent(token, payload).catch((error) => {
            console.warn("Failed to record playback lifecycle analytics:", error);
        });
    }, []);

    // Mute main track when mixer mode is active and we have stems to play
    useEffect(() => {
        if (audioRef.current) {
            const hasStems = currentTrack?.stems?.some(s => s.type.toUpperCase() !== 'ORIGINAL');
            const shouldMute = mixerMode && hasStems && mixerAudioActive;
            devLog('[Volume Effect] mixerMode:', mixerMode, 'hasStems:', hasStems, 'shouldMute:', shouldMute);
            audioRef.current.volume = shouldMute ? 0 : volume;
        }
    }, [volume, mixerMode, mixerAudioActive, currentTrack?.id, currentTrack?.stems]);

    // Note: isPlaying state sync is handled by play/pause event listeners on main audio element

    // Hydration Effect
    useEffect(() => {
        const hydrate = async () => {
            try {
                const saved = await loadPlayerState();
                if (saved) {
                    const savedActiveId = saved.queue[saved.currentIndex]?.id ?? null;
                    const hydratedQueue = appendQueueTracks([], saved.queue).queue;
                    const hydratedIndex = savedActiveId
                        ? hydratedQueue.findIndex((track) => track.id === savedActiveId)
                        : hydratedQueue.length > 0 ? 0 : -1;
                    setQueueSource(saved.queueSource ?? null);
                    setQueue(hydratedQueue);
                    setCurrentIndex(hydratedIndex);
                    queueRef.current = hydratedQueue;
                    currentIndexRef.current = hydratedIndex;
                    setVolumeState(saved.volume);
                    setMuted(saved.muted ?? saved.volume === 0);
                    previousNonZeroVolumeRef.current =
                        saved.previousNonZeroVolume ?? (saved.volume > 0 ? saved.volume : 0.8);
                    setShuffle(saved.shuffle);
                    shuffleCycleRef.current = saved.shuffleCycle
                        ? reconcileShuffleCycle(
                            saved.shuffleCycle,
                            hydratedQueue.map((track) => track.id),
                            hydratedQueue[hydratedIndex]?.id ?? null,
                        )
                        : createShuffleCycleState(hydratedQueue[hydratedIndex]?.id ?? null);
                    setRepeatMode(saved.repeatMode);

                    // Pre-load artwork if track exists
                    if (hydratedIndex >= 0 && hydratedQueue[hydratedIndex]) {
                        const art = await getArtworkUrl(hydratedQueue[hydratedIndex]);
                        setArtworkUrl(art);
                    }
                }
            } catch (err) {
                console.error("Failed to hydrate player state:", err);
            } finally {
                setIsHydrated(true);
            }
        };
        hydrate();
    }, []);

    // Persistence Effect
    useEffect(() => {
        if (isHydrated) {
            savePlayerState({
                queue,
                currentIndex,
                volume,
                muted,
                previousNonZeroVolume: previousNonZeroVolumeRef.current,
                shuffle,
                shuffleCycle: shuffleCycleRef.current,
                repeatMode,
                queueSource
            }).catch(err => console.error("Failed to save player state:", err));
        }
    }, [queue, currentIndex, volume, muted, shuffle, repeatMode, queueSource, isHydrated]);

    // Optimized Safe Play/Pause (Synchronous Pause for Gesture Stability)
    const safePlay = useCallback(async () => {
        devLog('[safePlay] called, audioRef:', !!audioRef.current, 'src:', audioRef.current?.src?.substring(0, 60), 'readyState:', audioRef.current?.readyState);
        if (!audioRef.current || !audioRef.current.src) {
            console.warn('[safePlay] EARLY RETURN - no audio element or no src');
            return;
        }
        let promise: Promise<void> | undefined;
        try {
            devLog('[safePlay] calling audio.play()...');
            promise = audioRef.current.play();
            playPromiseRef.current = promise;
            await promise;
            devLog('[safePlay] play() succeeded, setting isPlaying=true');
            setIsPlaying(true);
        } catch (error: unknown) {
            if (error instanceof Error) {
                console.error('[safePlay] play() threw:', error.name, error.message);
                if (error.name === 'AbortError') return;
                if (error.name === 'NotAllowedError') {
                    console.warn("Autoplay blocked. Waiting for user interaction.");
                    return;
                }
                console.error("Playback error:", error);
            }
            setIsPlaying(false);
        } finally {
            if (promise && playPromiseRef.current === promise) {
                playPromiseRef.current = null;
            }
        }
    }, []);

    const safePause = useCallback(() => {
        if (!audioRef.current) return;
        audioRef.current.pause();
        setIsPlaying(false);
    }, []);

    const playTrack = useCallback(async (track: LocalTrack, requestId: number) => {
        if (!audioRef.current) return;

        // Don't reset if we're currently seeking - check FIRST before any async operations
        if (isSeekingRef.current) {
            console.warn("playTrack: seek in progress, aborting track load");
            return;
        }

        // Synchronous pause to preserve user gesture
        // But only if we are actually changing something
        const url = await getTrackUrl(track);
        if (requestId !== playbackRequestRef.current) return;

        if (currentTrackIdRef.current === track.id && currentTrackUrlRef.current === url) {
            devLog("playTrack: same track and resolved URL, resuming playback", track.id);
            if (audioRef.current) {
                const hasStems = track.stems?.some(s => s.type.toUpperCase() !== 'ORIGINAL');
                audioRef.current.volume = (mixerModeRef.current && hasStems && mixerAudioActiveRef.current) ? 0 : volume;
            }
            if (audioRef.current && audioRef.current.currentTime >= audioRef.current.duration) {
                audioRef.current.currentTime = 0;
                playbackCompletedTrackRef.current = null;
                playbackInstanceIdRef.current = createPlaybackAnalyticsInstanceId();
                playbackHeartbeatBucketsRef.current = new Set();
                recordPlaybackLifecycleEvent("started", track, 0);
            }
            void safePlay();
            return;
        }

        devLog("playTrack: loading new track/stem", track.id, "URL changed:", currentTrackUrlRef.current !== url);
        mixerAudioActiveRef.current = false;
        setMixerAudioActive(false);
        safePause();

        const art = await getArtworkUrl(track);
        if (requestId !== playbackRequestRef.current) return;

        // CRITICAL: Check AGAIN after async operations - seek might have started
        if (isSeekingRef.current) {
            console.warn("playTrack: seek started during async operation, aborting src change");
            return;
        }

        if (!audioRef.current) return; // Check again in case audio was cleared
        if (requestId !== playbackRequestRef.current) return;

        if (!url) {
            console.warn("playTrack: No valid URL for track", track.id, "- cannot play");
            return;
        }

        // Only set src if it's actually different to avoid resetting playback
        // Check both the audio element's src and our cached ref
        const currentSrc = audioRef.current.src;

        // Normalize URLs for comparison (remove trailing slashes, etc.)
        const normalizeUrl = (u: string) => u.replace(/\/$/, '');
        const currentSrcNormalized = currentSrc ? normalizeUrl(currentSrc) : '';
        const urlNormalized = normalizeUrl(url);

        // If src is already set to this URL, don't change it (this prevents reset)
        if (currentSrcNormalized === urlNormalized || currentTrackUrlRef.current === url) {
            devLog("playTrack: src already set, skipping", url.substring(0, 50));
            const hasStems = track.stems?.some(s => s.type.toUpperCase() !== 'ORIGINAL');
            audioRef.current.volume = (mixerModeRef.current && hasStems && mixerAudioActiveRef.current) ? 0 : volume;
            setArtworkUrl(art || null);
            if (currentTrackIdRef.current !== track.id) {
                playbackCompletedTrackRef.current = null;
                playbackInstanceIdRef.current = createPlaybackAnalyticsInstanceId();
                playbackHeartbeatBucketsRef.current = new Set();
                recordPlaybackLifecycleEvent("started", track);
            }
            currentTrackIdRef.current = track.id;
            void safePlay();
            return;
        }

        // CRITICAL: Final check right before setting src
        if (isSeekingRef.current) {
            console.error("playTrack: seek in progress, BLOCKING src change to prevent reset!");
            return;
        }

        // Save current time before changing src
        const savedTime = audioRef.current.currentTime;
        const wasPlaying = !audioRef.current.paused;

        devLog("playTrack: setting new src", url.substring(0, 80), "saving time:", savedTime);
        playbackCompletedTrackRef.current = null;
        playbackInstanceIdRef.current = createPlaybackAnalyticsInstanceId();
        playbackHeartbeatBucketsRef.current = new Set();
        audioRef.current.src = url;
        audioRef.current.load();
        currentTrackUrlRef.current = url;

        // If we had a valid position and it wasn't near the start, try to restore it
        if (savedTime > 1 && audioRef.current.duration && savedTime < audioRef.current.duration) {
            // Wait for metadata to load, then restore position
            const restorePosition = () => {
                if (audioRef.current && audioRef.current.readyState >= 1) {
                    devLog("playTrack: restoring position to", savedTime);
                    audioRef.current.currentTime = savedTime;
                    if (wasPlaying) {
                        void safePlay();
                    }
                } else if (audioRef.current) {
                    audioRef.current.addEventListener('loadedmetadata', restorePosition, { once: true });
                }
            };
            restorePosition();
        } else {
            devLog("playTrack: calling safePlay() for new track");
            void safePlay();
        }
        // Mute main audio if mixer mode is active and track has stems
        const hasStems = track.stems?.some(s => s.type.toUpperCase() !== 'ORIGINAL');
        audioRef.current.volume = (mixerModeRef.current && hasStems && mixerAudioActiveRef.current) ? 0 : volume;
        devLog('[playTrack] Setting volume:', audioRef.current.volume, 'mixerModeRef:', mixerModeRef.current, 'hasStems:', hasStems);
        setArtworkUrl(art || null);
        currentTrackIdRef.current = track.id;
        recordPlaybackLifecycleEvent("started", track);
    // NOTE: mixerMode intentionally excluded - we use mixerModeRef.current to avoid
    // cascading recreation of playQueue → nextTrack → togglePlay on mixer toggle
    }, [recordPlaybackLifecycleEvent, volume, safePause, safePlay]);

    const playQueue = useCallback(async (list: LocalTrack[], startIndex: number, options?: QueuePlayOptions) => {
        const requestedTrack = list[startIndex];
        if (!requestedTrack) return;
        const requestId = playbackRequestRef.current + 1;
        playbackRequestRef.current = requestId;

        const normalizedList = appendQueueTracks([], list).queue;
        const normalizedIndex = normalizedList.findIndex((track) => track.id === requestedTrack.id);
        const trackToPlay = normalizedList[normalizedIndex];
        if (!trackToPlay) return;

        // Don't reset if we're currently seeking - this is critical!
        if (isSeekingRef.current) {
            console.warn("playQueue: seek in progress, aborting queue update");
            return;
        }

        // Update queue state
        const queueWasReplaced = normalizedList.length !== queueRef.current.length
            || normalizedList.some((track, index) => track.id !== queueRef.current[index]?.id);
        if (currentTrackIdRef.current !== trackToPlay.id) {
            segmentLoopRef.current = null;
            setSegmentLoopState(null);
            if (finiteRepeatRef.current?.target === "track") clearFiniteRepeat();
        }
        if (!options?.navigation) {
            if (finiteRepeatRef.current) clearFiniteRepeat();
            setQueueSource(options?.playlistId ? {
                playlistId: options.playlistId,
                publicPlaylist: options.publicPlaylist,
                trackIds: (options.sourceTrackIds ?? normalizedList.map(track => track.id)).map(id =>
                    normalizedList.find(track => track.id === id || track.catalogTrackId === id)?.id ?? id),
            } : null);
        }
        setQueue(normalizedList);
        setCurrentIndex(normalizedIndex);
        queueRef.current = normalizedList;
        currentIndexRef.current = normalizedIndex;
        if (shuffleRef.current) {
            shuffleCycleRef.current = queueWasReplaced
                ? createShuffleCycleState(trackToPlay.id)
                : reconcileShuffleCycle(
                    shuffleCycleRef.current,
                    normalizedList.map((track) => track.id),
                    trackToPlay.id,
                );
        }

        devLog("playQueue: playing track", trackToPlay.id, "at index", normalizedIndex);
        await playTrack(trackToPlay, requestId);
    }, [playTrack, clearFiniteRepeat]);

    const nextTrack = useCallback((autoAdvance = false) => {
        const q = queueRef.current;
        const idx = currentIndexRef.current;
        const isShuffle = shuffleRef.current;
        const rMode = repeatModeRef.current;
        if (!autoAdvance && finiteRepeatRef.current?.target === "track") clearFiniteRepeat();

        if (q.length === 0) return;
        const allowQueueWrap = () => {
            if (finiteRepeatRef.current?.target !== "queue") return rMode === "all";
            if (!autoAdvance) return false;
            const result = consumeRepeat(finiteRepeatRef.current);
            updateFiniteRepeat(result.plan);
            return result.replay;
        };

        // #1449 WS-2: a user-invoked "next" before the track is (nearly) done
        // is a DELIBERATE skip — a distinct negative signal, not a short
        // listen. The natural-end auto-advance path never hits this branch
        // because there currentTime ≈ duration.
        const audio = audioRef.current;
        const activeTrack = q[idx] ?? null;
        if (
            activeTrack &&
            audio &&
            Number.isFinite(audio.duration) &&
            audio.duration > 0 &&
            audio.currentTime / audio.duration < 0.97
        ) {
            recordPlaybackLifecycleEvent("skipped", activeTrack, audio.currentTime, "next_clicked");
        }

        if (isShuffle) {
            const pendingTrackId = pendingShuffleNextRef.current.find((trackId) =>
                q.some((track) => track.id === trackId) && trackId !== q[idx]?.id,
            );
            if (pendingTrackId) {
                pendingShuffleNextRef.current = pendingShuffleNextRef.current.filter(
                    (trackId) => trackId !== pendingTrackId,
                );
                const reconciled = reconcileShuffleCycle(
                    shuffleCycleRef.current,
                    q.map((track) => track.id),
                    q[idx]?.id ?? null,
                );
                const history = reconciled.history.slice(0, reconciled.position + 1);
                history.push(pendingTrackId);
                shuffleCycleRef.current = {
                    history,
                    position: history.length - 1,
                    played: [...new Set([...reconciled.played, pendingTrackId])],
                };
                const pendingIndex = q.findIndex((track) => track.id === pendingTrackId);
                if (pendingIndex >= 0) void playQueue(q, pendingIndex, { navigation: true });
                return;
            }
            let result = shuffleNext(
                shuffleCycleRef.current,
                q.map((track) => track.id),
                q[idx]?.id ?? null,
                { repeatAll: false },
            );
            if (!result.trackId && allowQueueWrap()) {
                result = shuffleNext(result.state, q.map(track => track.id), q[idx]?.id ?? null, { repeatAll: true });
            }
            shuffleCycleRef.current = result.state;
            if (!result.trackId) {
                if (autoAdvance) setIsPlaying(false);
                return;
            }
            const nextIdx = q.findIndex((track) => track.id === result.trackId);
            if (nextIdx >= 0) void playQueue(q, nextIdx, { navigation: true });
            return;
        }

        if (idx < q.length - 1) {
            void playQueue(q, idx + 1, { navigation: true });
        } else if (allowQueueWrap()) {
            void playQueue(q, 0, { navigation: true }); // Loop back to start
        } else {
            if (autoAdvance) setIsPlaying(false);
            return;
        }
    }, [playQueue, recordPlaybackLifecycleEvent, clearFiniteRepeat, updateFiniteRepeat]);

    const prevTrack = useCallback(() => {
        const q = queueRef.current;
        const idx = currentIndexRef.current;
        if (shuffleRef.current) {
            const result = shufflePrevious(
                shuffleCycleRef.current,
                q.map((track) => track.id),
                q[idx]?.id ?? null,
            );
            shuffleCycleRef.current = result.state;
            if (!result.trackId) return;
            const previousIndex = q.findIndex((track) => track.id === result.trackId);
            if (previousIndex >= 0) void playQueue(q, previousIndex, { navigation: true });
            return;
        }
        if (idx > 0) {
            void playQueue(q, idx - 1, { navigation: true });
        } else if (repeatModeRef.current === "all" && q.length > 0) {
            void playQueue(q, q.length - 1, { navigation: true }); // Loop to end
        }
    }, [playQueue]);

    const toggleShuffle = useCallback(() => {
        setShuffle((previous) => {
            const next = !previous;
            shuffleRef.current = next;
            if (next) {
                shuffleCycleRef.current = createShuffleCycleState(
                    queueRef.current[currentIndexRef.current]?.id ?? null,
                );
            }
            return next;
        });
    }, []);
    const toggleRepeatMode = useCallback(() => {
        clearFiniteRepeat();
        setRepeatMode(prev => {
            const next = prev === "none" ? "all" : prev === "all" ? "one" : "none";
            repeatModeRef.current = next;
            return next;
        });
    }, [clearFiniteRepeat]);

    // Sync refs for event listeners
    useEffect(() => {
        queueRef.current = queue;
        currentIndexRef.current = currentIndex;
        nextTrackRef.current = nextTrack;
        shuffleRef.current = shuffle;
        repeatModeRef.current = repeatMode;
        mixerVolumesRef.current = mixerVolumes;
    }, [queue, currentIndex, nextTrack, shuffle, repeatMode, mixerVolumes]);

    // Persistent Audio initialiser with stable listener bridge
    useEffect(() => {
        const audio = new Audio();
        audioRef.current = audio;

        const handleTimeUpdate = () => {
            // Don't update progress if we're currently seeking
            if (isSeekingRef.current) return;
            const loop = segmentLoopRef.current;
            if (loop && !audio.paused && (audio.currentTime >= loop.end || audio.currentTime < loop.start)) {
                audio.currentTime = loop.start;
                Object.values(stemAudiosRef.current).forEach(stem => { stem.currentTime = loop.start; });
                setCurrentTime(loop.start);
                setProgress(loop.start / audio.duration * 100);
                return;
            }

            setCurrentTime(audio.currentTime);
            setDuration(audio.duration || 0);
            setProgress((audio.currentTime / (audio.duration || 1)) * 100);

            const activeTrack = queueRef.current[currentIndexRef.current] ?? null;
            const heartbeatBucket = Math.floor(audio.currentTime / PLAYBACK_HEARTBEAT_SECONDS);
            if (
                activeTrack &&
                heartbeatBucket > 0 &&
                !playbackHeartbeatBucketsRef.current.has(heartbeatBucket)
            ) {
                playbackHeartbeatBucketsRef.current.add(heartbeatBucket);
                recordPlaybackLifecycleEvent("heartbeat", activeTrack);
            }

            const alreadyReported =
                !!activeTrack &&
                playbackCompletedTrackRef.current === (activeTrack.catalogTrackId || activeTrack.id);
            if (
                shouldReportPlaybackCompleted({
                    track: activeTrack,
                    currentTimeSeconds: audio.currentTime,
                    durationSeconds: audio.duration,
                    alreadyReported,
                })
            ) {
                const token = authTokenRef.current;
                if (!token || !activeTrack) {
                    return;
                }
                const payload = buildPlaybackCompletedPayload({
                    track: activeTrack,
                    currentTimeSeconds: audio.currentTime,
                    durationSeconds: audio.duration,
                    sessionId: getPlaybackAnalyticsSessionId(),
                });
                if (!payload) {
                    return;
                }

                playbackCompletedTrackRef.current = payload.trackId;
                recordPlaybackCompleted(token, payload).catch((error) => {
                    console.warn("Failed to record playback analytics:", error);
                });
            }
        };

        const handleLoadedMetadata = () => {
            setDuration(audio.duration);
            // If we were seeking when metadata loaded, restore the seek position
            if (isSeekingRef.current && pendingSeekTimeRef.current !== null && audioRef.current) {
                const targetTime = pendingSeekTimeRef.current;
            devLog("handleLoadedMetadata: restoring seek position to", targetTime);
                audioRef.current.currentTime = targetTime;
                setCurrentTime(targetTime);
                if (audio.duration) {
                    setProgress((targetTime / audio.duration) * 100);
                }
            }
        };

        const handleSeeked = () => {
            // Seek operation completed, allow timeupdate to resume
            const seekedTime = audioRef.current?.currentTime || 0;
            devLog("Seeked event fired, currentTime:", seekedTime, "isSeeking:", isSeekingRef.current, "pendingSeek:", pendingSeekTimeRef.current);

            // If currentTime is near 0 but we were seeking, something reset the audio
            if (isSeekingRef.current && seekedTime < 1 && pendingSeekTimeRef.current !== null && pendingSeekTimeRef.current > 1 && audioRef.current) {
                console.error("Seeked event fired but currentTime is near 0 - audio was reset! Restoring to", pendingSeekTimeRef.current);
                // Restore the seek position immediately
                audioRef.current.currentTime = pendingSeekTimeRef.current;
                setCurrentTime(pendingSeekTimeRef.current);
                if (audioRef.current.duration) {
                    setProgress((pendingSeekTimeRef.current / audioRef.current.duration) * 100);
                }
                // Set a flag to prevent clearing on the next seeked event if it fires too quickly
                setTimeout(() => {
                    if (isSeekingRef.current && Math.abs((audioRef.current?.currentTime || 0) - pendingSeekTimeRef.current!) < 0.5) {
                        isSeekingRef.current = false;
                        pendingSeekTimeRef.current = null;
                    }
                }, 100);
                return;
            }

            // Clear the seeking flag and pending seek time
            isSeekingRef.current = false;
            pendingSeekTimeRef.current = null;
            if (audioRef.current) {
                setCurrentTime(audioRef.current.currentTime);
                if (audioRef.current.duration) {
                    setProgress((audioRef.current.currentTime / audioRef.current.duration) * 100);
                }
            }
        };

        const handleEnded = () => {
            const q = queueRef.current;
            const idx = currentIndexRef.current;
            const rMode = repeatModeRef.current;

            const loop = segmentLoopRef.current;
            if (loop) {
                audio.currentTime = loop.start;
                void safePlay();
                return;
            }
            let finiteTrackReplay = false;
            if (finiteRepeatRef.current?.target === "track") {
                const result = consumeRepeat(finiteRepeatRef.current);
                finiteTrackReplay = result.replay;
                updateFiniteRepeat(result.plan);
            }
            if (rMode === "one" || finiteTrackReplay) {
                const activeTrack = q[idx] ?? null;
                playbackCompletedTrackRef.current = null;
                playbackInstanceIdRef.current = createPlaybackAnalyticsInstanceId();
                playbackHeartbeatBucketsRef.current = new Set();
                if (audioRef.current) {
                    audioRef.current.currentTime = 0;
                    recordPlaybackLifecycleEvent("started", activeTrack, 0);
                    void safePlay();
                }
                return;
            }

            if (shuffleRef.current || idx < q.length - 1 || rMode === "all" || finiteRepeatRef.current?.target === "queue") {
                nextTrackRef.current(true);
            } else {
                setIsPlaying(false);
            }
        };

        const handleError = () => {
            const e = audio.error;
            console.error("[Audio] Media error:", e?.code, e?.message, "src:", audio.src?.substring(0, 80));
        };

        audio.addEventListener("timeupdate", handleTimeUpdate);
        audio.addEventListener("loadedmetadata", handleLoadedMetadata);
        audio.addEventListener("seeked", handleSeeked);
        audio.addEventListener("ended", handleEnded);
        audio.addEventListener("error", handleError);

        // One-time audio context unlock via Web Audio API
        // Uses AudioContext.resume() which doesn't touch the HTMLAudioElement,
        // avoiding race conditions with playTrack setting src.
        let unlockInProgress = false;
        const unlockAudio = () => {
            if (unlockInProgress) return;
            unlockInProgress = true;
            const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
            ctx.resume().then(() => {
                devLog("[PlayerProvider] Audio context unlocked via user gesture");
                void ctx.close();
                document.removeEventListener("click", unlockAudio, true);
                document.removeEventListener("keydown", unlockAudio, true);
            }).catch(() => {
                // Will retry on next interaction
                unlockInProgress = false;
            });
        };
        document.addEventListener("click", unlockAudio, true);
        document.addEventListener("keydown", unlockAudio, true);

        return () => {
            document.removeEventListener("click", unlockAudio, true);
            document.removeEventListener("keydown", unlockAudio, true);
            audio.removeEventListener("timeupdate", handleTimeUpdate);
            audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
            audio.removeEventListener("seeked", handleSeeked);
            audio.removeEventListener("ended", handleEnded);
            audio.removeEventListener("error", handleError);
            audio.pause();
            audio.src = "";
            currentTrackIdRef.current = null;
            currentTrackUrlRef.current = null;
            playbackInstanceIdRef.current = null;
            playbackHeartbeatBucketsRef.current = new Set();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const togglePlay = useCallback(() => {
        if (isPlaying) {
            safePause();
        } else {
            // If we have a current track but audio isn't loaded (e.g. after hydration or track selection), load and play it
            const track = currentIndex >= 0 ? queue[currentIndex] : null;
            const audioHasTrack = audioRef.current?.src && currentTrackIdRef.current === track?.id;
            if (track && !audioHasTrack) {
                void playQueue(queue, currentIndex, { navigation: true });
            } else {
                void safePlay();
            }
        }
    }, [isPlaying, currentIndex, queue, safePause, safePlay, playQueue]);

    const stop = useCallback(() => {
        safePause();
        if (audioRef.current) {
            audioRef.current.currentTime = 0;
        }
    }, [safePause]);

    const handleStemPlaybackStarted = useCallback((type: string) => {
        const stemVolume = mixerVolumesRef.current[type.toLowerCase()] ?? 1;
        if (stemVolume <= 0 || volume <= 0) {
            devLog(`[Mixer] Stem ${type} started muted; keeping master audible until an audible stem plays`);
            return;
        }

        mixerAudioActiveRef.current = true;
        setMixerAudioActive(true);
        if (mixerModeRef.current && audioRef.current) {
            audioRef.current.volume = 0;
        }
    }, [volume]);

    // Sync stems with main audio
    useEffect(() => {
        if (!mixerMode || !audioRef.current) return;

        const mainAudio = audioRef.current;

        const syncStems = () => {
            const masterTime = mainAudio.currentTime;
            const stems = Object.entries(stemAudiosRef.current);

            stems.forEach(([type, stem]) => {
                // If it's more than 100ms off, snap it.
                // Frequent snapping causes audio badness, so we only do it for large drifts.
                if (Math.abs(stem.currentTime - masterTime) > 0.2) {
                    stem.currentTime = masterTime;
                }

                // Keep play states in sync
                if (mainAudio.paused && !stem.paused) stem.pause();
                else if (!mainAudio.paused && stem.paused) {
                    stem.play()
                        .then(() => handleStemPlaybackStarted(type))
                        .catch(() => { });
                }
            });
        };

        const interval = setInterval(syncStems, 500); // Less frequent sync to reduce CPU
        return () => clearInterval(interval);
    }, [handleStemPlaybackStarted, mixerMode, isPlaying, currentTrack?.id]);

    const handleStemMount = useCallback((type: string, el: HTMLAudioElement) => {
        stemAudiosRef.current[type] = el;
    }, []);

    const handleStemUnmount = useCallback((type: string) => {
        delete stemAudiosRef.current[type];
    }, []);

    useEffect(() => {
        if (!audioRef.current) return;
        const onPlay = () => {
            devLog('[main audio] play event fired, mixerMode:', mixerMode);
            // CRITICAL: Sync React state with actual audio state
            setIsPlaying(true);
            if (mixerMode) {
                const masterTime = main.currentTime;
                Object.entries(stemAudiosRef.current).forEach(([type, s]) => {
                    // Sync time BEFORE playing to prevent 1-second loop
                    if (Math.abs(s.currentTime - masterTime) > 0.1) {
                        s.currentTime = masterTime;
                    }
                    s.play()
                        .then(() => handleStemPlaybackStarted(type))
                        .catch(() => { });
                });
            }
        };
        const onPause = () => {
            devLog('[main audio] pause event fired, mixerMode:', mixerMode);
            // CRITICAL: Sync React state with actual audio state
            setIsPlaying(false);
            if (mixerMode) Object.values(stemAudiosRef.current).forEach(s => s.pause());
        };
        const main = audioRef.current;
        main.addEventListener('play', onPlay);
        main.addEventListener('pause', onPause);
        return () => {
            main.removeEventListener('play', onPlay);
            main.removeEventListener('pause', onPause);
        };
    }, [handleStemPlaybackStarted, mixerMode, currentTrack?.id]);

    const seek = useCallback((percent: number) => {
        if (!audioRef.current) return;
        const requestedTime = (percent / 100) * (audioRef.current.duration || 0);
        const loop = segmentLoopRef.current;
        const targetTime = loop ? Math.max(loop.start, Math.min(requestedTime, loop.end - 0.001)) : requestedTime;

        isSeekingRef.current = true;
        audioRef.current.currentTime = targetTime;
        setProgress(percent);
        setCurrentTime(targetTime);

        if (mixerMode) {
            Object.values(stemAudiosRef.current).forEach(s => {
                s.currentTime = targetTime;
            });
        }
    }, [mixerMode]);

    useEffect(() => {
        if (!mixerMode) {
            mixerAudioActiveRef.current = false;
            setMixerAudioActive(false);
        }
    }, [mixerMode]);

    const setVolume = useCallback((value: number) => {
        const next = setPlayerVolume({
            volume,
            muted,
            previousNonZeroVolume: previousNonZeroVolumeRef.current,
        }, value);
        const nextVolume = next.volume;
        previousNonZeroVolumeRef.current = next.previousNonZeroVolume;
        setMuted(next.muted);
        setVolumeState(next.volume);
        if (audioRef.current) {
            audioRef.current.volume = mixerMode && mixerAudioActiveRef.current ? 0 : nextVolume;
        }
        if (mixerMode) {
            Object.entries(mixerVolumes).forEach(([type, vol]) => {
                const audio = stemAudiosRef.current[type];
                if (audio) {
                    audio.volume = vol * nextVolume; // Scale stem by master volume
                }
            });
        }
    }, [mixerMode, mixerVolumes, muted, volume]);

    const toggleMute = useCallback(() => {
        const next = togglePlayerMute({
            volume,
            muted,
            previousNonZeroVolume: previousNonZeroVolumeRef.current,
        });
        setVolume(next.volume);
    }, [muted, setVolume, volume]);

    const addTracksToQueue = useCallback((tracks: LocalTrack[]) => {
        const result = appendQueueTracks(queueRef.current, tracks);
        queueRef.current = result.queue;
        setQueue(result.queue);
        if (shuffleRef.current) {
            shuffleCycleRef.current = reconcileShuffleCycle(
                shuffleCycleRef.current,
                result.queue.map((track) => track.id),
                result.queue[currentIndexRef.current]?.id ?? null,
            );
        }
        return result;
    }, []);

    const playTracksNext = useCallback((tracks: LocalTrack[]) => {
        const wasEmpty = queueRef.current.length === 0;
        const activeTrackId = queueRef.current[currentIndexRef.current]?.id ?? null;
        const result = insertQueueTracksNext(queueRef.current, currentIndexRef.current, tracks);
        queueRef.current = result.queue;
        setQueue(result.queue);
        const activeIndex = activeTrackId
            ? result.queue.findIndex((track) => track.id === activeTrackId)
            : -1;
        if (activeIndex !== currentIndexRef.current) {
            currentIndexRef.current = activeIndex;
            setCurrentIndex(activeIndex);
        }
        if (shuffleRef.current) {
            pendingShuffleNextRef.current = tracks
                .map((track) => track.id)
                .filter((trackId) => trackId !== activeTrackId && result.queue.some((track) => track.id === trackId));
            shuffleCycleRef.current = reconcileShuffleCycle(
                shuffleCycleRef.current,
                result.queue.map((track) => track.id),
                activeTrackId,
            );
        }
        if (wasEmpty && result.added.length > 0) void playQueue(result.queue, 0);
        return result;
    }, [playQueue]);

    const addToQueue = useCallback((track: LocalTrack) => {
        return addTracksToQueue([track]);
    }, [addTracksToQueue]);

    const playNextInQueue = useCallback((track: LocalTrack) => {
        return playTracksNext([track]);
    }, [playTracksNext]);

    const removeFromQueue = useCallback((index: number) => {
        const currentQueue = queueRef.current;
        if (index < 0 || index >= currentQueue.length) return;
        if (index === currentIndexRef.current && isSeekingRef.current) return;
        const nextQueue = currentQueue.filter((_, queueIndex) => queueIndex !== index);
        const activeIndex = currentIndexRef.current;
        queueRef.current = nextQueue;

        if (nextQueue.length === 0) {
            clearFiniteRepeat();
            segmentLoopRef.current = null;
            setSegmentLoopState(null);
            setQueueSource(null);
            setQueue([]);
            setCurrentIndex(-1);
            currentIndexRef.current = -1;
            shuffleCycleRef.current = createShuffleCycleState();
            safePause();
            return;
        }

        const nextIndex = index < activeIndex
            ? activeIndex - 1
            : Math.min(activeIndex, nextQueue.length - 1);
        setQueue(nextQueue);
        setCurrentIndex(nextIndex);
        currentIndexRef.current = nextIndex;
        shuffleCycleRef.current = reconcileShuffleCycle(
            shuffleCycleRef.current,
            nextQueue.map((track) => track.id),
            nextQueue[nextIndex]?.id ?? null,
        );
        if (index === activeIndex) void playQueue(nextQueue, nextIndex, { navigation: true });
    }, [playQueue, safePause, clearFiniteRepeat]);

    const toggleMixerMode = useCallback(() => {
        mixerAudioActiveRef.current = false;
        setMixerAudioActive(false);
        setMixerMode(prev => {
            const nextMode = !prev;
            devLog('[toggleMixerMode] Switching from', prev, 'to', nextMode);
            mixerModeRef.current = nextMode;
            // Synchronously update master volume to prevent leakage/phase issues
            if (audioRef.current) {
                const hasStems = currentTrack?.stems?.some(s => s.type.toUpperCase() !== 'ORIGINAL');
                const newVolume = (nextMode && hasStems && mixerAudioActiveRef.current) ? 0 : volume;
                const isActuallyPlaying = !audioRef.current.paused;
                devLog('[toggleMixerMode] Setting main audio volume to', newVolume, 'hasStems:', hasStems, 'mixerAudioActive:', mixerAudioActiveRef.current, 'isActuallyPlaying:', isActuallyPlaying);
                audioRef.current.volume = newVolume;
            } else {
                devLog('[toggleMixerMode] No audioRef.current!');
            }
            return nextMode;
        });
    }, [currentTrack?.stems, volume]);

    const setMixerVolumes = useCallback((v: Record<string, number>) => {
        devLog('[setMixerVolumes] Updating volumes:', v, 'registered stems:', Object.keys(stemAudiosRef.current));
        mixerVolumesRef.current = v;
        setMixerVolumesState(v);
        Object.entries(v).forEach(([type, vol]) => {
            const audio = stemAudiosRef.current[type];
            if (audio) {
                const effectiveVol = vol * volume;
                devLog(`[setMixerVolumes] Setting ${type} volume to ${effectiveVol} (mixer: ${vol}, master: ${volume})`);
                audio.volume = effectiveVol;
            } else {
                devLog(`[setMixerVolumes] No audio element found for ${type}`);
            }
        });

        if (mixerModeRef.current && audioRef.current) {
            const hasAudiblePlayingStem = Object.entries(v).some(([type, vol]) => {
                const audio = stemAudiosRef.current[type];
                return vol > 0 && !!audio && !audio.paused;
            });
            mixerAudioActiveRef.current = hasAudiblePlayingStem;
            setMixerAudioActive(hasAudiblePlayingStem);
            audioRef.current.volume = hasAudiblePlayingStem ? 0 : volume;
        }
    }, [volume]);

    const stemsToRender = mixerMode && currentTrack?.id
        ? (currentTrack.stems?.filter(s => {
            const type = s.type.toUpperCase();
            return type !== 'ORIGINAL' && type !== 'MASTER';
        }) || [])
        : [];

    const contextValue = React.useMemo<PlayerContextType>(() => ({
        segmentLoop, setSegmentLoop, clearSegmentLoop, finiteRepeat, setFiniteRepeat, clearFiniteRepeat,
        queueSource,
        queueSourceKind: queueSourceKind(queue, queueSource),
        currentTrack,
        queue,
        currentIndex,
        isPlaying,
        progress,
        currentTime,
        duration,
        artworkUrl,
        volume,
        muted,
        shuffle,
        repeatMode,
        playQueue,
        nextTrack,
        prevTrack,
        togglePlay,
        toggleShuffle,
        toggleRepeatMode,
        seek,
        setVolume,
        toggleMute,
        stop,
        addToQueue,
        playNext: playNextInQueue,
        addTracksToQueue,
        playTracksNext,
        removeFromQueue,
        mixerMode,
        toggleMixerMode,
        mixerVolumes,
        setMixerVolumes,
    }), [
        segmentLoop, setSegmentLoop, clearSegmentLoop, finiteRepeat, setFiniteRepeat, clearFiniteRepeat,
        queueSource, currentTrack, queue, currentIndex, isPlaying, progress, currentTime,
        duration, artworkUrl, volume, muted, shuffle, repeatMode, playQueue, nextTrack,
        prevTrack, togglePlay, toggleShuffle, toggleRepeatMode, seek, setVolume, toggleMute,
        stop, addToQueue, playNextInQueue, addTracksToQueue, playTracksNext, removeFromQueue,
        mixerMode, toggleMixerMode, mixerVolumes,
        setMixerVolumes,
    ]);

    return (
        <PlayerContext.Provider value={contextValue}>
            {children}
            {stemsToRender.length > 0 && (
                <div style={{ display: 'none' }}>
                    {stemsToRender.map(stem => (
                        <StemAudio
                            key={stem.type.toLowerCase()}
                            stem={stem}
                            masterAudio={audioRef.current}
                            isPlaying={isPlaying}
                            volume={volume}
                            mixerVolume={mixerVolumes[stem.type.toLowerCase()] ?? 1}
                            enabled={mixerMode}
                            onMount={handleStemMount}
                            onUnmount={handleStemUnmount}
                            onPlaybackStarted={handleStemPlaybackStarted}
                        />
                    ))}
                </div>
            )}
        </PlayerContext.Provider>
    );
}

export function usePlayer() {
    const context = useContext(PlayerContext);
    if (!context) {
        throw new Error("usePlayer must be used within a PlayerProvider");
    }
    return context;
}
