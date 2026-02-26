"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import AuthGate from "../../components/auth/AuthGate";
import { useAuth } from "../../components/auth/AuthProvider";
import { useGeneration } from "../../hooks/useGeneration";
import { getArtistMe, uploadStems, getReleaseArtworkUrl, saveLibraryTrackAPI, getGenerationAnalytics, GenerationAnalytics, publishAiGeneration } from "../../lib/api";
import { AICreationPublishModal, PublishMetadata } from "../../components/create/AICreationPublishModal";
import { DuplicatePublishWarningModal } from "../../components/create/DuplicatePublishWarningModal";
import { useToast } from "../../components/ui/Toast";
import "../../styles/create.css";

const STYLE_PRESETS = [
  { label: "Lo-fi Chill", prompt: "Lo-fi chill beat, relaxed, warm vinyl crackle" },
  { label: "Afrobeat", prompt: "Afrobeat groove, percussive, highlife guitars, 110 BPM" },
  { label: "Ambient", prompt: "Ambient drone, ethereal pads, slow evolving textures" },
  { label: "Funk", prompt: "Funky bass-heavy beat, analog synths, groovy and warm" },
  { label: "Jazz", prompt: "Smooth jazz lounge, mellow saxophone, brushed drums" },
  { label: "Trap", prompt: "Hard trap beat, 808s, hi-hat rolls, dark atmosphere, 140 BPM" },
  { label: "Cinematic", prompt: "Cinematic orchestral score, sweeping strings, epic brass" },
];

