/**
 * Library Auto-Scan Hook
 * Triggers automatic library scan on app load if configured
 * Scans all configured library sources (multiple folders)
 * Provides real-time updates as tracks are indexed
 */
import { useEffect, useState } from "react";
import {
    getLibrarySourceHandles,
    getUniqueLibrarySourceHandles,
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
 * Scans all configured library sources in sequence
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

            const handles = await getUniqueLibrarySourceHandles();
            if (!handles.length) return;

            // Check permission for first handle (others will be checked per-scan)
            try {
                const permission = await handles[0]!.requestPermission({ mode: "read" });
                if (permission !== "granted") return;
            } catch {
                return;
            }

            if (cancelled) return;

            setState({ scanning: true, progress: null, result: null, newTracks: [] });

            let totalAdded = 0;
            let totalSkipped = 0;

            try {
                for (const handle of handles) {
                    if (cancelled) break;
                    try {
                        const permission = await handle.requestPermission({ mode: "read" });
                        if (permission !== "granted") continue;
                    } catch {
                        continue;
                    }

                    const result = await scanAndIndex(
                        handle,
                        (progress) => {
                            if (!cancelled) {
                                setState((prev) => ({ ...prev, progress }));
                            }
                        },
                        (track) => {
                            if (!cancelled) {
                                setState((prev) => ({
                                    ...prev,
                                    newTracks: [...prev.newTracks, track],
                                }));
                            }
                        }
                    );
                    totalAdded += result.added;
                    totalSkipped += result.skipped;
                }

                await updateSettings({ lastScanTime: new Date().toISOString() });

                if (!cancelled) {
                    setState((prev) => ({
                        ...prev,
                        scanning: false,
                        progress: null,
                        result: { added: totalAdded, skipped: totalSkipped, total: totalAdded + totalSkipped },
                    }));
                }
            } catch (error) {
                console.error("[AutoScan] Failed:", error);
                if (!cancelled) {
                    setState((prev) => ({
                        ...prev,
                        scanning: false,
                        progress: null,
                        result: null,
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
