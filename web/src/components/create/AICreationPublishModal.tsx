"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { generateArtwork } from "../../lib/api";

interface AICreationPublishModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPublish: (metadata: PublishMetadata) => Promise<void>;
  defaultTitle: string;
  defaultAudioUrl: string;
  action?: 'library' | 'demucs';
  userDisplayName?: string;
  token?: string;
}

export interface PublishMetadata {
  title: string;
  artist: string;
  remixedBy: string;
  genre: string;
  label: string;
  releaseDate: string;
  remixPrice: string;
  artworkBlob?: Blob;
}

function LockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5, flexShrink: 0 }}>
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function CustomAudioPreview({ url }: { url: string }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const togglePlay = () => {
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
      } else {
        audioRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  const formatTime = (time: number) => {
    if (isNaN(time)) return "0:00";
    const mins = Math.floor(time / 60);
    const secs = Math.floor(time % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 16,
      background: 'rgba(0, 242, 254, 0.02)',
      border: '1px solid rgba(255, 255, 255, 0.1)',
      borderRadius: 8,
      padding: '12px 16px',
      boxShadow: 'inset 0 2px 4px rgba(0, 0, 0, 0.3)',
    }}>
      <audio
        ref={audioRef}
        src={url}
        onTimeUpdate={() => setCurrentTime(audioRef.current?.currentTime || 0)}
        onLoadedMetadata={() => setDuration(audioRef.current?.duration || 0)}
        onEnded={() => setIsPlaying(false)}
      />
      <button type="button" onClick={togglePlay} style={{
        width: 40,
        height: 40,
        minWidth: 40,
        borderRadius: '50%',
        background: 'rgba(0, 242, 254, 0.1)',
        border: '1px solid rgba(0, 242, 254, 0.3)',
        color: '#00F2FE',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        flexShrink: 0,
        transition: 'all 0.2s ease',
      }}>
        {isPlaying ? (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="4" width="4" height="16" />
            <rect x="14" y="4" width="4" height="16" />
          </svg>
        ) : (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <polygon points="5 3 19 12 5 21 5 3" />
          </svg>
        )}
      </button>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{
          fontFamily: 'var(--font-mono, monospace)',
          fontSize: '0.8rem',
          color: 'rgba(0, 242, 254, 0.8)',
          minWidth: 40,
          textAlign: 'center',
        }}>{formatTime(currentTime)}</div>
        <div style={{
          flex: 1,
          height: 6,
          background: 'rgba(255, 255, 255, 0.1)',
          borderRadius: 3,
          cursor: 'pointer',
          position: 'relative',
          overflow: 'hidden',
        }} onClick={(e) => {
          if (!audioRef.current) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const percent = (e.clientX - rect.left) / rect.width;
          audioRef.current.currentTime = percent * duration;
        }}>
          <div style={{
            height: '100%',
            width: `${duration ? (currentTime / duration) * 100 : 0}%`,
            background: 'linear-gradient(90deg, #00F2FE 0%, #4FACFE 100%)',
            borderRadius: 3,
            boxShadow: '0 0 10px rgba(0, 242, 254, 0.5)',
          }} />
        </div>
        <div style={{
          fontFamily: 'var(--font-mono, monospace)',
          fontSize: '0.8rem',
          color: 'rgba(0, 242, 254, 0.8)',
          minWidth: 40,
          textAlign: 'center',
        }}>{formatTime(duration)}</div>
      </div>
    </div>
  );
}

