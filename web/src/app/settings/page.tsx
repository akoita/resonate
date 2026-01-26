"use client";

import { useState, useEffect } from "react";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import AuthGate from "../../components/auth/AuthGate";
import { useToast } from "../../components/ui/Toast";
import {
    getLibrarySourceHandle,
    setLibrarySourceHandle,
    clearLibrarySourceHandle,
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
    const [hasHandle, setHasHandle] = useState(false);
    const [scanning, setScanning] = useState(false);
    const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);
    const [isSupported, setIsSupported] = useState(true);

    useEffect(() => {
        (async () => {
            setIsSupported(isFileSystemAccessSupported());
            const s = await getSettings();
            setSettings(s);
            const handle = await getLibrarySourceHandle();
            setHasHandle(!!handle);
        })();
    }, []);

    const handleSelectFolder = async () => {
        try {
            const handle = await window.showDirectoryPicker({ mode: "read" });
            await setLibrarySourceHandle(handle);
            setHasHandle(true);
            const s = await getSettings();
            setSettings(s);
            addToast({
                type: "success",
                title: "Folder Selected",
                message: `"${handle.name}" is now your library source.`,
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

    const handleClearFolder = async () => {
        await clearLibrarySourceHandle();
        setHasHandle(false);
        const s = await getSettings();
        setSettings(s);
        addToast({
            type: "info",
            title: "Cleared",
            message: "Library source has been removed.",
        });
    };

    const handleRescan = async () => {
        const handle = await getLibrarySourceHandle();
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

        try {
            const result = await scanAndIndex(handle, setScanProgress);
            await updateSettings({ lastScanTime: new Date().toISOString() });
            const s = await getSettings();
            setSettings(s);

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
        }
    };

    const handleToggleAutoScan = async () => {
        if (!settings) return;
        const updated = await updateSettings({ autoScanOnLoad: !settings.autoScanOnLoad });
        setSettings(updated);
    };

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
                        <h3 className="settings-section-title">Library Source</h3>
                        <p className="home-subtitle">
                            Select a folder to automatically monitor and index for audio files.
                        </p>

                        <div className="settings-source">
                            {hasHandle && settings?.sourceFolderName ? (
                                <div className="settings-source-info">
                                    <div className="settings-source-path">
                                        📂 {settings.sourceFolderName}
                                    </div>
                                    {settings.lastScanTime && (
                                        <div className="settings-source-meta">
                                            Last scanned: {new Date(settings.lastScanTime).toLocaleString()}
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <div className="settings-source-empty">
                                    No library source configured
                                </div>
                            )}

                            <div className="settings-source-actions">
                                <Button variant="primary" onClick={handleSelectFolder}>
                                    {hasHandle ? "Change Folder" : "Select Folder"}
                                </Button>
                                {hasHandle && (
                                    <>
                                        <Button
                                            variant="ghost"
                                            onClick={handleRescan}
                                            disabled={scanning}
                                        >
                                            {scanning ? "Scanning..." : "Rescan Now"}
                                        </Button>
                                        <Button variant="ghost" onClick={handleClearFolder}>
                                            Clear
                                        </Button>
                                    </>
                                )}
                            </div>
                        </div>

                        {scanning && scanProgress && (
                            <div className="settings-scan-progress">
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
                                                    : `${(scanProgress.filesIndexed / scanProgress.filesFound) * 100}%`,
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
