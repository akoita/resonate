"use client";

import { useState, useCallback } from "react";
import AuthGate from "../../../components/auth/AuthGate";
import ArtistGate from "../../../components/auth/ArtistGate";
import { Button } from "../../../components/ui/Button";
import { Card } from "../../../components/ui/Card";
import { Input } from "../../../components/ui/Input";
import { FileDropZone } from "../../../components/ui/FileDropZone";
import { useToast } from "../../../components/ui/Toast";
import { useAuth } from "../../../components/auth/AuthProvider";
import { getArtistMe, uploadStems } from "../../../lib/api";

type Stem = {
  id: string;
  name: string;
  status: "Uploading" | "Processing" | "Ready" | "Error";
  progress: number;
  previewUrl?: string;
  file?: File;
};

export default function ArtistUploadPage() {
  const { token, address } = useAuth();
  const [stems, setStems] = useState<Stem[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const { addToast } = useToast();

  // Form state
  const [formData, setFormData] = useState({
    releaseType: "",
    releaseTitle: "",
    title: "",
    primaryArtist: "",
    featuredArtists: "",
    genre: "",
    isrc: "",
    label: "",
    releaseDate: "",
    explicit: false,
    remixPrice: "",
    commercialPrice: "",
  });

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === "checkbox" ? checked : value,
    }));
  };

  const handlePublish = async () => {
    // Validate required fields
    if (!formData.releaseTitle.trim()) {
      addToast({
        type: "error",
        title: "Missing release title",
        message: "Please enter a release title before publishing.",
      });
      return;
    }
    if (!formData.title.trim()) {
      addToast({
        type: "error",
        title: "Missing track title",
        message: "Please enter a track title before publishing.",
      });
      return;
    }
    if (!formData.primaryArtist.trim()) {
      addToast({
        type: "error",
        title: "Missing artist name",
        message: "Please enter the primary artist name.",
      });
      return;
    }

    setIsPublishing(true);

    try {
      if (!token || !address) {
        throw new Error("Not authenticated");
      }

      // artistId is now derived from the authenticated user in the backend
      // Using uploadStems to trigger the full ingestion flow
      const artist = await getArtistMe(token);
      if (!artist) throw new Error("Artist profile not found");

      const metadata = {
        title: formData.title,
        releaseType: formData.releaseType || "single",
        releaseTitle: formData.releaseTitle,
        primaryArtist: formData.primaryArtist,
        featuredArtists: formData.featuredArtists ? formData.featuredArtists.split(",").map((s: string) => s.trim()) : undefined,
        genre: formData.genre || undefined,
        isrc: formData.isrc || undefined,
        label: formData.label || undefined,
        releaseDate: formData.releaseDate || undefined,
        explicit: formData.explicit,
      };

      const uploadPayload = new FormData();
      uploadPayload.append("artistId", artist.id);
      uploadPayload.append("metadata", JSON.stringify(metadata));

      // Append real files
      stems.forEach((stem) => {
        if (stem.file) {
          uploadPayload.append("files", stem.file);
        }
      });

      await uploadStems(token, uploadPayload);

      addToast({
        type: "success",
        title: "Release submitted!",
        message: `"${formData.releaseTitle}" has been queued for processing. It will appear on your dashboard shortly.`,
      });

      // Reset form
      setStems([]);
      setFormData({
        releaseType: "",
        releaseTitle: "",
        title: "",
        primaryArtist: "",
        featuredArtists: "",
        genre: "",
        isrc: "",
        label: "",
        releaseDate: "",
        explicit: false,
        remixPrice: "",
        commercialPrice: "",
      });
    } catch {
      addToast({
        type: "error",
        title: "Failed to publish",
        message: "An error occurred while publishing. Please try again.",
      });
    } finally {
      setIsPublishing(false);
    }
  };

  const handleFileSelect = useCallback((file: File) => {
    // Validate file type
    const validTypes = ["audio/mpeg", "audio/wav", "audio/flac", "audio/aiff", "audio/x-aiff"];
    if (!validTypes.some(type => file.type.includes(type.split("/")[1] ?? ""))) {
      addToast({
        type: "error",
        title: "Invalid file format",
        message: "Please select a valid audio file (MP3, WAV, FLAC, or AIFF)",
      });
      return;
    }

    setIsUploading(true);

    const previewUrl = URL.createObjectURL(file);

    // Create a new stem entry
    const newStem: Stem = {
      id: crypto.randomUUID(),
      name: file.name,
      status: "Uploading",
      progress: 0,
      previewUrl,
      file,
    };

    setStems(prev => [...prev, newStem]);

    // Simulate upload progress
    let progress = 0;
    const uploadInterval = setInterval(() => {
      progress += Math.random() * 15 + 5;
      if (progress >= 100) {
        progress = 100;
        clearInterval(uploadInterval);

        // Transition to processing
        setStems(prev =>
          prev.map(s =>
            s.id === newStem.id ? { ...s, status: "Processing", progress: 100 } : s
          )
        );

        // Simulate processing
        setTimeout(() => {
          setStems(prev =>
            prev.map(s =>
              s.id === newStem.id ? { ...s, status: "Ready" } : s
            )
          );
          setIsUploading(false);
        }, 2000);
      } else {
        setStems(prev =>
          prev.map(s =>
            s.id === newStem.id ? { ...s, progress: Math.min(progress, 100) } : s
          )
        );
      }
    }, 200);
  }, [addToast]);

  const handleRemoveStem = useCallback((id: string) => {
    setStems(prev => prev.filter(s => s.id !== id));
  }, []);

  const allReady = stems.length > 0 && stems.every(stem => stem.status === "Ready");

  return (
    <AuthGate title="Connect your wallet to upload releases.">
      <ArtistGate>
        <main className="upload-grid">
          <Card>
            <div className="upload-panel">
              <div className="upload-section-title">Upload your track</div>
              <p className="home-subtitle">
                Drag and drop your audio file to begin stem separation.
              </p>
              <FileDropZone
                onFileSelect={handleFileSelect}
                accept="audio/*"
                disabled={isUploading}
              />
              {stems.length > 0 && (
                <div className="upload-list">
                  {stems.map(stem => (
                    <div key={stem.id} className="upload-item">
                      <div style={{ flex: 1 }}>
                        <div className="upload-item-header">
                          <span className="upload-item-name">{stem.name}</span>
                          <button
                            className="upload-item-remove"
                            onClick={() => handleRemoveStem(stem.id)}
                            title="Remove"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <line x1="18" y1="6" x2="6" y2="18" />
                              <line x1="6" y1="6" x2="18" y2="18" />
                            </svg>
                          </button>
                        </div>
                        <div className={`upload-status upload-status-${stem.status.toLowerCase()}`}>
                          {stem.status}
                        </div>
                        {stem.status !== "Ready" && (
                          <div className="upload-progress">
                            <div
                              className="upload-progress-bar"
                              style={{ width: `${stem.progress}%` }}
                            />
                          </div>
                        )}
                      </div>
                      {stem.status === "Ready" && stem.previewUrl && (
                        <Button
                          variant="ghost"
                          onClick={() => {
                            const audio = new Audio(stem.previewUrl);
                            audio.play().catch(e => console.error("Preview failed", e));
                            addToast({
                              type: "success",
                              title: "Playing preview",
                              message: `Listening to ${stem.name}`
                            });
                          }}
                        >
                          Preview
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>

          <Card title="Release settings">
            <div className="upload-panel">
              <label>
                Release type (single/EP/album)
                <Input name="releaseType" placeholder="single" value={formData.releaseType} onChange={handleInputChange} />
              </label>
              <label>
                Release title
                <Input name="releaseTitle" placeholder="Night Drive" value={formData.releaseTitle} onChange={handleInputChange} />
              </label>
              <label>
                Track title
                <Input name="title" placeholder="Night Drive" value={formData.title} onChange={handleInputChange} />
              </label>
              <label>
                Primary artist
                <Input name="primaryArtist" placeholder="Aya Lune" value={formData.primaryArtist} onChange={handleInputChange} />
              </label>
              <label>
                Featured artists (comma-separated)
                <Input name="featuredArtists" placeholder="Kiro, Mira" value={formData.featuredArtists} onChange={handleInputChange} />
              </label>
              <label>
                Genre
                <Input name="genre" placeholder="Electronic" value={formData.genre} onChange={handleInputChange} />
              </label>
              <label>
                ISRC (optional)
                <Input name="isrc" placeholder="US-XYZ-24-00001" value={formData.isrc} onChange={handleInputChange} />
              </label>
              <label>
                Label (optional)
                <Input name="label" placeholder="Resonate Records" value={formData.label} onChange={handleInputChange} />
              </label>
              <label>
                Release date (optional)
                <Input name="releaseDate" placeholder="2026-01-18" value={formData.releaseDate} onChange={handleInputChange} />
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <input name="explicit" type="checkbox" checked={formData.explicit} onChange={handleInputChange} />
                Explicit content
              </label>
              <label>
                Remix price (USDC)
                <Input name="remixPrice" placeholder="5" value={formData.remixPrice} onChange={handleInputChange} />
              </label>
              <label>
                Commercial price (USDC)
                <Input name="commercialPrice" placeholder="25" value={formData.commercialPrice} onChange={handleInputChange} />
              </label>
              <Button
                variant={allReady ? "primary" : "ghost"}
                disabled={!allReady || isPublishing}
                onClick={handlePublish}
              >
                {isPublishing ? "Publishing..." : "Publish release"}
              </Button>
            </div>
          </Card>
        </main>
      </ArtistGate>
    </AuthGate>
  );
}

