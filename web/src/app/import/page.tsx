"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { FileDropZone } from "../../components/ui/FileDropZone";
import AuthGate from "../../components/auth/AuthGate";
import { extractMetadata, ExtractedMetadata } from "../../lib/metadataExtractor";
import { saveTrack } from "../../lib/localLibrary";
import { useToast } from "../../components/ui/Toast";

type ImportState = "idle" | "extracting" | "preview" | "saving";

export default function ImportPage() {
    const router = useRouter();
    const { addToast } = useToast();
    const [state, setState] = useState<ImportState>("idle");
    const [file, setFile] = useState<File | null>(null);
    const [metadata, setMetadata] = useState<ExtractedMetadata | null>(null);

    const handleFileSelect = useCallback(async (selectedFile: File) => {
        setFile(selectedFile);
        setState("extracting");

        const extracted = await extractMetadata(selectedFile);
        setMetadata(extracted);
        setState("preview");
    }, []);

    const handleImport = async () => {
        if (!file || !metadata) return;

        setState("saving");
        await saveTrack(file, {
            title: metadata.title || file.name,
            artist: metadata.artist,
            album: metadata.album,
            year: metadata.year,
            genre: metadata.genre,
            duration: metadata.duration,
        });

        addToast({
            type: "success",
            title: "Imported!",
            message: `"${metadata.title}" has been added to your library.`,
        });

        router.push("/library");
    };

    const handleReset = () => {
        setFile(null);
        setMetadata(null);
        setState("idle");
    };

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
                        <FileDropZone
                            onFileSelect={handleFileSelect}
                            accept="audio/*"
                            disabled={false}
                        />
                    )}

                    {state === "extracting" && (
                        <div className="import-loading">
                            <div className="spinner" />
                            <p>Reading metadata...</p>
                        </div>
                    )}

                    {state === "preview" && metadata && (
                        <div className="import-preview">
                            <div className="import-preview-card">
                                <div className="import-field">
                                    <span className="import-label">Title</span>
                                    <span className="import-value">{metadata.title || "Unknown"}</span>
                                </div>
                                <div className="import-field">
                                    <span className="import-label">Artist</span>
                                    <span className="import-value">{metadata.artist || "Unknown"}</span>
                                </div>
                                <div className="import-field">
                                    <span className="import-label">Album</span>
                                    <span className="import-value">{metadata.album || "—"}</span>
                                </div>
                                <div className="import-field">
                                    <span className="import-label">Year</span>
                                    <span className="import-value">{metadata.year || "—"}</span>
                                </div>
                                <div className="import-field">
                                    <span className="import-label">Genre</span>
                                    <span className="import-value">{metadata.genre || "—"}</span>
                                </div>
                            </div>
                            <div className="import-actions">
                                <Button variant="ghost" onClick={handleReset}>
                                    Cancel
                                </Button>
                                <Button variant="primary" onClick={handleImport}>
                                    Add to Library
                                </Button>
                            </div>
                        </div>
                    )}

                    {state === "saving" && (
                        <div className="import-loading">
                            <div className="spinner" />
                            <p>Saving to your library...</p>
                        </div>
                    )}
                </Card>
            </main>
        </AuthGate>
    );
}
