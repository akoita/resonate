"use client";

import { useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import AuthGate from "../../../components/auth/AuthGate";
import ArtistGate from "../../../components/auth/ArtistGate";
import { Button } from "../../../components/ui/Button";
import { Card } from "../../../components/ui/Card";
import { Input } from "../../../components/ui/Input";
import { FileDropZone } from "../../../components/ui/FileDropZone";
import { useToast } from "../../../components/ui/Toast";
import { useAuth } from "../../../components/auth/AuthProvider";
import { getArtistMe, uploadStems } from "../../../lib/api";
import { extractMetadata } from "../../../lib/metadataExtractor";

const MAX_FILE_SIZE_MB = 200;
const MAX_TOTAL_SIZE_MB = 500;
const MAX_FILE_SIZE = MAX_FILE_SIZE_MB * 1024 * 1024;
const MAX_TOTAL_SIZE = MAX_TOTAL_SIZE_MB * 1024 * 1024;

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

type Stem = {
  id: string;
  name: string;
  status: "Uploading" | "Processing" | "Ready" | "Error";
  progress: number;
  previewUrl?: string;
  artworkUrl?: string;
  artworkBlob?: Blob; // Added for uploading
  file?: File;
  metadata: {
    title: string;
    isrc: string;
    explicit: boolean;
    featuredArtists: string;
  };
};

export default function ArtistUploadPage() {
  const router = useRouter();
  const { token, address } = useAuth();
  const [stems, setStems] = useState<Stem[]>([]);
  const [selectedStemId, setSelectedStemId] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const { addToast } = useToast();
  const artworkInputRef = useRef<HTMLInputElement>(null);

  // Form state
  const [formData, setFormData] = useState({
    releaseType: "single",
    releaseTitle: "",
    title: "",
    primaryArtist: "",
    featuredArtists: "",
    genre: "",
    isrc: "",
    label: "",
    releaseDate: new Date().toISOString().split('T')[0],
    explicit: false,
    remixPrice: "5",
    commercialPrice: "25",
    artworkUrl: "",
    artworkBlob: undefined as Blob | undefined,
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
    if (stems.length === 0) {
      addToast({
        type: "error",
        title: "No tracks uploaded",
        message: "Please upload at least one track before publishing.",
      });
      return;
    }

    const missingTitles = stems.some(s => !s.metadata.title.trim());
    if (missingTitles) {
      addToast({
        type: "error",
        title: "Missing track titles",
        message: "Please ensure all uploaded tracks have a title.",
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
        type: formData.releaseType || "single",
        title: formData.releaseTitle,
        primaryArtist: formData.primaryArtist,
        genre: formData.genre || undefined,
        label: formData.label || undefined,
        releaseDate: formData.releaseDate || undefined,
        remixPrice: formData.remixPrice || undefined,
        commercialPrice: formData.commercialPrice || undefined,
        tracks: stems.map(s => ({
          title: s.metadata.title,
          isrc: s.metadata.isrc || undefined,
          explicit: s.metadata.explicit,
          featuredArtists: s.metadata.featuredArtists ? s.metadata.featuredArtists.split(",").map((str: string) => str.trim()) : [],
        }))
      };

      // Check total payload size before uploading
      const totalSize = stems.reduce((acc, s) => acc + (s.file?.size ?? 0), 0)
        + (formData.artworkBlob?.size ?? 0);
      if (totalSize > MAX_TOTAL_SIZE) {
        throw new Error(
          `Total upload size is ${formatFileSize(totalSize)} — max ${MAX_TOTAL_SIZE_MB}MB. ` +
          `Consider using FLAC or MP3 instead of WAV, or upload fewer tracks at once.`
        );
      }

      const uploadPayload = new FormData();
      uploadPayload.append("artistId", artist.id);
      uploadPayload.append("metadata", JSON.stringify(metadata));

      // Append real files
      stems.forEach((stem) => {
        if (stem.file) {
          uploadPayload.append("files", stem.file);
        }
      });

      // Append artwork if available
      if (formData.artworkBlob) {
        uploadPayload.append("artwork", formData.artworkBlob, "artwork.png");
      } else if (stems.length > 0 && stems[0].artworkBlob) {
        // Fallback to first track's artwork
        uploadPayload.append("artwork", stems[0].artworkBlob, "artwork.png");
      }

      const result = await uploadStems(token, uploadPayload);

      addToast({
        type: "success",
        title: "Release submitted!",
        message: `"${formData.releaseTitle}" has been queued for processing. Click to view or it will appear on your dashboard shortly.`,
        duration: 10000,
        onClick: () => {
          if (result && result.releaseId) {
            router.push(`/release/${result.releaseId}`);
          }
        }
      });

      // Reset form
      setStems([]);
      setFormData({
        releaseType: "single",
        releaseTitle: "",
        title: "", // Still keeping title in state for now although unused, but better to remove later in a full cleanup
        primaryArtist: "",
        featuredArtists: "",
        genre: "",
        isrc: "",
        label: "",
        releaseDate: new Date().toISOString().split('T')[0],
        explicit: false,
        remixPrice: "5",
        commercialPrice: "25",
        artworkUrl: "", // Added for display
        artworkBlob: undefined,
      });
      setSelectedStemId(null);
    } catch (err) {
      const msg = (err as Error).message || "";
      let title = "Failed to publish";
      let message = "An error occurred while publishing. Please try again.";

      if (msg.includes("Total upload size") || msg.includes("File too large")) {
        title = "Upload too large";
        message = msg;
      } else if (msg.includes("413") || msg.includes("Content Too Large") || msg.includes("ERR_FAILED")) {
        title = "Upload too large";
        message = `The upload exceeds the server limit. Try compressing your files to FLAC or MP3, or upload fewer tracks at once.`;
      } else if (msg.includes("Failed to fetch") || msg.includes("NetworkError") || msg.includes("CORS")) {
        title = "Network error";
        message = "Could not reach the server. Please check your connection and try again.";
      }

      addToast({
        type: "error",
        title,
        message,
        duration: 10000,
      });
    } finally {
      setIsPublishing(false);
    }
  };

  const handleFilesSelect = useCallback(async (files: File[]) => {
    if (files.length === 0) return;

    setIsUploading(true);

    // Process each file
    for (const file of files) {
      // Validate file type
      const validTypes = ["audio/mpeg", "audio/wav", "audio/flac", "audio/aiff", "audio/x-aiff", "audio/m4a", "audio/ogg"];
      if (!validTypes.some(type => file.type.includes(type.split("/")[1] ?? "") || file.name.match(/\.(mp3|wav|flac|aiff|m4a|ogg)$/i))) {
        addToast({
          type: "error",
          title: "Invalid file format",
          message: `Skipping ${file.name}: please select a valid audio file.`,
        });
        continue;
      }

      // Validate individual file size
      if (file.size > MAX_FILE_SIZE) {
        addToast({
          type: "error",
          title: "File too large",
          message: `${file.name} is ${formatFileSize(file.size)} — max ${MAX_FILE_SIZE_MB}MB per file. Consider compressing to FLAC or MP3.`,
          duration: 8000,
        });
        continue;
      }

      const previewUrl = URL.createObjectURL(file);

      // Auto-extract metadata to pre-fill individual track metadata
      extractMetadata(file).then(meta => {
        const extractedArtworkUrl = meta.artworkBlob ? URL.createObjectURL(meta.artworkBlob) : undefined;

        setStems(prev => prev.map(s => {
          if (s.file === file) {
            return {
              ...s,
              artworkUrl: extractedArtworkUrl,
              artworkBlob: meta.artworkBlob || undefined,
              metadata: {
                ...s.metadata,
                title: meta.title || s.metadata.title,
                isrc: meta.isrc || s.metadata.isrc,
                featuredArtists: meta.artist && meta.artist !== formData.primaryArtist ? meta.artist : s.metadata.featuredArtists,
              }
            };
          }
          return s;
        }));

        // Also update global release metadata if it's the first track and empty
        setFormData(prev => {
          // Fallback logic for release title: Album -> Track Title (if first item)
          const detectedTitle = meta.album || (stems.length === 0 ? meta.title : "");

          return {
            ...prev,
            releaseTitle: prev.releaseTitle || detectedTitle || "",
            primaryArtist: prev.primaryArtist || meta.artist || meta.albumArtist || "",
            genre: prev.genre || meta.genre || "",
            label: prev.label || meta.label || "",
            releaseDate: meta.year ? `${meta.year}-01-01` : prev.releaseDate,
            artworkUrl: prev.artworkUrl || extractedArtworkUrl || "",
            artworkBlob: prev.artworkBlob || meta.artworkBlob || undefined,
          };
        });
      }).catch(err => console.error("Metadata extraction failed", err));

      // Create a new stem entry
      const newStem: Stem = {
        id: crypto.randomUUID(),
        name: file.name,
        status: "Uploading",
        progress: 0,
        previewUrl,
        file,
        metadata: {
          title: file.name.replace(/\.[^/.]+$/, ""),
          isrc: "",
          explicit: false,
          featuredArtists: "",
        }
      };

      setStems(prev => [...prev, newStem]);
      if (!selectedStemId) setSelectedStemId(newStem.id);

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
            // Only set isUploading to false if all stems are ready or processing
            setStems(currentStems => {
              if (currentStems.every(s => s.status === "Ready" || s.status === "Error")) {
                setIsUploading(false);
              }
              return currentStems;
            });
          }, 2000);
        } else {
          setStems(prev =>
            prev.map(s =>
              s.id === newStem.id ? { ...s, progress: Math.min(progress, 100) } : s
            )
          );
        }
      }, 200);
    }
  }, [addToast, formData.primaryArtist, selectedStemId, stems.length]);

  const handleRemoveStem = useCallback((id: string) => {
    setStems(prev => prev.filter(s => s.id !== id));
    if (selectedStemId === id) setSelectedStemId(null);
  }, [selectedStemId]);

  const handleArtworkSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const url = URL.createObjectURL(file);
    setFormData(prev => ({
      ...prev,
      artworkUrl: url,
      artworkBlob: file
    }));

    addToast({
      type: "success",
      title: "Artwork updated",
      message: "Modified release cover art manually"
    });
  };

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
                onFilesSelect={handleFilesSelect}
                onFileSelect={(f) => handleFilesSelect([f])}
                multiple
                accept="audio/*"
                disabled={isUploading}
              />
              {stems.length > 0 && (
                <div className="upload-list">
                  <div
                    className={`upload-item-global ${!selectedStemId ? 'active' : ''}`}
                    onClick={() => setSelectedStemId(null)}
                  >
                    <div className="upload-item-artwork">
                      {formData.artworkUrl ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img src={formData.artworkUrl} alt="Release Artwork" />
                      ) : (
                        <div className="artwork-placeholder">📦</div>
                      )}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div className="upload-item-name">Release Information</div>
                      <div className="upload-status">Common settings for all tracks</div>
                    </div>
                  </div>
                  {stems.map(stem => (
                    <div
                      key={stem.id}
                      className={`upload-item ${selectedStemId === stem.id ? 'active' : ''}`}
                      onClick={() => setSelectedStemId(stem.id)}
                      style={{ cursor: 'pointer' }}
                    >
                      <div className="upload-item-artwork">
                        {stem.artworkUrl ? (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img src={stem.artworkUrl} alt={stem.name} />
                        ) : (
                          <div className="artwork-placeholder">🎵</div>
                        )}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div className="upload-item-header">
                          <span className="upload-item-name">{stem.name}</span>
                          <button
                            className="upload-item-remove"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRemoveStem(stem.id);
                            }}
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

          <Card>
            <div className="upload-panel">
              <div className="tabs">
                <button
                  className={`tab ${!selectedStemId ? 'active' : ''}`}
                  onClick={() => setSelectedStemId(null)}
                >
                  Release Settings
                </button>
                {stems.length > 0 && (
                  <button
                    className={`tab ${selectedStemId ? 'active' : ''}`}
                    onClick={() => setSelectedStemId(stems[0]?.id || null)}
                  >
                    Track Details
                  </button>
                )}
              </div>

              {!selectedStemId ? (
                <div className="settings-group">
                  <label>
                    Release type
                    <select
                      name="releaseType"
                      className="track-select-dropdown"
                      value={formData.releaseType}
                      onChange={(e) => setFormData(prev => ({ ...prev, releaseType: e.target.value }))}
                    >
                      <option value="single">Single</option>
                      <option value="ep">EP</option>
                      <option value="album">Album</option>
                      <option value="mixtape">Mixtape</option>
                      <option value="compilation">Compilation</option>
                      <option value="remix">Remix</option>
                      <option value="live">Live</option>
                    </select>
                  </label>

                  <div className="artwork-manual-upload" style={{ marginBottom: "var(--space-6)" }}>
                    <div className="studio-label" style={{ marginBottom: "12px", display: "flex", justifyContent: "space-between" }}>
                      <span>Release Artwork</span>
                      {!formData.artworkUrl && <span style={{ color: "var(--color-error)", fontSize: "10px" }}>⚠️ Required for visibility</span>}
                    </div>
                    <div style={{ display: "flex", gap: "32px", alignItems: "flex-start" }}>
                      <div className="upload-item-artwork" style={{ width: "160px", height: "160px", margin: 0, borderRadius: "12px" }}>
                        {formData.artworkUrl ? (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img src={formData.artworkUrl} alt="Artwork" />
                        ) : (
                          <div className="artwork-placeholder" style={{ fontSize: "40px" }}>🖼️</div>
                        )}
                      </div>
                      <div style={{ flex: 1, paddingTop: "8px" }}>
                        <p style={{ fontSize: "14px", fontWeight: 500, marginBottom: "8px", color: "#fff" }}>Cover Image</p>
                        <p style={{ fontSize: "12px", opacity: 0.5, marginBottom: "20px", lineHeight: "1.5" }}>
                          {formData.artworkUrl ? "Artwork detected from metadata. You can override it with a higher quality file." : "No artwork found. Please upload a high-resolution square cover (min 1500x1500px)."}
                        </p>
                        <input
                          type="file"
                          ref={artworkInputRef}
                          style={{ display: "none" }}
                          accept="image/*"
                          onChange={handleArtworkSelect}
                        />
                        <Button
                          variant="ghost"
                          onClick={() => artworkInputRef.current?.click()}
                          style={{
                            padding: "6px 14px",
                            fontSize: "11px",
                            height: "auto",
                            borderColor: "rgba(255,255,255,0.1)",
                            color: "var(--color-muted)"
                          }}
                        >
                          Change Artwork
                        </Button>
                      </div>
                    </div>
                  </div>

                  <label>
                    Release title
                    <Input name="releaseTitle" placeholder="Night Drive" value={formData.releaseTitle} onChange={handleInputChange} />
                  </label>
                  <label>
                    Primary artist
                    <Input name="primaryArtist" placeholder="Aya Lune" value={formData.primaryArtist} onChange={handleInputChange} />
                  </label>
                  <label>
                    Genre
                    <Input
                      name="genre"
                      placeholder="Electronic"
                      list="genre-list"
                      value={formData.genre}
                      onChange={handleInputChange}
                    />
                    <datalist id="genre-list">
                      <option value="Acid House" />
                      <option value="Acid Jazz" />
                      <option value="Acoustic" />
                      <option value="Afro-Pop" />
                      <option value="Afrobeat" />
                      <option value="Amapiano" />
                      <option value="Alternative" />
                      <option value="Ambient" />
                      <option value="Americana" />
                      <option value="Baile Funk" />
                      <option value="Big Room" />
                      <option value="Bluegrass" />
                      <option value="Blues" />
                      <option value="Bossa Nova" />
                      <option value="Breakbeat" />
                      <option value="Classical" />
                      <option value="Country" />
                      <option value="Dance" />
                      <option value="Dancehall" />
                      <option value="Deep House" />
                      <option value="Disco" />
                      <option value="Drill" />
                      <option value="Drum & Bass" />
                      <option value="Dub" />
                      <option value="Dubstep" />
                      <option value="EDM" />
                      <option value="Electronic" />
                      <option value="Electro" />
                      <option value="Experimental" />
                      <option value="Folk" />
                      <option value="Funk" />
                      <option value="Future Bass" />
                      <option value="Future House" />
                      <option value="Garage" />
                      <option value="Glitch" />
                      <option value="Gospel" />
                      <option value="Grime" />
                      <option value="Hardcore" />
                      <option value="Hardstyle" />
                      <option value="Heavy Metal" />
                      <option value="Hip-Hop" />
                      <option value="House" />
                      <option value="Hyperpop" />
                      <option value="IDM" />
                      <option value="Indie" />
                      <option value="Industrial" />
                      <option value="J-Pop" />
                      <option value="Jazz" />
                      <option value="Jungle" />
                      <option value="K-Pop" />
                      <option value="Kuduro" />
                      <option value="Latin" />
                      <option value="Lo-Fi" />
                      <option value="Melodic Techno" />
                      <option value="Metal" />
                      <option value="Minimal" />
                      <option value="Musiques du monde" />
                      <option value="New Age" />
                      <option value="Nu-Disco" />
                      <option value="Opera" />
                      <option value="Phonk" />
                      <option value="Pop" />
                      <option value="Post-Punk" />
                      <option value="Psytrance" />
                      <option value="Psych-Rock" />
                      <option value="Punk" />
                      <option value="R&B" />
                      <option value="Rap" />
                      <option value="Reggae" />
                      <option value="Reggaeton" />
                      <option value="Rock" />
                      <option value="Ska" />
                      <option value="Slap House" />
                      <option value="Soul" />
                      <option value="Soulful House" />
                      <option value="Synthpop" />
                      <option value="Synthwave" />
                      <option value="Tech House" />
                      <option value="Techno" />
                      <option value="Trance" />
                      <option value="Trap" />
                      <option value="Trip-Hop" />
                      <option value="Tropical House" />
                      <option value="UK Garage" />
                      <option value="Vaporwave" />
                      <option value="World" />
                    </datalist>
                  </label>
                  <label>
                    Label (optional)
                    <Input name="label" placeholder="Resonate Records" value={formData.label} onChange={handleInputChange} />
                  </label>
                  <label>
                    Release date (optional)
                    <Input
                      type="date"
                      name="releaseDate"
                      value={formData.releaseDate}
                      onChange={handleInputChange}
                      className="track-select-dropdown" /* Reuse dropdown styling for consistency */
                      style={{ colorScheme: "dark" }}
                    />
                  </label>
                  <label>
                    Remix price (USDC)
                    <Input name="remixPrice" placeholder="5" value={formData.remixPrice} onChange={handleInputChange} />
                  </label>
                  <label>
                    Commercial price (USDC)
                    <Input name="commercialPrice" placeholder="25" value={formData.commercialPrice} onChange={handleInputChange} />
                  </label>
                </div>
              ) : (
                <div className="settings-group">
                  <div className="track-selection-mini">
                    <select
                      value={selectedStemId}
                      onChange={(e) => setSelectedStemId(e.target.value)}
                      className="track-select-dropdown"
                    >
                      {stems.map(s => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  </div>

                  {stems.find(s => s.id === selectedStemId) && (
                    <>
                      <label>
                        Track title
                        <Input
                          value={stems.find(s => s.id === selectedStemId)?.metadata.title || ""}
                          onChange={(e) => {
                            const val = e.target.value;
                            setStems(prev => prev.map(s => s.id === selectedStemId ? { ...s, metadata: { ...s.metadata, title: val } } : s));
                          }}
                        />
                      </label>
                      <label>
                        Featured artists (comma-separated)
                        <Input
                          value={stems.find(s => s.id === selectedStemId)?.metadata.featuredArtists || ""}
                          onChange={(e) => {
                            const val = e.target.value;
                            setStems(prev => prev.map(s => s.id === selectedStemId ? { ...s, metadata: { ...s.metadata, featuredArtists: val } } : s));
                          }}
                        />
                      </label>
                      <label>
                        ISRC (optional)
                        <Input
                          value={stems.find(s => s.id === selectedStemId)?.metadata.isrc || ""}
                          onChange={(e) => {
                            const val = e.target.value;
                            setStems(prev => prev.map(s => s.id === selectedStemId ? { ...s, metadata: { ...s.metadata, isrc: val } } : s));
                          }}
                        />
                      </label>
                      <label style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <input
                          type="checkbox"
                          checked={stems.find(s => s.id === selectedStemId)?.metadata.explicit || false}
                          onChange={(e) => {
                            const val = e.target.checked;
                            setStems(prev => prev.map(s => s.id === selectedStemId ? { ...s, metadata: { ...s.metadata, explicit: val } } : s));
                          }}
                        />
                        Explicit content
                      </label>
                    </>
                  )}
                </div>
              )}

              <div style={{ marginTop: "2rem" }}>
                <Button
                  variant={allReady ? "primary" : "ghost"}
                  disabled={!allReady || isPublishing}
                  onClick={handlePublish}
                  className="w-full"
                >
                  {isPublishing ? "Publishing..." : "Publish release"}
                </Button>
              </div>
            </div>
          </Card>
        </main>
      </ArtistGate>
    </AuthGate>
  );
}

