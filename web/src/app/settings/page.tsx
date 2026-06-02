"use client";

import { useState, useEffect } from "react";
import { Button } from "../../components/ui/Button";
import AuthGate from "../../components/auth/AuthGate";
import NotificationPreferences from "../../components/notifications/NotificationPreferences";
import CommunityProfileSettingsPanel from "../../components/settings/CommunityProfileSettingsPanel";
import ListenerCohortsPanel from "../../components/settings/ListenerCohortsPanel";
import TasteMemorySettingsPanel from "../../components/settings/TasteMemorySettingsPanel";
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
import { clearLibrary } from "../../lib/localLibrary";
import { useAuth } from "../../components/auth/AuthProvider";
import { recordProductAnalytics } from "../../lib/productAnalytics";

type SettingsSectionId = "library" | "taste" | "community" | "cohorts" | "notifications";

const SETTINGS_SECTIONS: Array<{
    id: SettingsSectionId;
    label: string;
    eyebrow: string;
    description: string;
}> = [
    {
        id: "library",
        label: "Library",
        eyebrow: "Local audio",
        description: "Folders, scan behavior, and indexed files.",
    },
    {
        id: "taste",
        label: "Taste Memory",
        eyebrow: "Recommendations",
        description: "Signals that guide discovery and AI DJ.",
    },
    {
        id: "community",
        label: "Community",
        eyebrow: "Public profile",
        description: "Visibility, profile identity, and social surfaces.",
    },
    {
        id: "cohorts",
        label: "Listener Cohorts",
        eyebrow: "Discovery",
        description: "Privacy-safe listener groups and shared signals.",
    },
    {
        id: "notifications",
        label: "Notifications",
        eyebrow: "Alerts",
        description: "Disputes, marketplace, and realtime delivery.",
    },
];

