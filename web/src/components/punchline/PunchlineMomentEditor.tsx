"use client";

import React, { useMemo, useState } from "react";
import type { PunchlineMomentInput } from "../../lib/api";
import {
  clampClipRange,
  formatClipDuration,
  formatClipTime,
  PunchlineClipSelector,
  type ClipRange,
} from "./PunchlineClipSelector";
import { PunchlineCollectibleCard } from "./PunchlineCollectibleCard";
import {
  centsToPriceDollars,
  MOMENT_LYRIC_MAX,
  MOMENT_TITLE_MAX,
  parsePriceDollarsToCents,
  validateMomentInput,
  type MomentFieldKey,
} from "./punchlineDropHelpers";

export interface PunchlineMomentEditorInitial {
  title?: string;
  lyricText?: string;
  artworkUrl?: string | null;
  editionSize?: number;
  priceCents?: number;
  startMs?: number;
  endMs?: number;
}

export interface PunchlineMomentEditorProps {
  mode: "add" | "edit";
  stemId: string;
  durationSeconds: number;
  minMs: number;
  maxMs: number;
  rightsLabel: string;
  initial?: PunchlineMomentEditorInitial;
  saving: boolean;
  /** Server-side 400 message (e.g. a rejected range), surfaced inline. */
  serverError?: string | null;
  onSave: (input: PunchlineMomentInput) => void;
  onCancel: () => void;
  onPreviewError?: (message: string) => void;
}

function seedRange(
  initial: PunchlineMomentEditorInitial | undefined,
  durationMs: number,
  minMs: number,
  maxMs: number,
): ClipRange {
  if (initial?.startMs != null && initial?.endMs != null) {
    return clampClipRange(
      { startMs: initial.startMs, endMs: initial.endMs },
      durationMs,
      minMs,
      maxMs,
    );
  }
  return clampClipRange(
    { startMs: 0, endMs: Math.min(maxMs, durationMs) },
    durationMs,
    minMs,
    maxMs,
  );
}

