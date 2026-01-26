/**
 * Library Auto-Scan Hook
 * Triggers automatic library scan on app load if configured
 * Provides real-time updates as tracks are indexed
 */
import { useEffect, useState } from "react";
import {
    getLibrarySourceHandle,
    getSettings,
    updateSettings,
} from "./librarySettings";
import { scanAndIndex, ScanProgress } from "./libraryScanner";
import { LocalTrack } from "./localLibrary";

export interface AutoScanState {
    scanning: boolean;
    progress: ScanProgress | null;
    result: { added: number; skipped: number; total: number } | null;
    newTracks: LocalTrack[];
}

/**
 * Hook to trigger auto-scan on mount if conditions are met
 * Returns newly added tracks in real-time during scanning
 */
export function useAutoScan(): AutoScanState {
    const [state, setState] = useState<AutoScanState>({
        scanning: false,
        progress: null,
        result: null,
        newTracks: [],
    });

    useEffect(() => {
        let cancelled = false;

        (async () => {
            const settings = await getSettings();
            if (!settings.autoScanOnLoad) return;

            const handle = await getLibrarySourceHandle();
            if (!handle) return;

            // Check permission silently
            try {
                const permission = await handle.requestPermission({ mode: "read" });
                if (permission !== "granted") return;
            } catch {
                return;
            }

            if (cancelled) return;

            setState({ scanning: true, progress: null, result: null, newTracks: [] });

            try {
                const result = await scanAndIndex(
                    handle,
                    // Progress callback
                    (progress) => {
                        if (!cancelled) {
                            setState((prev) => ({ ...prev, progress }));
                        }
                    },
                    // Track added callback - for real-time UI updates
                    (track) => {
                        if (!cancelled) {
                            setState((prev) => ({
                                ...prev,
                                newTracks: [...prev.newTracks, track],
                            }));
                        }
                    }
                );

                await updateSettings({ lastScanTime: new Date().toISOString() });

                if (!cancelled) {
                    setState((prev) => ({
                        ...prev,
                        scanning: false,
                        progress: null,
                        result
                    }));
                }
            } catch (error) {
                console.error("[AutoScan] Failed:", error);
                if (!cancelled) {
                    setState((prev) => ({
                        ...prev,
                        scanning: false,
                        progress: null,
                        result: null
                    }));
                }
            }
        })();

        return () => {
            cancelled = true;
        };
    }, []);

    return state;
}