export default function SettingsPage() {
    const { addToast } = useToast();
    const { token } = useAuth();
    const [activeSection, setActiveSection] = useState<SettingsSectionId>("library");
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
            void recordProductAnalytics(token, "settings.updated", {
                source: "settings",
                subjectType: "library_settings",
                payload: {
                    surface: "library",
                    setting: "library_source_added",
                    sourceCount: sourceNames.length + 1,
                },
            });
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
        void recordProductAnalytics(token, "settings.updated", {
            source: "settings",
            subjectType: "library_settings",
            payload: {
                surface: "library",
                setting: "library_source_removed",
                sourceCount: Math.max(0, sourceNames.length - 1),
            },
        });
        addToast({
            type: "info",
            title: "Source Removed",
            message: "Library source removed.",
        });
    };

    const handleClearAll = async () => {
        await clearLibrarySourceHandles();
        await clearLibrary();
        await loadState();
        void recordProductAnalytics(token, "settings.updated", {
            source: "settings",
            subjectType: "library_settings",
            payload: {
                surface: "library",
                setting: "library_sources_cleared",
                sourceCount: 0,
            },
        });
        addToast({
            type: "info",
            title: "Cleared",
            message: "All library sources and indexed tracks have been removed.",
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
        void recordProductAnalytics(token, "settings.updated", {
            source: "settings",
            subjectType: "library_settings",
            payload: {
                surface: "library",
                setting: "autoScanOnLoad",
                enabled: updated.autoScanOnLoad,
            },
        });
    };

    const hasSources = sourceNames.length > 0;

    if (!isSupported) {
        return (
            <AuthGate title="Connect your wallet to access settings.">
                <main className="settings-workspace">
                    <div className="settings-unsupported">
                        <strong>File System Access API is not supported in this browser.</strong>
                        <p>Please use Chrome, Edge, or another Chromium-based browser.</p>
                    </div>
                </main>
            </AuthGate>
        );
    }

    return (
        <AuthGate title="Connect your wallet to access settings.">
            <main className="settings-workspace">
                <header className="settings-hero">
                    <div>
                        <span className="settings-kicker">Account controls</span>
                        <h1>Settings</h1>
                        <p>
                            Manage the parts of Resonate that shape your local library, recommendations,
                            public community profile, and delivery preferences.
                        </p>
                    </div>
                    <div className="settings-hero-metrics" aria-label="Settings summary">
                        <div>
                            <strong>{sourceNames.length}</strong>
                            <span>Sources</span>
                        </div>
                        <div>
                            <strong>{settings?.autoScanOnLoad ?? true ? "On" : "Off"}</strong>
                            <span>Auto-scan</span>
                        </div>
                    </div>
                </header>

                <div className="settings-layout">
                    <nav className="settings-nav" aria-label="Settings sections">
                        {SETTINGS_SECTIONS.map((section) => (
                            <button
                                key={section.id}
                                type="button"
                                className={activeSection === section.id ? "active" : ""}
                                onClick={() => setActiveSection(section.id)}
                            >
                                <span>{section.eyebrow}</span>
                                <strong>{section.label}</strong>
                                <small>{section.description}</small>
                            </button>
                        ))}
                    </nav>

                    <section className="settings-panel" aria-live="polite">
                        {activeSection === "library" ? (
                            <div className="settings-section">
                                <div className="settings-section-header">
                                    <div>
                                        <span className="settings-kicker">Local audio</span>
                                        <h2 className="settings-section-title">Library</h2>
                                        <p className="settings-copy">
                                            Add local folders, rescan sources, and decide whether Resonate scans
                                            automatically when the app opens.
                                        </p>
                                    </div>
                                    <Button variant="primary" onClick={handleAddFolder} disabled={scanning}>
                                        Add Folder
                                    </Button>
                                </div>

                                <div className="settings-library-grid">
                                    <div className="settings-source">
                                        <div className="settings-subheader">
                                            <h3>Sources</h3>
                                            {settings?.lastScanTime && hasSources ? (
                                                <span>Last scanned {new Date(settings.lastScanTime).toLocaleString()}</span>
                                            ) : null}
                                        </div>

                                        {hasSources ? (
                                            <ul className="settings-source-list">
                                                {sourceNames.map((name, index) => (
                                                    <li key={`${index}-${name}`} className="settings-source-item">
                                                        <div className="settings-source-info">
                                                            <div className="settings-source-path">{name}</div>
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
                                                <strong>No library sources</strong>
                                                <span>Add a folder to index tracks for player and AI DJ sessions.</span>
                                            </div>
                                        )}

                                        {hasSources ? (
                                            <div className="settings-source-actions">
                                                <Button variant="ghost" onClick={handleRescanAll} disabled={scanning}>
                                                    {scanning ? "Scanning..." : "Rescan All"}
                                                </Button>
                                                <Button variant="ghost" onClick={handleClearAll} disabled={scanning}>
                                                    Clear All
                                                </Button>
                                            </div>
                                        ) : null}
                                    </div>

                                    <aside className="settings-compact-panel">
                                        <h3>Scan behavior</h3>
                                        <label className="settings-toggle">
                                            <input
                                                type="checkbox"
                                                checked={settings?.autoScanOnLoad ?? true}
                                                onChange={handleToggleAutoScan}
                                            />
                                            <span>
                                                <strong>Auto-scan on load</strong>
                                                <small>Look for new files when the app starts.</small>
                                            </span>
                                        </label>
                                    </aside>
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
                        ) : null}

                        {activeSection === "taste" ? (
                            <TasteMemorySettingsPanel token={token} addToast={addToast} />
                        ) : null}

                        {activeSection === "community" ? (
                            <CommunityProfileSettingsPanel token={token} addToast={addToast} />
                        ) : null}

                        {activeSection === "cohorts" ? (
                            <ListenerCohortsPanel token={token} addToast={addToast} />
                        ) : null}

                        {activeSection === "notifications" ? (
                            <div className="settings-section">
                                <div className="settings-section-header">
                                    <div>
                                        <span className="settings-kicker">Alerts</span>
                                        <h2 className="settings-section-title">Notifications</h2>
                                        <p className="settings-copy">
                                            Choose which dispute and marketplace events should reach your connected wallet.
                                        </p>
                                    </div>
                                </div>
                                <NotificationPreferences />
                            </div>
                        ) : null}
                    </section>
                </div>
            </main>
        </AuthGate>
    );
}
