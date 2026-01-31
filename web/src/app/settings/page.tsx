"use client";

import { useState, useEffect } from "react";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import AuthGate from "../../components/auth/AuthGate";
import { useToast } from "../../components/ui/Toast";
import {
    getLibrarySourceHandles,
    getUniqueLibrarySourceHandles,
    addLibrarySourceHandle,
    removeLibrarySourceHandle,
    clearLibrarySourceHandles,
    getSettings,
    updateSettings,
    requestPermission,
    isFileSystemAccessSupported,
    LibrarySettings,
} from "../../lib/librarySettings";
import { scanAndIndex, ScanProgress } from "../../lib/libraryScanner";

export default function SettingsPage() {
    const { addToast } = useToast();
    const [settings, setSettings] = useState<LibrarySettings | null>(null);
    const [sourceNames, setSourceNames] = useState<string[]>([]);
    const [scanning, setScanning] = useState(false);
    const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);
    const [scanSourceIndex, setScanSourceIndex] = useState<number>(0);
    const [scanSourceTotal, setScanSourceTotal] = useState<number>(0);
    const [isSupported, setIsSupported] = useState(true);

    const loadState = async () => {
        const [s, handles] = await Promise.all([
            getSettings(),
            getLibrarySourceHandles(),
        ]);
        setSettings(s);
        // Drive list from actual handles so it stays in sync after add/remove
        setSourceNames(handles.map((h) => h.name));
    };

    useEffect(() => {
        (async () => {
            setIsSupported(isFileSystemAccessSupported());
            await loadState();
        })();
    }, []);

    const handleAddFolder = async () => {
        try {
            const handle = await window.showDirectoryPicker({ mode: "read" });
            const added = await addLibrarySourceHandle(handle);
            if (!added) {
                addToast({
                    type: "warning",
                    title: "Already added",
                    message: "This folder is already in your library sources.",
                });
                return;
            }
            await loadState();
            addToast({
                type: "success",
                title: "Folder Added",
                message: `"${handle.name}" added to library sources.`,
            });
        } catch (error) {
            if ((error as Error).name !== "AbortError") {
                addToast({
                    type: "error",
                    title: "Error",
                    message: "Failed to select folder.",
                });
            }
        }
    };

    const handleRemoveFolder = async (index: number) => {
        await removeLibrarySourceHandle(index);
        await loadState();
        addToast({
            type: "info",
            title: "Source Removed",
            message: "Library source removed.",
        });
    };

    const handleClearAll = async () => {
        await clearLibrarySourceHandles();
        await loadState();
        addToast({
            type: "info",
            title: "Cleared",
            message: "All library sources have been removed.",
        });
    };

    const handleRescanAll = async () => {
        const handles = await getUniqueLibrarySourceHandles();
        if (handles.length === 0) return;

        setScanning(true);
        setScanProgress(null);
        setScanSourceTotal(handles.length);

        let totalAdded = 0;
        let totalSkipped = 0;

        try {
            for (let i = 0; i < handles.length; i++) {
                setScanSourceIndex(i + 1);
                const handle = handles[i]!;
                const hasPermission = await requestPermission(handle);
                if (!hasPermission) {
                    addToast({
                        type: "error",
                        title: "Permission Denied",
                        message: `Please grant access to "${handle.name}".`,
                    });
                    continue;
                }
                const result = await scanAndIndex(handle, setScanProgress);
                totalAdded += result.added;
                totalSkipped += result.skipped;
            }
            await updateSettings({ lastScanTime: new Date().toISOString() });
            await loadState();
            addToast({
                type: "success",
                title: "Scan Complete",
                message: `Added ${totalAdded} new tracks. ${totalSkipped} skipped.`,
            });
        } catch (error) {
            addToast({
                type: "error",
                title: "Scan Failed",
                message: (error as Error).message,
            });
        } finally {
            setScanning(false);
            setScanProgress(null);
        }
    };

    const handleRescanOne = async (index: number) => {
        const handles = await getLibrarySourceHandles();
        const handle = handles[index];
        if (!handle) return;

        const hasPermission = await requestPermission(handle);
        if (!hasPermission) {
            addToast({
                type: "error",
                title: "Permission Denied",
                message: "Please grant access to the folder.",
            });
            return;
        }

        setScanning(true);
        setScanProgress(null);
        setScanSourceIndex(1);
        setScanSourceTotal(1);

        try {
            const result = await scanAndIndex(handle, setScanProgress);
            await updateSettings({ lastScanTime: new Date().toISOString() });
            await loadState();
            addToast({
                type: "success",
                title: "Scan Complete",
                message: `Added ${result.added} new tracks. ${result.skipped} skipped.`,
            });
        } catch (error) {
            addToast({
                type: "error",
                title: "Scan Failed",
                message: (error as Error).message,
            });
        } finally {
            setScanning(false);
            setScanProgress(null);
        }
    };

    const handleToggleAutoScan = async () => {
        if (!settings) return;
        const updated = await updateSettings({ autoScanOnLoad: !settings.autoScanOnLoad });
        setSettings(updated);
    };

    const hasSources = sourceNames.length > 0;

    if (!isSupported) {
        return (
            <AuthGate title="Connect your wallet to access settings.">
                <main className="settings-grid">
                    <Card>
                        <div className="upload-section-title">Settings</div>
                        <div className="settings-unsupported">
                            <p>⚠️ File System Access API is not supported in this browser.</p>
                            <p>Please use Chrome, Edge, or another Chromium-based browser.</p>
                        </div>
                    </Card>
                </main>
            </AuthGate>
        );
    }

    return (
        <AuthGate title="Connect your wallet to access settings.">
            <main className="settings-grid">
                <Card>
                    <div className="upload-section-title">Library Settings</div>

                    <div className="settings-section">
                        <h3 className="settings-section-title">Library Sources</h3>
                        <p className="home-subtitle">
                            Add folders to automatically monitor and index for audio files. You can
                            specify multiple local folders.
                        </p>

                        <div className="settings-source">
                            {hasSources ? (
                                <ul className="settings-source-list">
                                    {sourceNames.map((name, index) => (
                                        <li key={`${index}-${name}`} className="settings-source-item">
                                            <div className="settings-source-info">
                                                <div className="settings-source-path">
                                                    📂 {name}
                                                </div>
                                            </div>
                                            <div className="settings-source-item-actions">
                                                <Button
                                                    variant="ghost"
                                                    onClick={() => handleRescanOne(index)}
                                                    disabled={scanning}
                                                >
                                                    Rescan
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    onClick={() => handleRemoveFolder(index)}
                                                    disabled={scanning}
                                                >
                                                    Remove
                                                </Button>
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            ) : (
                                <div className="settings-source-empty">
                                    No library sources configured
                                </div>
                            )}
                            {settings?.lastScanTime && hasSources && (
                                <div className="settings-source-meta">
                                    Last scanned: {new Date(settings.lastScanTime).toLocaleString()}
                                </div>
                            )}

                            <div className="settings-source-actions">
                                <Button variant="primary" onClick={handleAddFolder} disabled={scanning}>
                                    Add Folder
                                </Button>
                                {hasSources && (
                                    <>
                                        <Button
                                            variant="ghost"
                                            onClick={handleRescanAll}
                                            disabled={scanning}
                                        >
                                            {scanning ? "Scanning..." : "Rescan All"}
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            onClick={handleClearAll}
                                            disabled={scanning}
                                        >
                                            Clear All
                                        </Button>
                                    </>
                                )}
                            </div>
                        </div>

                        {scanning && scanProgress && (
                            <div className="settings-scan-progress">
                                {scanSourceTotal > 1 && (
                                    <p>
                                        Source {scanSourceIndex} of {scanSourceTotal}
                                    </p>
                                )}
                                <p>
                                    {scanProgress.phase === "scanning"
                                        ? "Scanning for audio files..."
                                        : `Indexing: ${scanProgress.filesIndexed}/${scanProgress.filesFound}`}
                                </p>
                                {scanProgress.currentFile && (
                                    <p className="settings-scan-file">{scanProgress.currentFile}</p>
                                )}
                                <div className="import-progress-bar">
                                    <div
                                        className="import-progress-fill"
                                        style={{
                                            width:
                                                scanProgress.phase === "scanning"
                                                    ? "30%"
                                                    : scanProgress.filesFound > 0
                                                        ? `${(scanProgress.filesIndexed / scanProgress.filesFound) * 100}%`
                                                        : "0%",
                                        }}
                                    />
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="settings-section">
                        <h3 className="settings-section-title">Auto-Scan</h3>
                        <label className="settings-toggle">
                            <input
                                type="checkbox"
                                checked={settings?.autoScanOnLoad ?? true}
                                onChange={handleToggleAutoScan}
                            />
                            <span>Automatically scan for new files when app loads</span>
                        </label>
                    </div>
                </Card>
            </main>
        </AuthGate>
    );
}
