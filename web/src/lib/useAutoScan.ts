/**
 * Library Auto-Scan Hook
 * Triggers automatic library scan on app load if configured
 */
import { useEffect, useState } from "react";
import {
    getLibrarySourceHandle,
    getSettings,
    updateSettings,
    requestPermission,
} from "./librarySettings";
import { scanAndIndex, ScanProgress } from "./libraryScanner";

export interface AutoScanState {
    scanning: boolean;
    progress: ScanProgress | null;
    result: { added: number; skipped: number; total: number } | null;
}

/**
 * Hook to trigger auto-scan on mount if conditions are met
 */
export function useAutoScan(): AutoScanState {
    const [state, setState] = useState<AutoScanState>({
        scanning: false,
        progress: null,
        result: null,
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

            setState({ scanning: true, progress: null, result: null });

            try {
                const result = await scanAndIndex(handle, (progress) => {
                    if (!cancelled) {
                        setState((prev) => ({ ...prev, progress }));
                    }
                });

                await updateSettings({ lastScanTime: new Date().toISOString() });

                if (!cancelled) {
                    setState({ scanning: false, progress: null, result });
                }
            } catch (error) {
                console.error("[AutoScan] Failed:", error);
                if (!cancelled) {
                    setState({ scanning: false, progress: null, result: null });
                }
            }
        })();

        return () => {
            cancelled = true;
        };
    }, []);

    return state;
}
