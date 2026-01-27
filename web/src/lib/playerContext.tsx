"use client";

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import { LocalTrack, getTrackUrl, getArtworkUrl } from "./localLibrary";

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
    playQueue: (list: LocalTrack[], startIndex: number) => Promise<void>;
    nextTrack: () => void;
    prevTrack: () => void;
    togglePlay: () => void;
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

    const audioRef = useRef<HTMLAudioElement | null>(null);
    const playPromiseRef = useRef<Promise<void> | null>(null);

    // Stable function refs for event listeners
    const nextTrackRef = useRef<() => void>(() => { });
    const queueRef = useRef<LocalTrack[]>([]);
    const currentIndexRef = useRef(-1);

    const currentTrack = currentIndex >= 0 ? queue[currentIndex] : null;

    // Optimized Safe Play/Pause (Synchronous Pause for Gesture Stability)
    const safePlay = useCallback(async () => {
        if (!audioRef.current || !audioRef.current.src) return;
        try {
            const promise = audioRef.current.play();
            playPromiseRef.current = promise;
            await promise;
            setIsPlaying(true);
        } catch (error: unknown) {
            if (error instanceof Error && error.name !== 'AbortError') {
                console.error("Playback error:", error);
            }
            setIsPlaying(false);
        } finally {
            if (playPromiseRef.current === audioRef.current?.play()) {
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

        // Synchronous pause to preserve user gesture
        safePause();

        const url = await getTrackUrl(track);
        const art = await getArtworkUrl(track);

        if (url) {
            audioRef.current.src = url;
            audioRef.current.volume = volume;
            setArtworkUrl(art || null);
            void safePlay();
        }
    }, [volume, safePause, safePlay]);

    const playQueue = useCallback(async (list: LocalTrack[], startIndex: number) => {
        setQueue(list);
        setCurrentIndex(startIndex);
        await playTrack(list[startIndex]);
    }, [playTrack]);

    const nextTrack = useCallback(() => {
        const q = queueRef.current;
        const idx = currentIndexRef.current;
        if (idx < q.length - 1) {
            void playQueue(q, idx + 1);
        }
    }, [playQueue]);

    const prevTrack = useCallback(() => {
        const q = queueRef.current;
        const idx = currentIndexRef.current;
        if (idx > 0) {
            void playQueue(q, idx - 1);
        }
    }, [playQueue]);

    // Sync refs for event listeners
    useEffect(() => {
        queueRef.current = queue;
        currentIndexRef.current = currentIndex;
        nextTrackRef.current = nextTrack;
    }, [queue, currentIndex, nextTrack]);

    // Persistent Audio initialiser with stable listener bridge
    useEffect(() => {
        const audio = new Audio();
        audioRef.current = audio;

        const handleTimeUpdate = () => {
            setCurrentTime(audio.currentTime);
            setDuration(audio.duration || 0);
            setProgress((audio.currentTime / (audio.duration || 1)) * 100);
        };

        const handleLoadedMetadata = () => {
            setDuration(audio.duration);
        };

        const handleEnded = () => {
            const q = queueRef.current;
            const idx = currentIndexRef.current;
            if (idx < q.length - 1) {
                // Call the latest nextTrack via ref to avoid stale closures
                nextTrackRef.current();
            } else {
                setIsPlaying(false);
            }
        };

        audio.addEventListener("timeupdate", handleTimeUpdate);
        audio.addEventListener("loadedmetadata", handleLoadedMetadata);
        audio.addEventListener("ended", handleEnded);

        return () => {
            audio.removeEventListener("timeupdate", handleTimeUpdate);
            audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
            audio.removeEventListener("ended", handleEnded);
            audio.pause();
            audio.src = "";
        };
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
        if (audioRef.current && audioRef.current.duration) {
            audioRef.current.currentTime = (percent / 100) * audioRef.current.duration;
            setProgress(percent);
        }
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
            playQueue,
            nextTrack,
            prevTrack,
            togglePlay,
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