export default function CreatePageContent() {
  const { token, status } = useAuth();
  const router = useRouter();
  const { addToast } = useToast();
  const [artistId, setArtistId] = useState<string | null>(null);
  const [artistDisplayName, setArtistDisplayName] = useState<string>("");
  const [prompt, setPrompt] = useState("");
  const [activeStyles, setActiveStyles] = useState<Set<string>>(new Set());
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [noVocals, setNoVocals] = useState(false);
  const [noDrums, setNoDrums] = useState(false);
  const [customExclude, setCustomExclude] = useState("");
  const [analytics, setAnalytics] = useState<GenerationAnalytics>({
    totalGenerations: 0,
    totalCost: 0,
    rateLimit: { remaining: 5, limit: 5, resetsAt: null },
  });
  const [isPublishModalOpen, setIsPublishModalOpen] = useState(false);
  const [isDuplicateWarningOpen, setIsDuplicateWarningOpen] = useState(false);
  const [publishActionQueue, setPublishActionQueue] = useState<'library' | 'demucs' | null>(null);
  const [hasPublished, setHasPublished] = useState(false);

  const { state, result, error, startGeneration, reset, restoreState } = useGeneration(token, artistId);

  // Restore session state on mount
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem("resonate_ai_session");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.prompt) setPrompt(parsed.prompt);
        if (parsed.hasPublished) setHasPublished(parsed.hasPublished);
        if (parsed.state && parsed.result) {
          restoreState(parsed.state, parsed.result);
        }
      }
    } catch { /* ignore parse errors */ }
  }, [restoreState]);

  // Guard: skip idle-cleanup on initial mount so the restore effect can read sessionStorage first
  const hasMountedRef = useRef(false);

  // Save session state when it changes
  useEffect(() => {
    if (state === "complete" && result) {
      hasMountedRef.current = true;
      sessionStorage.setItem("resonate_ai_session", JSON.stringify({ prompt, state, result, hasPublished }));
    } else if (state === "idle" && hasMountedRef.current) {
      sessionStorage.removeItem("resonate_ai_session");
      setHasPublished(false);
    }
  }, [state, result, prompt, hasPublished]);

  // Fetch artist profile on mount
  useEffect(() => {
    if (token && status === "authenticated") {
      getArtistMe(token).then((artist) => {
        if (artist) {
          setArtistId(artist.id);
          setArtistDisplayName(artist.displayName || "");
        }
      }).catch(() => { /* ignore */ });
      getGenerationAnalytics(token)
        .then(setAnalytics)
        .catch(() => { /* ignore */ });
    }
  }, [token, status]);

  const toggleStyle = useCallback((preset: typeof STYLE_PRESETS[0]) => {
    setActiveStyles((prev) => {
      const next = new Set(prev);
      if (next.has(preset.label)) {
        next.delete(preset.label);
        // Remove from prompt
        setPrompt((p) => p.replace(preset.prompt, "").replace(/,\s*,/g, ",").replace(/^,\s*|,\s*$/g, "").trim());
      } else {
        next.add(preset.label);
        setPrompt((p) => (p ? `${p}, ${preset.prompt}` : preset.prompt));
      }
      return next;
    });
  }, []);

  const buildNegativePrompt = useCallback(() => {
    const parts: string[] = [];
    if (noVocals) parts.push("no vocals");
    if (noDrums) parts.push("no drums");
    if (customExclude.trim()) parts.push(customExclude.trim());
    return parts.length > 0 ? parts.join(", ") : undefined;
  }, [noVocals, noDrums, customExclude]);

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim()) return;
    await startGeneration(prompt.trim(), {
      negativePrompt: buildNegativePrompt(),
    });
  }, [prompt, startGeneration, buildNegativePrompt]);

  const handleRegenerate = useCallback(async () => {
    reset();
    await startGeneration(prompt.trim(), {
      negativePrompt: buildNegativePrompt(),
      seed: Math.floor(Math.random() * 2147483647),
    });
  }, [prompt, startGeneration, buildNegativePrompt, reset]);

  const handleSendToDemucs = useCallback(() => {
    setPublishActionQueue("demucs");
    if (hasPublished) {
      setIsDuplicateWarningOpen(true);
      return;
    }
    setIsPublishModalOpen(true);
  }, [hasPublished]);

  const handleSaveToLibrary = useCallback(() => {
    setPublishActionQueue("library");
    if (hasPublished) {
      setIsDuplicateWarningOpen(true);
      return;
    }
    setIsPublishModalOpen(true);
  }, [hasPublished]);

  const handleDuplicateWarningConfirm = useCallback(() => {
    setIsDuplicateWarningOpen(false);
    setIsPublishModalOpen(true);
  }, []);

  const handlePublishConfirm = useCallback(async (metadata: PublishMetadata) => {
    if (!result?.trackId || !token || !publishActionQueue) return;
    try {
      const formData = new FormData();
      formData.append("title", metadata.title);
      formData.append("artist", metadata.artist);
      if (metadata.remixedBy) formData.append("featuredArtists", metadata.remixedBy);
      if (metadata.genre) formData.append("genre", metadata.genre);
      if (metadata.label) formData.append("label", metadata.label);
      if (metadata.releaseDate) formData.append("releaseDate", metadata.releaseDate);
      console.log("[AI Publish] artworkBlob:", metadata.artworkBlob ? `${metadata.artworkBlob.size} bytes, type=${metadata.artworkBlob.type}` : "none");
      if (metadata.artworkBlob) formData.append("artworkBlob", metadata.artworkBlob, "cover.png");

      // First publish metadata to the global catalog release
      const publishResult = await publishAiGeneration(token, result.trackId, formData);

      // Use the authoritative releaseId from the backend response
      let targetReleaseId = publishResult?.releaseId ?? result.releaseId;

      if (publishActionQueue === "library") {
        await saveLibraryTrackAPI(token, {
          id: result.trackId,
          source: "remote",
          title: metadata.title,
          artist: metadata.artist,
          album: metadata.title, // Use title as album for singles
          albumArtist: metadata.artist,
          genre: metadata.genre,
          year: metadata.releaseDate ? parseInt(metadata.releaseDate.split("-")[0]) : undefined,
          catalogTrackId: result.trackId,
          remoteUrl: `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000"}/catalog/releases/${targetReleaseId}/tracks/${result.trackId}/stream`,
          remoteArtworkUrl: getReleaseArtworkUrl(targetReleaseId),
        });
      } else if (publishActionQueue === "demucs") {
        const demucsFormData = new FormData();
        demucsFormData.append("trackId", result.trackId);
        demucsFormData.append("source", "ai_generated");
        // Send structured metadata matching what ingestion service expects
        demucsFormData.append("metadata", JSON.stringify({
          title: metadata.title,
          primaryArtist: metadata.artist,
          genre: metadata.genre,
          label: metadata.label,
          releaseDate: metadata.releaseDate,
          tracks: [{
            title: metadata.title,
            artist: metadata.artist,
          }],
        }));
        if (metadata.artworkBlob) {
          demucsFormData.append("artwork", metadata.artworkBlob, "cover.png");
        }
        const demucsResult = await uploadStems(token, demucsFormData);

        // Demucs creates a new release — use that ID for navigation
        if (demucsResult?.releaseId) {
          targetReleaseId = demucsResult.releaseId;
        }
      }
      setHasPublished(true);

      // Show clickable toast linking to the release (with cache-busting rev to show fresh artwork)
      const actionLabel = publishActionQueue === "demucs" ? "sent to Demucs" : "published";
      addToast({
        type: "success",
        title: `Track ${actionLabel}!`,
        message: "Click here to view your release →",
        duration: 8000,
        onClick: () => router.push(`/release/${targetReleaseId}?rev=${Date.now()}`),
      });
    } catch (err) {
      console.error(err);
    } finally {
      setIsPublishModalOpen(false);
      setPublishActionQueue(null);
    }
  }, [result, token, publishActionQueue, addToast, router]);

  const getStreamUrl = useCallback(() => {
    if (!result) return "";
    return `${getReleaseArtworkUrl(result.releaseId).replace("/artwork", `/tracks/${result.trackId}/stream`)}`;
  }, [result]);

  const handleDownload = useCallback(async () => {
    if (!result) return;
    try {
      const response = await fetch(getStreamUrl());
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${prompt.trim().slice(0, 40) || "ai-track"}.wav`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (err) {
      console.error("Download failed:", err);
    }
  }, [result, getStreamUrl, prompt]);

  const isGenerating = state !== "idle" && state !== "complete" && state !== "failed";

  const getProgressPercent = () => {
    switch (state) {
      case "submitting": return 5;
      case "queued": return 15;
      case "generating": return 50;
      case "storing": return 85;
      case "complete": return 100;
      default: return 0;
    }
  };

  return (
    <AuthGate title="Connect to create with AI">
      <div className="create-page">
        <div className="create-header">
          <h1>✨ Create with AI</h1>
          <p>Describe the track you want and Lyria will generate a 30-second clip</p>
        </div>

        <div className="create-card">
          {/* Prompt Input */}
          <label className="prompt-label">What kind of track do you want?</label>
          <textarea
            className="prompt-textarea"
            placeholder="A funky bass-heavy beat with analog synths, 115 BPM, groovy and warm..."
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            disabled={isGenerating}
            rows={4}
          />

          {/* Style Presets */}
          <div className="style-chips-section">
            <span className="style-chips-label">Style Presets</span>
            <div className="style-chips">
              {STYLE_PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  className={`style-chip ${activeStyles.has(preset.label) ? "active" : ""}`}
                  onClick={() => toggleStyle(preset)}
                  disabled={isGenerating}
                  type="button"
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          {/* Advanced / Negative Prompt */}
          <button
            className={`advanced-toggle ${showAdvanced ? "open" : ""}`}
            onClick={() => setShowAdvanced(!showAdvanced)}
            type="button"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
            Advanced: Exclude elements
          </button>

          {showAdvanced && (
            <div className="advanced-content">
              <div className="exclude-checkboxes">
                <label className="exclude-checkbox">
                  <input
                    type="checkbox"
                    checked={noVocals}
                    onChange={(e) => setNoVocals(e.target.checked)}
                    disabled={isGenerating}
                  />
                  No vocals
                </label>
                <label className="exclude-checkbox">
                  <input
                    type="checkbox"
                    checked={noDrums}
                    onChange={(e) => setNoDrums(e.target.checked)}
                    disabled={isGenerating}
                  />
                  No drums
                </label>
              </div>
              <input
                className="negative-prompt-input"
                placeholder="Custom exclusions: e.g. no piano, no reverb"
                value={customExclude}
                onChange={(e) => setCustomExclude(e.target.value)}
                disabled={isGenerating}
              />
            </div>
          )}

          {/* Analytics Info Strip */}
          {analytics && (
            <div className="create-analytics-strip">
              <div className="create-analytics-item">
                <span className="create-analytics-label">Generations</span>
                <span className="create-analytics-value">{analytics.totalGenerations}</span>
              </div>
              <div className="create-analytics-divider" />
              <div className="create-analytics-item">
                <span className="create-analytics-label">Rate Limit</span>
                <span className={`create-analytics-value rate-status ${
                  analytics.rateLimit.remaining === 0 ? "exhausted" :
                  analytics.rateLimit.remaining <= 2 ? "low" : "ok"
                }`}>
                  {analytics.rateLimit.remaining}/{analytics.rateLimit.limit}
                </span>
              </div>
              {analytics.rateLimit.remaining === 0 && analytics.rateLimit.resetsAt && (
                <>
                  <div className="create-analytics-divider" />
                  <div className="create-analytics-item">
                    <span className="create-analytics-label">Resets</span>
                    <span className="create-analytics-value">{new Date(analytics.rateLimit.resetsAt).toLocaleTimeString()}</span>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Generate Button */}
          <button
            className="generate-btn"
            onClick={handleGenerate}
            disabled={!prompt.trim() || isGenerating || !artistId}
            type="button"
          >
            {isGenerating ? "Generating..." : "✨ Generate Track"}
          </button>

          {/* No Artist Profile Warning */}
          {!artistId && status === "authenticated" && (
            <div className="error-section" style={{ marginTop: "var(--space-4)" }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span>Set up an <Link href="/artist/onboarding?returnUrl=/create" style={{ color: "inherit", textDecoration: "underline" }}>artist profile</Link> to start generating.</span>
            </div>
          )}
        </div>

        {/* Progress */}
        {isGenerating && (
          <div className="progress-section">
            <div className="progress-phases">
              <div className={`progress-phase ${state === "submitting" || state === "queued" ? "active" : (["generating", "storing"].includes(state) ? "done" : "")}`}>
                <span className="progress-phase-dot" />
                Queuing
              </div>
              <div className={`progress-phase ${state === "generating" ? "active" : (state === "storing" ? "done" : "")}`}>
                <span className="progress-phase-dot" />
                Generating
              </div>
              <div className={`progress-phase ${state === "storing" ? "active" : ""}`}>
                <span className="progress-phase-dot" />
                Finalizing
              </div>
            </div>
            <div className="progress-bar-track">
              <div
                className={`progress-bar-fill ${state === "generating" ? "indeterminate" : ""}`}
                style={{ width: `${getProgressPercent()}%` }}
              />
            </div>
          </div>
        )}

        {/* Error */}
        {state === "failed" && error && (
          <div className="error-section">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
            </svg>
            <div>
              <p style={{ margin: 0 }}>{error}</p>
              <button
                className="result-action-btn"
                style={{ marginTop: "var(--space-3)" }}
                onClick={() => { reset(); handleGenerate(); }}
                type="button"
              >
                🔄 Try Again
              </button>
            </div>
          </div>
        )}

        {/* Result */}
        {state === "complete" && result && (
          <div className="result-section">
            <div className="result-header">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
              Track Generated
            </div>

            <div className="result-audio">
              <audio controls preload="metadata">
                <source src={getReleaseArtworkUrl(result.releaseId).replace("/artwork", `/tracks/${result.trackId}/stream`)} type="audio/wav" />
              </audio>
            </div>

            <div className="result-actions">
              <button className="result-action-btn" onClick={handleRegenerate} type="button">
                🔄 Regenerate
              </button>
              <button className="result-action-btn primary" onClick={handleSaveToLibrary} type="button">
                💾 Save to Library
              </button>
              <button className="result-action-btn" onClick={handleDownload} type="button">
                📥 Download
              </button>
              <button className="result-action-btn primary" onClick={handleSendToDemucs} type="button">
                🎛️ Send to Demucs
              </button>
              <button className="result-action-btn" onClick={reset} type="button">
                🗑️ Discard
              </button>
            </div>
          </div>
        )}
      </div>

          <DuplicatePublishWarningModal
            isOpen={isDuplicateWarningOpen}
            onConfirm={handleDuplicateWarningConfirm}
            onCancel={() => setIsDuplicateWarningOpen(false)}
          />

          <AICreationPublishModal
            isOpen={isPublishModalOpen}
            onClose={() => {
              setIsPublishModalOpen(false);
              setPublishActionQueue(null);
            }}
            onPublish={handlePublishConfirm}
            defaultTitle={prompt.trim().slice(0, 60) || "AI Generated Track"}
            defaultAudioUrl={getStreamUrl()}
            action={publishActionQueue ?? 'library'}
            userDisplayName={artistDisplayName}
            token={token ?? undefined}
          />
    </AuthGate>
  );
}