export function AICreationPublishModal({
  isOpen,
  onClose,
  onPublish,
  defaultTitle,
  defaultAudioUrl,
  action = 'library',
  userDisplayName,
  token,
}: AICreationPublishModalProps) {
  const [title, setTitle] = useState(defaultTitle || "Night Drive");
  const [genre, setGenre] = useState("Electronic");
  const [remixPrice, setRemixPrice] = useState("5");
  const [isPublishing, setIsPublishing] = useState(false);

  // Artwork state
  const [artworkMode, setArtworkMode] = useState<'upload' | 'generate'>('generate');
  const [artworkPrompt, setArtworkPrompt] = useState("");
  const [isGeneratingArtwork, setIsGeneratingArtwork] = useState(false);
  const [artworkUrl, setArtworkUrl] = useState<string | null>(null);
  const [artworkBlob, setArtworkBlob] = useState<Blob | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Immutable IP fields
  const artist = "AI (Lyria)";
  const label = "Resonate Records";
  const releaseDate = new Date().toISOString().split("T")[0];
  const remixedBy = userDisplayName || "You";

  useEffect(() => {
    if (isOpen) {
      setTitle(defaultTitle || "Night Drive");
      setGenre("Electronic");
      setRemixPrice("5");
      setArtworkUrl(null);
      setArtworkBlob(null);
      setArtworkPrompt("");
      setArtworkMode('generate');
      setIsDragging(false);
    }
  }, [isOpen, defaultTitle]);

  // Handle image file (from upload or drop)
  const handleImageFile = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) return;
    if (file.size > 5 * 1024 * 1024) {
      alert('Image must be under 5MB');
      return;
    }
    const blob = new Blob([file], { type: file.type });
    setArtworkBlob(blob);
    setArtworkUrl(URL.createObjectURL(blob));
  }, []);

  // Drag-and-drop handlers
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleImageFile(file);
  }, [handleImageFile]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleImageFile(file);
  }, [handleImageFile]);

  const handleGenerateArtwork = useCallback(async () => {
    if (!artworkPrompt.trim()) return;
    setIsGeneratingArtwork(true);
    try {
      if (!token) {
        throw new Error('Not authenticated');
      }
      const result = await generateArtwork(token, artworkPrompt.trim());
      // Convert base64 to blob
      const byteChars = atob(result.imageData);
      const byteArray = new Uint8Array(byteChars.length);
      for (let i = 0; i < byteChars.length; i++) {
        byteArray[i] = byteChars.charCodeAt(i);
      }
      const blob = new Blob([byteArray], { type: result.mimeType });
      setArtworkBlob(blob);
      setArtworkUrl(URL.createObjectURL(blob));
    } catch (err) {
      console.error("Failed to generate artwork:", err);
    } finally {
      setIsGeneratingArtwork(false);
    }
  }, [artworkPrompt, token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsPublishing(true);
    try {
      await onPublish({
        title,
        artist,
        remixedBy,
        genre,
        label,
        releaseDate,
        remixPrice,
        ...(artworkBlob && { artworkBlob })
      });
      onClose();
    } catch (err) {
      console.error("Failed to publish:", err);
    } finally {
      setIsPublishing(false);
    }
  };

  if (!isOpen) return null;

  const modalContent = (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0, 0, 0, 0.85)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10000,
        padding: 24,
      }}
      onClick={onClose}
    >
      <div
        className="modal-content publish-modal console-card"
        onClick={(e) => e.stopPropagation()}
      >
        <form onSubmit={handleSubmit} className="publish-form-container">
          <div className="modal-header">
            <h2>{action === 'demucs' ? 'Publish & Send to Demucs' : 'Publish Release'}</h2>
            <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>

          <div className="modal-body">
            <div className="form-group">
              <label>Release type</label>
              <select className="form-input" disabled defaultValue="Single">
                <option value="Single">Single</option>
              </select>
            </div>

            {/* ── Artwork Section with Tabs ── */}
            <div className="artwork-section">
              <label className="section-title">RELEASE ARTWORK <span className="required-badge">⚠️ REQUIRED FOR VISIBILITY</span></label>
              
              {/* Tab Switcher */}
              <div className="artwork-tabs">
                <button
                  type="button"
                  className={`artwork-tab ${artworkMode === 'upload' ? 'active' : ''}`}
                  onClick={() => setArtworkMode('upload')}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="17 8 12 3 7 8" />
                    <line x1="12" y1="3" x2="12" y2="15" />
                  </svg>
                  Upload
                </button>
                <button
                  type="button"
                  className={`artwork-tab ${artworkMode === 'generate' ? 'active' : ''}`}
                  onClick={() => setArtworkMode('generate')}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
                  </svg>
                  AI Generate
                </button>
              </div>

              <div className="artwork-container">
                {/* Preview thumbnail */}
                <div className="artwork-preview">
                  {artworkUrl ? (
                    <Image src={artworkUrl} alt="Cover Art" className="artwork-img" fill unoptimized style={{ objectFit: 'cover' }} />
                  ) : (
                    <div className="artwork-placeholder">
                      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                        <circle cx="8.5" cy="8.5" r="1.5" />
                        <polyline points="21 15 16 10 5 21" />
                      </svg>
                    </div>
                  )}
                </div>

                {/* Upload mode */}
                {artworkMode === 'upload' && (
                  <div className="artwork-mode-content">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      onChange={handleFileSelect}
                      style={{ display: 'none' }}
                    />
                    <div
                      className={`upload-dropzone ${isDragging ? 'dragging' : ''}`}
                      onDragOver={handleDragOver}
                      onDragLeave={handleDragLeave}
                      onDrop={handleDrop}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="17 8 12 3 7 8" />
                        <line x1="12" y1="3" x2="12" y2="15" />
                      </svg>
                      <span className="dropzone-text">
                        {isDragging ? 'Drop image here' : 'Click or drag image'}
                      </span>
                      <span className="dropzone-hint">JPG, PNG, WebP · Max 5MB</span>
                    </div>
                  </div>
                )}

                {/* AI Generate mode */}
                {artworkMode === 'generate' && (
                  <div className="artwork-mode-content">
                    <div className="artwork-prompt-group">
                      <label className="prompt-label">Describe your cover art</label>
                      <textarea
                        className="artwork-prompt-input"
                        value={artworkPrompt}
                        onChange={(e) => setArtworkPrompt(e.target.value)}
                        placeholder="cosmic afrobeat sunset, vinyl record floating in space..."
                        rows={2}
                      />
                    </div>
                    <button
                      type="button"
                      className="btn-console btn-generate"
                      onClick={handleGenerateArtwork}
                      disabled={isGeneratingArtwork}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 8, verticalAlign: 'text-bottom' }}>
                        <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
                      </svg>
                      {isGeneratingArtwork ? "Generating..." : "Generate Artwork"}
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* ── Audio Preview ── */}
            <div className="form-group">
               <label>Audio Preview</label>
               <CustomAudioPreview url={defaultAudioUrl} />
            </div>

            {/* ── Release Title (editable) ── */}
            <div className="form-group">
              <label>Release title</label>
              <input
                type="text"
                className="form-input"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
              />
            </div>

            {/* ── Primary Artist + Remixed by (both immutable) ── */}
            <div className="form-row">
              <div className="form-group flex-1">
                <label>Primary artist <LockIcon /></label>
                <input
                  type="text"
                  className="form-input form-input-locked"
                  value={artist}
                  disabled
                />
              </div>
              <div className="form-group flex-1">
                <label>Remixed by <LockIcon /></label>
                <div className="remixed-by-badge">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                  {remixedBy}
                </div>
              </div>
            </div>

            {/* ── Genre (editable) + Remix Price (editable) ── */}
            <div className="form-row">
              <div className="form-group flex-1">
                <label>Genre</label>
                <input
                  type="text"
                  className="form-input"
                  value={genre}
                  onChange={(e) => setGenre(e.target.value)}
                />
              </div>
              <div className="form-group flex-1">
                <label>Remix price (USDC)</label>
                <input
                  type="number"
                  className="form-input"
                  value={remixPrice}
                  onChange={(e) => setRemixPrice(e.target.value)}
                  min="0"
                  step="1"
                />
              </div>
            </div>

            {/* ── Label + Release Date (both immutable) ── */}
            <div className="form-row">
              <div className="form-group flex-1">
                <label>Label <LockIcon /></label>
                <input
                  type="text"
                  className="form-input form-input-locked"
                  value={label}
                  disabled
                />
              </div>
              <div className="form-group flex-1">
                <label>Release date <LockIcon /></label>
                <input
                  type="date"
                  className="form-input form-input-locked"
                  value={releaseDate}
                  disabled
                />
              </div>
            </div>
          </div>

          <div className="modal-actions console-actions">
            <button type="button" className="btn-console btn-cancel" onClick={onClose} disabled={isPublishing}>
              Cancel
            </button>
            <button type="submit" className="btn-console btn-primary" disabled={isPublishing}>
              {isPublishing
                ? (action === 'demucs' ? 'Publishing & Sending…' : 'Publishing…')
                : (action === 'demucs' ? 'Publish & Send to Demucs' : 'Publish Release')}
            </button>
          </div>
        </form>

        <style jsx>{`

        .console-card {
          background: #09090B;
          border: 1px solid #27272A;
          border-top: 1px solid #3F3F46;
          border-radius: 20px;
          padding: 0; 
          box-shadow: 
            0 40px 80px rgba(0, 0, 0, 0.8),
            inset 0 1px 0 rgba(255, 255, 255, 0.1),
            inset 0 0 40px rgba(139, 92, 246, 0.05);
          position: relative;
          width: 620px;
          max-width: 95vw;
          max-height: 90vh;
          display: flex;
          color: #E4E4E7;
          font-family: var(--font-sans);
        }

        .publish-form-container {
          display: flex;
          flex-direction: column;
          width: 100%;
          height: 100%;
        }

        .modal-header {
          flex-shrink: 0;
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 24px 32px 20px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.05);
          background: #09090B;
          border-radius: 20px 20px 0 0;
          z-index: 10;
        }

        .modal-body {
          flex: 1;
          overflow-y: auto;
          padding: 24px 32px;
          display: flex;
          flex-direction: column;
          gap: 18px;
        }

        .modal-body::-webkit-scrollbar { width: 8px; }
        .modal-body::-webkit-scrollbar-track { background: rgba(255, 255, 255, 0.02); border-radius: 4px; }
        .modal-body::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.1); border-radius: 4px; }
        .modal-body::-webkit-scrollbar-thumb:hover { background: rgba(255, 255, 255, 0.2); }

        .console-card::before, .console-card::after {
          content: "";
          position: absolute;
          top: 16px;
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #27272A;
          box-shadow: inset 0 1px 2px rgba(0,0,0,0.8), 0 1px 0 rgba(255,255,255,0.1);
          z-index: 20;
        }
        .console-card::before { left: 16px; }
        .console-card::after { right: 16px; }

        .modal-header h2 {
          margin: 0;
          font-size: 1.5rem;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: -0.02em;
          color: #fff;
          text-shadow: 0 0 20px rgba(0, 242, 254, 0.4);
        }

        .modal-close {
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.1);
          color: #A1A1AA;
          width: 36px;
          height: 36px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: all 0.2s ease;
        }
        .modal-close:hover {
          background: rgba(244, 63, 94, 0.1);
          color: #F43F5E;
          border-color: rgba(244, 63, 94, 0.3);
          transform: rotate(90deg);
        }

        .form-row { display: flex; gap: 16px; }
        .flex-1 { flex: 1; }

        .form-group {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .form-group label {
          font-size: 0.75rem;
          color: rgba(0, 242, 254, 0.8);
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.15em;
          font-family: var(--font-mono, monospace);
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .form-group label::before {
          content: "";
          display: inline-block;
          width: 6px;
          height: 6px;
          background: #00F2FE;
          border-radius: 50%;
          box-shadow: 0 0 8px #00F2FE;
        }

        .form-input {
          background: rgba(0, 242, 254, 0.02);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 8px;
          padding: 14px 16px;
          color: #00F2FE;
          font-size: 1rem;
          font-family: var(--font-mono, monospace);
          transition: all 0.3s ease;
          box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.3);
        }

        .form-input:focus {
          outline: none;
          border-color: #00F2FE;
          background: rgba(0, 242, 254, 0.05);
          box-shadow: 
            inset 0 2px 4px rgba(0, 0, 0, 0.3),
            0 0 0 3px rgba(0, 242, 254, 0.15),
            0 0 15px rgba(0, 242, 254, 0.2);
        }

        .form-input:disabled,
        .form-input-locked {
          background: rgba(255, 255, 255, 0.015);
          color: #52525B;
          cursor: not-allowed;
          border-color: #1C1C1E;
          border-style: dashed;
        }

        .form-input::-webkit-calendar-picker-indicator {
          filter: invert(1) sepia(100%) saturate(1000%) hue-rotate(180deg) brightness(1.5);
          cursor: pointer;
        }
        /* Hide date picker icon on locked date fields */
        .form-input-locked::-webkit-calendar-picker-indicator {
          display: none;
        }

        /* ── Remixed-by badge ── */
        .remixed-by-badge {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 12px 16px;
          border-radius: 8px;
          background: rgba(0, 242, 254, 0.06);
          border: 1px solid rgba(0, 242, 254, 0.25);
          color: #00F2FE;
          font-size: 0.95rem;
          font-weight: 600;
          font-family: var(--font-mono, monospace);
          cursor: not-allowed;
          box-shadow:
            inset 0 2px 4px rgba(0, 0, 0, 0.2),
            0 0 12px rgba(0, 242, 254, 0.08);
        }
        .remixed-by-badge svg {
          color: rgba(0, 242, 254, 0.6);
          flex-shrink: 0;
        }

        /* ── Artwork Section ── */
        .artwork-section {
          background: rgba(255, 255, 255, 0.02);
          border: 1px solid rgba(255, 255, 255, 0.05);
          border-radius: 12px;
          padding: 20px;
          box-shadow: inset 0 2px 10px rgba(0,0,0,0.5);
        }

        .section-title {
          font-size: 0.75rem;
          font-weight: 700;
          letter-spacing: 0.1em;
          color: #A1A1AA;
          text-transform: uppercase;
          margin-bottom: 16px;
          display: flex;
          align-items: center;
        }

        .required-badge {
          color: #F59E0B;
          font-size: 0.65rem;
          margin-left: 12px;
          background: rgba(245, 158, 11, 0.1);
          padding: 2px 6px;
          border-radius: 4px;
          border: 1px solid rgba(245, 158, 11, 0.2);
        }

        /* ── Artwork Tabs ── */
        .artwork-tabs {
          display: flex;
          gap: 4px;
          margin-bottom: 16px;
          background: rgba(0, 0, 0, 0.3);
          border-radius: 10px;
          padding: 4px;
          border: 1px solid rgba(255, 255, 255, 0.04);
        }

        .artwork-tab {
          flex: 1;
          padding: 10px 16px;
          border: 1px solid transparent;
          border-radius: 8px;
          background: transparent;
          color: #71717A;
          font-size: 0.8rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          cursor: pointer;
          transition: all 0.25s ease;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          font-family: var(--font-mono, monospace);
        }
        .artwork-tab:hover {
          color: #A1A1AA;
          background: rgba(255, 255, 255, 0.03);
        }
        .artwork-tab.active {
          background: rgba(0, 242, 254, 0.08);
          color: #00F2FE;
          border-color: rgba(0, 242, 254, 0.3);
          box-shadow: 0 0 12px rgba(0, 242, 254, 0.1);
        }
        .artwork-tab.active svg {
          filter: drop-shadow(0 0 4px rgba(0, 242, 254, 0.5));
        }

        .artwork-container {
          display: flex;
          gap: 20px;
          align-items: flex-start;
        }

        .artwork-preview {
          width: 120px;
          height: 120px;
          background: #000;
          border-radius: 10px;
          border: 1px dashed rgba(0, 242, 254, 0.3);
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
          position: relative;
          box-shadow: inset 0 4px 12px rgba(0,0,0,0.5);
          flex-shrink: 0;
          transition: all 0.3s;
        }
        .artwork-preview:hover {
          border-color: #00F2FE;
          box-shadow: 0 0 15px rgba(0, 242, 254, 0.2), inset 0 4px 12px rgba(0,0,0,0.5);
        }

        .artwork-placeholder {
          color: rgba(0, 242, 254, 0.5);
        }

        .artwork-mode-content {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        /* ── Upload Dropzone ── */
        .upload-dropzone {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 8px;
          padding: 24px 16px;
          border: 2px dashed rgba(255, 255, 255, 0.1);
          border-radius: 10px;
          background: rgba(0, 0, 0, 0.2);
          cursor: pointer;
          transition: all 0.3s ease;
          color: #71717A;
          min-height: 100px;
        }
        .upload-dropzone:hover {
          border-color: rgba(0, 242, 254, 0.4);
          background: rgba(0, 242, 254, 0.03);
          color: #A1A1AA;
        }
        .upload-dropzone.dragging {
          border-color: #00F2FE;
          background: rgba(0, 242, 254, 0.08);
          color: #00F2FE;
          box-shadow: 0 0 20px rgba(0, 242, 254, 0.15);
        }
        .dropzone-text {
          font-size: 0.85rem;
          font-weight: 600;
          font-family: var(--font-mono, monospace);
        }
        .dropzone-hint {
          font-size: 0.7rem;
          opacity: 0.5;
          font-family: var(--font-mono, monospace);
        }

        /* ── Artwork Prompt ── */
        .artwork-prompt-group {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .prompt-label {
          font-size: 0.7rem;
          color: #71717A;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          font-family: var(--font-mono, monospace);
        }
        .artwork-prompt-input {
          background: rgba(0, 0, 0, 0.3);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 8px;
          padding: 10px 14px;
          color: #E4E4E7;
          font-size: 0.85rem;
          font-family: var(--font-mono, monospace);
          resize: none;
          transition: all 0.3s ease;
          line-height: 1.5;
        }
        .artwork-prompt-input::placeholder {
          color: #3F3F46;
          font-style: italic;
        }
        .artwork-prompt-input:focus {
          outline: none;
          border-color: rgba(0, 242, 254, 0.4);
          background: rgba(0, 242, 254, 0.02);
          box-shadow: 0 0 0 2px rgba(0, 242, 254, 0.1);
        }


        /* ── Console Buttons ── */
        .btn-console {
          padding: 12px 24px;
          border-radius: 8px;
          font-size: 0.85rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          cursor: pointer;
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
          font-family: var(--font-mono, monospace);
        }
        .btn-console:disabled { opacity: 0.5; cursor: not-allowed; }

        .btn-cancel {
          background: transparent;
          color: #A1A1AA;
          border: 1px solid rgba(255, 255, 255, 0.1);
        }
        .btn-cancel:hover:not(:disabled) {
          background: rgba(255, 255, 255, 0.05);
          color: #FFF;
          border-color: rgba(255, 255, 255, 0.3);
        }

        .btn-primary {
          background: linear-gradient(135deg, #00F2FE 0%, #4FACFE 100%);
          color: #000;
          border: none;
          box-shadow: 0 4px 12px rgba(0, 242, 254, 0.3);
        }
        .btn-primary:hover:not(:disabled) {
          transform: translateY(-2px);
          box-shadow: 0 6px 20px rgba(0, 242, 254, 0.5);
        }
        .btn-primary:active:not(:disabled) {
          transform: translateY(1px);
          box-shadow: 0 2px 8px rgba(0, 242, 254, 0.3);
        }

        .btn-generate {
          background: transparent;
          color: #00F2FE;
          border: 1px solid rgba(0, 242, 254, 0.3);
          padding: 8px 16px;
          border-radius: 8px;
          align-self: flex-start;
          display: inline-flex;
          align-items: center;
        }
        .btn-generate:hover:not(:disabled) {
          background: rgba(0, 242, 254, 0.1);
          border-color: #00F2FE;
          box-shadow: 0 4px 12px rgba(0, 242, 254, 0.2);
        }

        .console-actions {
          flex-shrink: 0;
          padding: 20px 32px;
          border-top: 1px solid rgba(255, 255, 255, 0.05);
          background: #09090B;
          border-radius: 0 0 20px 20px;
          display: flex;
          justify-content: flex-end;
          gap: 16px;
          z-index: 10;
        }
      `}</style>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
