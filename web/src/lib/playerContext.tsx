"use client";
import { getAddress } from "viem";

// Simple Mutex for synchronization (currently unused, kept for future use)
// class Mutex {
//     private promise: Promise<void> = Promise.resolve();
//     async lock() {
//         let unlockNext: () => void;
//         const nextPromise = new Promise<void>((resolve) => {
//             unlockNext = resolve;
//         });
//         const prevPromise = this.promise;
//         this.promise = nextPromise;
//         await prevPromise;
//         return unlockNext!;
//     }
// }

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
import { LocalTrack, getTrackUrl, getArtworkUrl, savePlayerState, loadPlayerState } from "./localLibrary";

interface PlayerContextType {
    currentTrack: LocalTrack | null;
    queue: LocalTrack[];
    currentIndex: number;
    isPlaying: boolean;
    progress: number; // 0 to 100
    currentTime: number;
    duration: number;
    artworkUrl: string | null;
    volume: number;
    shuffle: boolean;
    repeatMode: "none" | "one" | "all";
    playQueue: (list: LocalTrack[], startIndex: number) => Promise<void>;
    nextTrack: () => void;
    prevTrack: () => void;
    togglePlay: () => void;
    toggleShuffle: () => void;
    toggleRepeatMode: () => void;
    seek: (percent: number) => void;
    setVolume: (value: number) => void;
    stop: () => void;
    addToQueue: (track: LocalTrack) => void;
    playNext: (track: LocalTrack) => void;
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
    onMount: (type: string, el: HTMLAudioElement) => void;
    onUnmount: (type: string) => void;
}