export function PunchlineMomentEditor({
  mode,
  stemId,
  durationSeconds,
  minMs,
  maxMs,
  rightsLabel,
  initial,
  saving,
  serverError,
  onSave,
  onCancel,
  onPreviewError,
}: PunchlineMomentEditorProps) {
  const durationMs = Math.max(0, Math.round(durationSeconds * 1000));

  const [title, setTitle] = useState(initial?.title ?? "");
  const [lyricText, setLyricText] = useState(initial?.lyricText ?? "");
  const [artworkUrl, setArtworkUrl] = useState(initial?.artworkUrl ?? "");
  const [editionSize, setEditionSize] = useState(
    initial?.editionSize != null ? String(initial.editionSize) : "100",
  );
  const [priceDollars, setPriceDollars] = useState(
    initial?.priceCents != null ? centsToPriceDollars(initial.priceCents) : "",
  );
  const [range, setRange] = useState<ClipRange>(() =>
    seedRange(initial, durationMs, minMs, maxMs),
  );
  const [errors, setErrors] = useState<Partial<Record<MomentFieldKey, string>>>(
    {},
  );

  // Live price for the preview card (fallback to 0 while the field is empty).
  const previewPriceCents = useMemo(() => {
    const parsed = parsePriceDollarsToCents(priceDollars);
    return parsed.ok ? parsed.cents : 0;
  }, [priceDollars]);

  const handleSave = () => {
    const result = validateMomentInput(
      {
        title,
        lyricText,
        artworkUrl,
        editionSize,
        priceDollars,
        startMs: range.startMs,
        endMs: range.endMs,
      },
      { minMs, maxMs },
    );
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    onSave(result.value);
  };

  return (
    <div className="punchline-editor">
      <div className="punchline-editor-grid">
        <div className="punchline-editor-fields">
          <div className="punchline-field">
            <label htmlFor="punchline-moment-title">Moment title</label>
            <input
              id="punchline-moment-title"
              type="text"
              value={title}
              maxLength={MOMENT_TITLE_MAX}
              placeholder="e.g. The line everybody rewinds"
              onChange={(e) => setTitle(e.target.value)}
            />
            <div className="punchline-field-row">
              {errors.title ? (
                <span className="punchline-field-error" role="alert">
                  {errors.title}
                </span>
              ) : (
                <span className="punchline-field-hint" />
              )}
              <span className="punchline-field-counter">
                {title.trim().length}/{MOMENT_TITLE_MAX}
              </span>
            </div>
          </div>

          <div className="punchline-field">
            <label htmlFor="punchline-moment-lyric">Lyric</label>
            <textarea
              id="punchline-moment-lyric"
              value={lyricText}
              rows={2}
              maxLength={MOMENT_LYRIC_MAX}
              placeholder="The exact words in this moment"
              onChange={(e) => setLyricText(e.target.value)}
            />
            <div className="punchline-field-row">
              {errors.lyricText ? (
                <span className="punchline-field-error" role="alert">
                  {errors.lyricText}
                </span>
              ) : (
                <span className="punchline-field-hint" />
              )}
              <span className="punchline-field-counter">
                {lyricText.trim().length}/{MOMENT_LYRIC_MAX}
              </span>
            </div>
          </div>

          <div className="punchline-field">
            <label htmlFor="punchline-moment-artwork">
              Artwork link <span className="punchline-field-optional">(optional)</span>
            </label>
            <input
              id="punchline-moment-artwork"
              type="url"
              value={artworkUrl}
              placeholder="https://… or ipfs://…"
              onChange={(e) => setArtworkUrl(e.target.value)}
            />
            {errors.artworkUrl && (
              <span className="punchline-field-error" role="alert">
                {errors.artworkUrl}
              </span>
            )}
          </div>

          <div className="punchline-field-pair">
            <div className="punchline-field">
              <label htmlFor="punchline-moment-edition">
                Editions <span className="punchline-field-optional">(limited edition)</span>
              </label>
              <input
                id="punchline-moment-edition"
                type="number"
                min={1}
                max={10000}
                value={editionSize}
                onChange={(e) => setEditionSize(e.target.value)}
              />
              {errors.editionSize && (
                <span className="punchline-field-error" role="alert">
                  {errors.editionSize}
                </span>
              )}
            </div>

            <div className="punchline-field">
              <label htmlFor="punchline-moment-price">Price (USD)</label>
              <input
                id="punchline-moment-price"
                type="text"
                inputMode="decimal"
                value={priceDollars}
                placeholder="0 for free"
                onChange={(e) => setPriceDollars(e.target.value)}
              />
              {errors.price && (
                <span className="punchline-field-error" role="alert">
                  {errors.price}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="punchline-editor-preview">
          <span className="punchline-editor-preview-label">Card preview</span>
          <PunchlineCollectibleCard
            title={title}
            lyricText={lyricText}
            artworkUrl={artworkUrl.trim() || null}
            durationMs={range.endMs - range.startMs}
            editionSize={
              /^\d+$/.test(editionSize.trim())
                ? Number.parseInt(editionSize.trim(), 10)
                : 0
            }
            priceCents={previewPriceCents}
            rightsLabel={rightsLabel}
          />
        </div>
      </div>

      <div className="punchline-editor-clip">
        <span className="punchline-editor-clip-label">Clip range</span>
        <PunchlineClipSelector
          stemId={stemId}
          durationSeconds={durationSeconds}
          minMs={minMs}
          maxMs={maxMs}
          value={range}
          onChange={setRange}
          onPreviewError={onPreviewError}
        />
        <div className="punchline-selection-summary">
          Selected: {formatClipTime(range.startMs)} → {formatClipTime(range.endMs)}{" "}
          · {formatClipDuration(range.endMs - range.startMs)}
        </div>
        {errors.range && (
          <span className="punchline-field-error" role="alert">
            {errors.range}
          </span>
        )}
      </div>

      {serverError && (
        <p className="punchline-error" role="alert">
          {serverError}
        </p>
      )}

      <div className="punchline-editor-actions">
        <button
          type="button"
          className="punchline-btn-secondary"
          onClick={onCancel}
          disabled={saving}
        >
          Cancel
        </button>
        <button
          type="button"
          className="punchline-btn-primary"
          onClick={handleSave}
          disabled={saving}
          aria-disabled={saving}
        >
          {saving
            ? "Saving…"
            : mode === "add"
              ? "Add moment"
              : "Save moment"}
        </button>
      </div>
    </div>
  );
}

export default PunchlineMomentEditor;
