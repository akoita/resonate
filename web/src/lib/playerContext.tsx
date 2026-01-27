"use client";

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
}

const PlayerContext = createContext<PlayerContextType | undefined>(undefined);

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

    const currentTrack = currentIndex >= 0 ? queue[currentIndex] : null;

    // Persist volume immediately when changed locally
    useEffect(() => {
        if (audioRef.current) {
            audioRef.current.volume = volume;
        }
    }, [volume]);

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
        if (!audioRef.current || !audioRef.current.src) return;
        let promise: Promise<void> | undefined;
        try {
            promise = audioRef.current.play();
            playPromiseRef.current = promise;
            await promise;
            setIsPlaying(true);
        } catch (error: unknown) {
            if (error instanceof Error) {
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

        // Only load new track if it's different from the current one
        if (currentTrackIdRef.current === track.id) {
            console.log("playTrack: same track, skipping reset", track.id);
            // Same track, just ensure volume is set and resume if needed
            audioRef.current.volume = volume;
            return;
        }

        console.log("playTrack: loading new track", track.id, "current:", currentTrackIdRef.current);
        // Synchronous pause to preserve user gesture
        safePause();

        const url = await getTrackUrl(track);
        const art = await getArtworkUrl(track);

        // CRITICAL: Check AGAIN after async operations - seek might have started
        if (isSeekingRef.current) {
            console.warn("playTrack: seek started during async operation, aborting src change");
            return;
        }

        if (!audioRef.current) return; // Check again in case audio was cleared

        if (url) {
            // Only set src if it's actually different to avoid resetting playback
            // Check both the audio element's src and our cached ref
            const currentSrc = audioRef.current.src;

            // Normalize URLs for comparison (remove trailing slashes, etc.)
            const normalizeUrl = (u: string) => u.replace(/\/$/, '');
            const currentSrcNormalized = currentSrc ? normalizeUrl(currentSrc) : '';
            const urlNormalized = normalizeUrl(url);

            // If src is already set to this URL, don't change it (this prevents reset)
            if (currentSrcNormalized === urlNormalized || currentTrackUrlRef.current === url) {
                console.log("playTrack: src already set, skipping", url.substring(0, 50));
                audioRef.current.volume = volume;
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

            console.log("playTrack: setting new src", url.substring(0, 50), "saving time:", savedTime);
            audioRef.current.src = url;
            currentTrackUrlRef.current = url;

            // If we had a valid position and it wasn't near the start, try to restore it
            if (savedTime > 1 && audioRef.current.duration && savedTime < audioRef.current.duration) {
                // Wait for metadata to load, then restore position
                const restorePosition = () => {
                    if (audioRef.current && audioRef.current.readyState >= 1) {
                        console.log("playTrack: restoring position to", savedTime);
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
                void safePlay();
            }
            audioRef.current.volume = volume;
            setArtworkUrl(art || null);
            currentTrackIdRef.current = track.id;
        }
    }, [volume, safePause, safePlay]);

    const playQueue = useCallback(async (list: LocalTrack[], startIndex: number) => {
        const trackToPlay = list[startIndex];

        // Don't reset if we're currently seeking - this is critical!
        if (isSeekingRef.current) {
            console.warn("playQueue: seek in progress, aborting queue update");
            return;
        }

        // If we're already playing this exact track at this exact index, don't reset
        if (currentTrackIdRef.current === trackToPlay.id && currentIndexRef.current === startIndex) {
            console.log("playQueue: same track and index, skipping", trackToPlay.id, startIndex);
            // Just update the queue/index state without resetting playback
            setQueue(list);
            setCurrentIndex(startIndex);
            return;
        }

        console.log("playQueue: loading track", trackToPlay.id, "at index", startIndex);
        setQueue(list);
        setCurrentIndex(startIndex);
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
                console.log("handleLoadedMetadata: restoring seek position to", targetTime);
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
            console.log("Seeked event fired, currentTime:", seekedTime, "isSeeking:", isSeekingRef.current, "pendingSeek:", pendingSeekTimeRef.current);

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

        audio.addEventListener("timeupdate", handleTimeUpdate);
        audio.addEventListener("loadedmetadata", handleLoadedMetadata);
        audio.addEventListener("seeked", handleSeeked);
        audio.addEventListener("ended", handleEnded);

        // One-time interaction to unlock modern browser audio silos
        const unlock = () => {
            if (audioRef.current && !audioRef.current.src) {
                // Play silent probe if possible to establish gesture context
                audioRef.current.play().catch(() => { });
                window.removeEventListener('click', unlock);
                window.removeEventListener('keydown', unlock);
            }
        };
        window.addEventListener('click', unlock);
        window.addEventListener('keydown', unlock);

        return () => {
            audio.removeEventListener("timeupdate", handleTimeUpdate);
            audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
            audio.removeEventListener("seeked", handleSeeked);
            audio.removeEventListener("ended", handleEnded);
            window.removeEventListener('click', unlock);
            window.removeEventListener('keydown', unlock);
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
            void safePlay();
        }
    }, [isPlaying, safePause, safePlay]);

    const stop = useCallback(() => {
        safePause();
        if (audioRef.current) {
            audioRef.current.currentTime = 0;
        }
    }, [safePause]);

    const seek = useCallback((percent: number) => {
        if (!audioRef.current) {
            console.warn("Seek: audioRef.current is null");
            return;
        }

        // Set seeking flag IMMEDIATELY to prevent any src changes
        isSeekingRef.current = true;

        // Store the current src to detect if it changes
        const currentSrc = audioRef.current.src;

        // Clamp percent to valid range
        const clampedPercent = Math.max(0, Math.min(100, percent));

        // If duration is not available yet, wait for it
        if (!audioRef.current.duration || isNaN(audioRef.current.duration)) {
            console.log("Seek: waiting for duration", audioRef.current.duration);
            const checkDuration = () => {
                if (audioRef.current && audioRef.current.duration && !isNaN(audioRef.current.duration)) {
                    // Check if src changed (audio was reset)
                    if (audioRef.current.src !== currentSrc) {
                        console.error("Seek: audio src changed while waiting for duration!");
                        return;
                    }

                    // isSeekingRef already set above
                    const targetTime = (clampedPercent / 100) * audioRef.current.duration;
                    pendingSeekTimeRef.current = targetTime;
                    console.log("Seek: setting currentTime to", targetTime, "from percent", clampedPercent);
                    audioRef.current.currentTime = targetTime;
                    setProgress(clampedPercent);
                    setCurrentTime(targetTime);
                    // The seeked event will clear isSeekingRef when the seek completes
                } else {
                    // Retry after a short delay
                    setTimeout(checkDuration, 50);
                }
            };
            checkDuration();
            return;
        }

        // Normal seek when duration is available
        // isSeekingRef already set above
        const targetTime = (clampedPercent / 100) * audioRef.current.duration;
        pendingSeekTimeRef.current = targetTime;
        const savedSrc = audioRef.current.src;
        const savedCurrentTime = audioRef.current.currentTime;
        console.log("Seek: setting currentTime to", targetTime, "from percent", clampedPercent, "duration", audioRef.current.duration, "current currentTime:", savedCurrentTime, "src:", savedSrc.substring(0, 50));

        // Set the currentTime immediately
        try {
            audioRef.current.currentTime = targetTime;
            setProgress(clampedPercent);
            setCurrentTime(targetTime);
        } catch (error) {
            console.error("Seek: error setting currentTime", error);
            isSeekingRef.current = false;
            pendingSeekTimeRef.current = null;
            return;
        }

        // Monitor for src changes and restore seek if needed
        let retryCount = 0;
        const maxRetries = 3;
        const verifyAndRestoreSeek = () => {
            if (!audioRef.current || !isSeekingRef.current) return;

            // Check if src changed (audio was reset)
            if (audioRef.current.src !== savedSrc && savedSrc) {
                console.error("Seek: audio src changed! Restoring...", "Original:", savedSrc.substring(0, 50), "New:", audioRef.current.src.substring(0, 50));
                // Restore the src
                audioRef.current.src = savedSrc;
                // Wait for metadata to load, then restore seek
                const restoreSeek = () => {
                    if (audioRef.current && audioRef.current.duration && retryCount < maxRetries) {
                        audioRef.current.currentTime = targetTime;
                        retryCount++;
                        setTimeout(verifyAndRestoreSeek, 100);
                    } else {
                        isSeekingRef.current = false;
                    }
                };
                audioRef.current.addEventListener('loadedmetadata', restoreSeek, { once: true });
                // Also try immediately if already loaded
                if (audioRef.current.readyState >= 1) {
                    restoreSeek();
                }
                return;
            }

            // Check if currentTime was reset to near 0
            const actualTime = audioRef.current.currentTime;
            if (actualTime < 1 && targetTime > 1 && retryCount < maxRetries) {
                console.warn("Seek: currentTime reset to", actualTime, "expected", targetTime, "Retrying...", retryCount + 1);
                audioRef.current.currentTime = targetTime;
                retryCount++;
                setTimeout(verifyAndRestoreSeek, 100);
                return;
            }
        };

        // Verify after a short delay
        setTimeout(verifyAndRestoreSeek, 50);

        // Fallback: if seeked event doesn't fire within 500ms, clear the flag anyway
        setTimeout(() => {
            if (isSeekingRef.current) {
                console.warn("Seek: seeked event did not fire, clearing flag manually");
                verifyAndRestoreSeek(); // Final verification
                isSeekingRef.current = false;
            }
        }, 500);
        // The seeked event will clear isSeekingRef when the seek completes
    }, []);

    const setVolume = useCallback((value: number) => {
        setVolumeState(value);
        if (audioRef.current) {
            audioRef.current.volume = value;
        }
    }, []);

    return (
        <PlayerContext.Provider value={{
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
            stop
        }}>
            {children}
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