const StemAudio = React.memo(({ stem, masterAudio, isPlaying, volume, mixerVolume, onMount, onUnmount }: StemAudioProps) => {
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const [streamUrl, setStreamUrl] = useState<string | null>(null);
    const [_isDecrypting, setIsDecrypting] = useState(false); // eslint-disable-line @typescript-eslint/no-unused-vars
    const { signMessage, address } = useAuth();
    const type = stem.type.toLowerCase();

    // 1. Handle Decryption and Object URLs
    useEffect(() => {
        let active = true;
        const currentUri = stem.uri;

        const loadAudio = async () => {
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
                if (!address) throw new Error("No wallet connected for decryption");

                const authSig = await getAuthSig(signMessage, address);

                devLog(`[StemAudio:${type}] Requesting proxy decryption from backend...`);

                // Send the raw metadata - backend handles both AES and legacy Lit formats
                const rawMetadata = stem.encryptionMetadata || "";

                const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";
                const proxyResponse = await fetch(`${apiBase}/encryption/decrypt`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
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
    }, [stem.uri, stem.isEncrypted, stem.encryptionMetadata, address, signMessage, type]);

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
            return;
        }

        const audio = audioRef.current;
        devLog(`[StemAudio:${type}] streamUrl available, loading audio...`);

        // Set src and load explicitly - React's attribute update doesn't trigger load
        audio.src = streamUrl;
        audio.load();

        // Set volume
        const effectiveVolume = mixerVolume * volume;
        audio.volume = effectiveVolume;
        devLog(`[StemAudio:${type}] Volume set to ${effectiveVolume}`);

        // Start playback when ready
        const playWhenReady = () => {
            // Check current playing state via ref
            if (isPlayingRef.current) {
                devLog(`[StemAudio:${type}] canplay event - starting playback`);
                // CRITICAL: Sync time with master audio BEFORE playing
                if (masterAudio) {
                    const targetTime = masterAudio.currentTime;
                    if (Math.abs(audio.currentTime - targetTime) > 0.1) {
                        devLog(`[StemAudio:${type}] Syncing to master time in canplay:`, targetTime);
                        audio.currentTime = targetTime;
                    }
                }
                audio.play().catch((err) => {
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
    }, [streamUrl, type, mixerVolume, volume, masterAudio]); // Include volume deps for initial volume set

    // Update volume whenever mixerVolume or master volume changes
    useEffect(() => {
        if (audioRef.current && streamUrl) {
            const effectiveVolume = mixerVolume * volume;
            devLog(`[StemAudio:${type}] Setting volume: ${effectiveVolume} (mixer: ${mixerVolume}, master: ${volume})`);
            audioRef.current.volume = effectiveVolume;
        }
    }, [mixerVolume, volume, type, streamUrl]);

    // Play/pause stems based on isPlaying state - only when streamUrl is available
    useEffect(() => {
        if (!audioRef.current || !streamUrl) {
            return;
        }

        if (isPlaying) {
            devLog(`[StemAudio:${type}] isPlaying changed to true, attempting play`);
            // CRITICAL: Sync time with master audio BEFORE playing
            if (masterAudio && audioRef.current.readyState >= 1) {
                const targetTime = masterAudio.currentTime;
                if (Math.abs(audioRef.current.currentTime - targetTime) > 0.1) {
                    devLog(`[StemAudio:${type}] Syncing to master time before play:`, targetTime);
                    audioRef.current.currentTime = targetTime;
                }
            }
            audioRef.current.play().catch((err) => {
                devLog(`[StemAudio:${type}] Play failed:`, err.name);
            });
        } else {
            devLog(`[StemAudio:${type}] isPlaying changed to false, pausing`);
            audioRef.current.pause();
        }
    }, [isPlaying, type, streamUrl, masterAudio]);

    // Keep audio element mounted even during decryption to maintain ref stability
    // Note: src is set programmatically in useEffect to ensure load() is called
    return (
        <audio
            ref={audioRef}
            preload="auto"
            onLoadStart={() => {
                devLog(`[StemAudio:${type}] onLoadStart - loading audio from blob`);
            }}
            onLoadedMetadata={(e) => {
                devLog(`[StemAudio:${type}] onLoadedMetadata - duration:`, e.currentTarget.duration);
                // Set volume immediately when metadata loads
                e.currentTarget.volume = mixerVolume * volume;
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
                e.currentTarget.volume = mixerVolume * volume;
            }}
            onPlay={() => {
                devLog(`[StemAudio:${type}] onPlay - stem is now playing`);
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
    const [queue, setQueue] = useState<LocalTrack[]>([]);
    const [currentIndex, setCurrentIndex] = useState(-1);
    const [isPlaying, setIsPlaying] = useState(false);
    const [progress, setProgress] = useState(0);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [artworkUrl, setArtworkUrl] = useState<string | null>(null);
    const [volume, setVolumeState] = useState(0.8);
    const [shuffle, setShuffle] = useState(false);
    const [repeatMode, setRepeatMode] = useState<"none" | "one" | "all">("none");
    const [isHydrated, setIsHydrated] = useState(false);
    const [mixerMode, setMixerMode] = useState(false);
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

    // Stable function refs for event listeners
    const nextTrackRef = useRef<() => void>(() => { });
    const queueRef = useRef<LocalTrack[]>([]);
    const currentIndexRef = useRef(-1);
    const shuffleRef = useRef(false);
    const repeatModeRef = useRef<"none" | "one" | "all">("none");
    const mixerModeRef = useRef(false); // Synchronous tracker for mixer mode

    const currentTrack = currentIndex >= 0 ? queue[currentIndex] : null;

    // Mute main track when mixer mode is active and we have stems to play
    useEffect(() => {
        if (audioRef.current) {
            const hasStems = currentTrack?.stems?.some(s => s.type.toUpperCase() !== 'ORIGINAL');
            const shouldMute = mixerMode && hasStems;
            devLog('[Volume Effect] mixerMode:', mixerMode, 'hasStems:', hasStems, 'shouldMute:', shouldMute);
            audioRef.current.volume = shouldMute ? 0 : volume;
        }
    }, [volume, mixerMode, currentTrack?.id, currentTrack?.stems]);

    // Note: isPlaying state sync is handled by play/pause event listeners on main audio element

    // Hydration Effect
    useEffect(() => {
        const hydrate = async () => {
            try {
                const saved = await loadPlayerState();
                if (saved) {
                    setQueue(saved.queue);
                    setCurrentIndex(saved.currentIndex);
                    setVolumeState(saved.volume);
                    setShuffle(saved.shuffle);
                    setRepeatMode(saved.repeatMode);

                    // Pre-load artwork if track exists
                    if (saved.currentIndex >= 0 && saved.queue[saved.currentIndex]) {
                        const art = await getArtworkUrl(saved.queue[saved.currentIndex]);
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
                shuffle,
                repeatMode
            }).catch(err => console.error("Failed to save player state:", err));
        }
    }, [queue, currentIndex, volume, shuffle, repeatMode, isHydrated]);

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

    const playTrack = useCallback(async (track: LocalTrack) => {
        if (!audioRef.current) return;

        // Don't reset if we're currently seeking - check FIRST before any async operations
        if (isSeekingRef.current) {
            console.warn("playTrack: seek in progress, aborting track load");
            return;
        }

        // Synchronous pause to preserve user gesture
        // But only if we are actually changing something
        const url = await getTrackUrl(track);

        if (currentTrackIdRef.current === track.id && currentTrackUrlRef.current === url) {
            devLog("playTrack: same track and resolved URL, resuming playback", track.id);
            if (audioRef.current) {
                const hasStems = track.stems?.some(s => s.type.toUpperCase() !== 'ORIGINAL');
                audioRef.current.volume = (mixerModeRef.current && hasStems) ? 0 : volume;
            }
            void safePlay();
            return;
        }

        devLog("playTrack: loading new track/stem", track.id, "URL changed:", currentTrackUrlRef.current !== url);
        safePause();

        const art = await getArtworkUrl(track);

        // CRITICAL: Check AGAIN after async operations - seek might have started
        if (isSeekingRef.current) {
            console.warn("playTrack: seek started during async operation, aborting src change");
            return;
        }

        if (!audioRef.current) return; // Check again in case audio was cleared

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
            audioRef.current.volume = (mixerModeRef.current && hasStems) ? 0 : volume;
            setArtworkUrl(art || null);
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
        audioRef.current.volume = (mixerModeRef.current && hasStems) ? 0 : volume;
        devLog('[playTrack] Setting volume:', audioRef.current.volume, 'mixerModeRef:', mixerModeRef.current, 'hasStems:', hasStems);
        setArtworkUrl(art || null);
        currentTrackIdRef.current = track.id;
    // NOTE: mixerMode intentionally excluded - we use mixerModeRef.current to avoid
    // cascading recreation of playQueue → nextTrack → togglePlay on mixer toggle
    }, [volume, safePause, safePlay]);

    const playQueue = useCallback(async (list: LocalTrack[], startIndex: number) => {
        const trackToPlay = list[startIndex];

        // Don't reset if we're currently seeking - this is critical!
        if (isSeekingRef.current) {
            console.warn("playQueue: seek in progress, aborting queue update");
            return;
        }

        // Update queue state
        setQueue(list);
        setCurrentIndex(startIndex);

        devLog("playQueue: playing track", trackToPlay.id, "at index", startIndex);
        await playTrack(trackToPlay);
    }, [playTrack]);

    const nextTrack = useCallback(() => {
        const q = queueRef.current;
        const idx = currentIndexRef.current;
        const isShuffle = shuffleRef.current;
        const rMode = repeatModeRef.current;

        if (q.length === 0) return;

        if (isShuffle) {
            const nextIdx = Math.floor(Math.random() * q.length);
            void playQueue(q, nextIdx);
            return;
        }

        if (idx < q.length - 1) {
            void playQueue(q, idx + 1);
        } else if (rMode === "all") {
            void playQueue(q, 0); // Loop back to start
        } else {
            setIsPlaying(false);
        }
    }, [playQueue]);

    const prevTrack = useCallback(() => {
        const q = queueRef.current;
        const idx = currentIndexRef.current;
        if (idx > 0) {
            void playQueue(q, idx - 1);
        } else if (repeatModeRef.current === "all" && q.length > 0) {
            void playQueue(q, q.length - 1); // Loop to end
        }
    }, [playQueue]);

    const toggleShuffle = useCallback(() => setShuffle(prev => !prev), []);
    const toggleRepeatMode = useCallback(() => {
        setRepeatMode(prev => {
            if (prev === "none") return "all";
            if (prev === "all") return "one";
            return "none";
        });
    }, []);

    // Sync refs for event listeners
    useEffect(() => {
        queueRef.current = queue;
        currentIndexRef.current = currentIndex;
        nextTrackRef.current = nextTrack;
        shuffleRef.current = shuffle;
        repeatModeRef.current = repeatMode;
    }, [queue, currentIndex, nextTrack, shuffle, repeatMode]);

    // Persistent Audio initialiser with stable listener bridge
    useEffect(() => {
        const audio = new Audio();
        audioRef.current = audio;

        const handleTimeUpdate = () => {
            // Don't update progress if we're currently seeking
            if (isSeekingRef.current) return;

            setCurrentTime(audio.currentTime);
            setDuration(audio.duration || 0);
            setProgress((audio.currentTime / (audio.duration || 1)) * 100);
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

            if (rMode === "one") {
                if (audioRef.current) {
                    audioRef.current.currentTime = 0;
                    void safePlay();
                }
                return;
            }

            if (idx < q.length - 1 || rMode === "all") {
                nextTrackRef.current();
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
                void playQueue(queue, currentIndex);
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

    // Sync stems with main audio
    useEffect(() => {
        if (!mixerMode || !audioRef.current) return;

        const mainAudio = audioRef.current;

        const syncStems = () => {
            const masterTime = mainAudio.currentTime;
            const stems = Object.values(stemAudiosRef.current);

            stems.forEach(stem => {
                // If it's more than 100ms off, snap it.
                // Frequent snapping causes audio badness, so we only do it for large drifts.
                if (Math.abs(stem.currentTime - masterTime) > 0.2) {
                    stem.currentTime = masterTime;
                }

                // Keep play states in sync
                if (mainAudio.paused && !stem.paused) stem.pause();
                else if (!mainAudio.paused && stem.paused) stem.play().catch(() => { });
            });
        };

        const interval = setInterval(syncStems, 500); // Less frequent sync to reduce CPU
        return () => clearInterval(interval);
    }, [mixerMode, isPlaying, currentTrack?.id]);

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
                Object.values(stemAudiosRef.current).forEach(s => {
                    // Sync time BEFORE playing to prevent 1-second loop
                    if (Math.abs(s.currentTime - masterTime) > 0.1) {
                        s.currentTime = masterTime;
                    }
                    s.play().catch(() => { });
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
    }, [mixerMode, currentTrack?.id]);

    const seek = useCallback((percent: number) => {
        if (!audioRef.current) return;
        const targetTime = (percent / 100) * (audioRef.current.duration || 0);

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

    const setVolume = useCallback((value: number) => {
        setVolumeState(value);
        if (audioRef.current) {
            audioRef.current.volume = mixerMode ? 0 : value;
        }
        if (mixerMode) {
            Object.entries(mixerVolumes).forEach(([type, vol]) => {
                const audio = stemAudiosRef.current[type];
                if (audio) {
                    audio.volume = vol * value; // Scale stem by master volume
                }
            });
        }
    }, [mixerMode, mixerVolumes]);

    const addToQueue = useCallback((track: LocalTrack) => {
        setQueue(prev => [...prev, track]);
    }, []);

    const playNextInQueue = useCallback((track: LocalTrack) => {
        const idx = currentIndexRef.current;
        if (idx === -1) {
            void playQueue([track], 0);
        } else {
            setQueue(prev => {
                const newQueue = [...prev];
                newQueue.splice(currentIndexRef.current + 1, 0, track);
                return newQueue;
            });
        }
    }, [playQueue]);

    const toggleMixerMode = useCallback(() => {
        setMixerMode(prev => {
            const nextMode = !prev;
            devLog('[toggleMixerMode] Switching from', prev, 'to', nextMode);
            mixerModeRef.current = nextMode;
            // Synchronously update master volume to prevent leakage/phase issues
            if (audioRef.current) {
                const hasStems = currentTrack?.stems?.some(s => s.type.toUpperCase() !== 'ORIGINAL');
                const newVolume = (nextMode && hasStems) ? 0 : volume;
                const isActuallyPlaying = !audioRef.current.paused;
                devLog('[toggleMixerMode] Setting main audio volume to', newVolume, 'hasStems:', hasStems, 'isActuallyPlaying:', isActuallyPlaying);
                audioRef.current.volume = newVolume;
            } else {
                devLog('[toggleMixerMode] No audioRef.current!');
            }
            return nextMode;
        });
    }, [currentTrack?.stems, volume]);

    const setMixerVolumes = useCallback((v: Record<string, number>) => {
        devLog('[setMixerVolumes] Updating volumes:', v, 'registered stems:', Object.keys(stemAudiosRef.current));
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
    }, [volume]);

    const stemsToRender = mixerMode && currentTrack?.id
        ? (currentTrack.stems?.filter(s => s.type.toUpperCase() !== 'ORIGINAL') || [])
        : [];

    const contextValue = React.useMemo<PlayerContextType>(() => ({
        currentTrack,
        queue,
        currentIndex,
        isPlaying,
        progress,
        currentTime,
        duration,
        artworkUrl,
        volume,
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
        stop,
        addToQueue,
        playNext: playNextInQueue,
        mixerMode,
        toggleMixerMode,
        mixerVolumes,
        setMixerVolumes,
    }), [
        currentTrack, queue, currentIndex, isPlaying, progress, currentTime,
        duration, artworkUrl, volume, shuffle, repeatMode, playQueue, nextTrack,
        prevTrack, togglePlay, toggleShuffle, toggleRepeatMode, seek, setVolume,
        stop, addToQueue, playNextInQueue, mixerMode, toggleMixerMode, mixerVolumes,
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
                            onMount={handleStemMount}
                            onUnmount={handleStemUnmount}
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
