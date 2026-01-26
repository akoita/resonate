"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { FileDropZone } from "../../components/ui/FileDropZone";
import AuthGate from "../../components/auth/AuthGate";
import { extractMetadata, ExtractedMetadata, formatDuration } from "../../lib/metadataExtractor";
import { saveTrack } from "../../lib/localLibrary";
import { useToast } from "../../components/ui/Toast";

type FileWithMetadata = {
    file: File;
    metadata: ExtractedMetadata;
    selected: boolean;
};

type ImportState = "idle" | "extracting" | "preview" | "saving";

export default function ImportPage() {
    const router = useRouter();
    const { addToast } = useToast();
    const [state, setState] = useState<ImportState>("idle");
    const [files, setFiles] = useState<FileWithMetadata[]>([]);
    const [progress, setProgress] = useState({ current: 0, total: 0 });

    const handleFilesSelect = async (selectedFiles: File[]) => {
        setState("extracting");
        setProgress({ current: 0, total: selectedFiles.length });

        const processed: FileWithMetadata[] = [];
        for (let i = 0; i < selectedFiles.length; i++) {
            const file = selectedFiles[i]!;
            const metadata = await extractMetadata(file);
            processed.push({ file, metadata, selected: true });
            setProgress({ current: i + 1, total: selectedFiles.length });
        }

        setFiles(processed);
        setState("preview");
    };

    const toggleSelection = (index: number) => {
        setFiles(prev =>
            prev.map((f, i) => (i === index ? { ...f, selected: !f.selected } : f))
        );
    };

    const selectAll = () => {
        setFiles(prev => prev.map(f => ({ ...f, selected: true })));
    };

    const deselectAll = () => {
        setFiles(prev => prev.map(f => ({ ...f, selected: false })));
    };

    const handleImport = async () => {
        const toImport = files.filter(f => f.selected);
        if (toImport.length === 0) return;

        setState("saving");
        setProgress({ current: 0, total: toImport.length });

        for (let i = 0; i < toImport.length; i++) {
            const { file, metadata } = toImport[i]!;
            await saveTrack(file, {
                title: metadata.title || file.name,
                artist: metadata.artist,
                album: metadata.album,
                year: metadata.year,
                genre: metadata.genre,
                duration: metadata.duration,
            });
            setProgress({ current: i + 1, total: toImport.length });
        }

        addToast({
            type: "success",
            title: "Import Complete!",
            message: `${toImport.length} track${toImport.length > 1 ? "s" : ""} added to your library.`,
        });

        router.push("/library");
    };

    const handleReset = () => {
        setFiles([]);
        setState("idle");
        setProgress({ current: 0, total: 0 });
    };

    const selectedCount = files.filter(f => f.selected).length;

    return (
        <AuthGate title="Connect your wallet to import music.">
            <main className="import-grid">
                <Card>
                    <div className="upload-section-title">Import to Your Library</div>
                    <p className="home-subtitle">
                        Add your own music files. They&apos;ll be stored locally in your browser
                        and won&apos;t be uploaded to our servers.
                    </p>

                    {state === "idle" && (
                        <div className="import-options">
                            <div className="import-option">
                                <FileDropZone
                                    onFileSelect={() => { }}
                                    onFilesSelect={handleFilesSelect}
                                    accept="audio/*"
                                    multiple
                                />
                                <p className="import-option-hint">
                                    Use Ctrl+Click or Ctrl+A to select multiple files
                                </p>
                            </div>
                            <div className="import-divider">
                                <span>or</span>
                            </div>
                            <div className="import-option">
                                <FileDropZone
                                    onFileSelect={() => { }}
                                    onFilesSelect={handleFilesSelect}
                                    accept="audio/*"
                                    multiple
                                    directory
                                />
                            </div>
                        </div>
                    )}

                    {state === "extracting" && (
                        <div className="import-loading">
                            <div className="spinner" />
                            <p>Reading metadata... ({progress.current}/{progress.total})</p>
                            <div className="import-progress-bar">
                                <div
                                    className="import-progress-fill"
                                    style={{ width: `${(progress.current / progress.total) * 100}%` }}
                                />
                            </div>
                        </div>
                    )}

                    {state === "preview" && files.length > 0 && (
                        <div className="import-preview">
                            <div className="import-batch-header">
                                <span>{files.length} files found</span>
                                <div className="import-batch-actions">
                                    <Button variant="ghost" onClick={selectAll}>Select All</Button>
                                    <Button variant="ghost" onClick={deselectAll}>Deselect All</Button>
                                </div>
                            </div>
                            <div className="import-file-list">
                                {files.map((item, index) => (
                                    <div
                                        key={index}
                                        className={`import-file-item ${item.selected ? "selected" : ""}`}
                                        onClick={() => toggleSelection(index)}
                                    >
                                        <input
                                            type="checkbox"
                                            checked={item.selected}
                                            onChange={() => toggleSelection(index)}
                                        />
                                        <div className="import-file-info">
                                            <div className="import-file-title">
                                                {item.metadata.title || item.file.name}
                                            </div>
                                            <div className="import-file-meta">
                                                {item.metadata.artist || "Unknown Artist"}
                                                {item.metadata.album && ` • ${item.metadata.album}`}
                                            </div>
                                        </div>
                                        <div className="import-file-duration">
                                            {formatDuration(item.metadata.duration)}
                                        </div>
                                    </div>
                                ))}
                            </div>
                            <div className="import-actions">
                                <Button variant="ghost" onClick={handleReset}>
                                    Cancel
                                </Button>
                                <Button
                                    variant="primary"
                                    onClick={handleImport}
                                    disabled={selectedCount === 0}
                                >
                                    Import {selectedCount} Track{selectedCount !== 1 ? "s" : ""}
                                </Button>
                            </div>
                        </div>
                    )}

                    {state === "saving" && (
                        <div className="import-loading">
                            <div className="spinner" />
                            <p>Importing... ({progress.current}/{progress.total})</p>
                            <div className="import-progress-bar">
                                <div
                                    className="import-progress-fill"
                                    style={{ width: `${(progress.current / progress.total) * 100}%` }}
                                />
                            </div>
                        </div>
                    )}
                </Card>
            </main>
        </AuthGate>
    );
}
