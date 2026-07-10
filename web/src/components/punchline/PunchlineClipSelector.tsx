"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { getStemPreviewUrl } from "../../lib/api";

/**
 * Reusable vocal-stem clip selector (#483).
 *
 * Renders a draggable [startMs, endMs] range over a timeline of the vocals
 * stem, validates the range against the server's clip-length bounds, and
 * previews *exactly* that range in the browser via an HTMLAudioElement seeked to
 * the selection. It is intentionally self-contained and controlled (value +
 * onChange) so #484's drop builder can compose it per moment.
 *
 * The pure helpers below (clamp/validate/format) are exported for direct unit
 * testing — the repo convention for this kind of component.
 */

/** Matches the backend's PUNCHLINE_CLIP_SOURCE_TOLERANCE_MS (#481). */
const SOURCE_TOLERANCE_MS = 50;

/** Keyboard nudge steps. */
const NUDGE_MS = 100;
const NUDGE_COARSE_MS = 1000;

export type ClipRange = {
  startMs: number;
  endMs: number;
};

export type ClipRangeValidation = {
  valid: boolean;
  reason?: string;
};

function clampInt(value: number, min: number, max: number): number {
  const n = Number.isFinite(value) ? Math.round(value) : min;
  return Math.min(max, Math.max(min, n));
}

/** Human "2s" / "2.5s" label for a bound expressed in ms. */
function formatBoundSeconds(ms: number): string {
  const seconds = ms / 1000;
  return Number.isInteger(seconds)
    ? `${seconds}s`
    : `${seconds.toFixed(1)}s`;
}

/**
 * Normalize a range into bounds: clamp both endpoints into [0, durationMs],
 * order them, cap the length to `maxMs`, and grow it to `minMs` when the stem is
 * long enough. Deterministic so drag/keyboard edits can never escape the rules.
 */
export function clampClipRange(
  range: ClipRange,
  durationMs: number,
  minMs: number,
  maxMs: number,
): ClipRange {
  const total = Math.max(0, Math.floor(durationMs));
  let start = clampInt(range.startMs, 0, total);
  let end = clampInt(range.endMs, 0, total);
  if (end < start) {
    const swap = start;
    start = end;
    end = swap;
  }

  // Cap to the max length, preferring to pull the end handle inward.
  if (maxMs > 0 && end - start > maxMs) {
    end = start + maxMs;
    if (end > total) {
      end = total;
      start = Math.max(0, end - maxMs);
    }
  }

  // Grow to the min length only when the stem can actually fit it.
  if (minMs > 0 && end - start < minMs && total >= minMs) {
    end = start + minMs;
    if (end > total) {
      end = total;
      start = Math.max(0, end - minMs);
    }
  }

  return { startMs: start, endMs: end };
}

/**
 * Validate a range the way the backend extractor (#481) and publish gate (#482)
 * do, so a selection the UI accepts is always publishable. Messages are written
 * for humans and name the actual bounds.
 */
export function validateClipRange(
  range: ClipRange,
  durationMs: number,
  minMs: number,
  maxMs: number,
): ClipRangeValidation {
  const { startMs, endMs } = range;
  if (
    !Number.isFinite(startMs) ||
    !Number.isFinite(endMs) ||
    startMs < 0 ||
    endMs <= startMs
  ) {
    return {
      valid: false,
      reason: "Selection start must come before the end.",
    };
  }

  const total = Math.floor(durationMs);
  if (endMs > total + SOURCE_TOLERANCE_MS) {
    return {
      valid: false,
      reason: "Selection extends past the end of the vocals.",
    };
  }

  const durationRange = `between ${formatBoundSeconds(minMs)} and ${formatBoundSeconds(maxMs)}`;
  const length = endMs - startMs;
  if (length < minMs) {
    return {
      valid: false,
      reason: `Clip is too short — clips must be ${durationRange}.`,
    };
  }
  if (length > maxMs) {
    return {
      valid: false,
      reason: `Clip is too long — clips must be ${durationRange}.`,
    };
  }

  return { valid: true };
}

/** `m:ss.t` display for a millisecond offset, e.g. 42500 → "0:42.5". */
export function formatClipTime(ms: number): string {
  const totalMs = Math.max(0, Math.round(ms));
  const totalSeconds = Math.floor(totalMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const tenths = Math.floor((totalMs % 1000) / 100);
  return `${minutes}:${String(seconds).padStart(2, "0")}.${tenths}`;
}

/** Compact duration badge, e.g. 6000 → "6.0s". */
export function formatClipDuration(ms: number): string {
  const seconds = Math.max(0, ms) / 1000;
  return `${seconds.toFixed(1)}s`;
}

export interface PunchlineClipSelectorProps {
  /** Vocals stem id — the preview source. */
  stemId: string;
  /** Vocal stem length (seconds). Must be a positive number. */
  durationSeconds: number;
  /** Minimum clip length (ms) — from the server's clipBoundsMs. */
  minMs: number;
  /** Maximum clip length (ms) — from the server's clipBoundsMs. */
  maxMs: number;
  /** Controlled range value. */
  value: ClipRange;
  /** Called with a bounds-clamped range on any edit. */
  onChange: (range: ClipRange) => void;
  /** Optional inline error surface for preview-load failures. */
  onPreviewError?: (message: string) => void;
}

type ActiveHandle = "start" | "end";

export function PunchlineClipSelector({
  stemId,
  durationSeconds,
  minMs,
  maxMs,
  value,
  onChange,
  onPreviewError,
}: PunchlineClipSelectorProps) {
  const durationMs = Math.max(0, Math.round(durationSeconds * 1000));
  const validation = validateClipRange(value, durationMs, minMs, maxMs);
  const lengthMs = value.endMs - value.startMs;

  const trackRef = useRef<HTMLDivElement>(null);
  const activeHandleRef = useRef<ActiveHandle | null>(null);

  // Keep the latest range in a ref so the audio timeupdate handler reads fresh
  // bounds without re-binding listeners (no restart on drag).
  const rangeRef = useRef<ClipRange>(value);
  useEffect(() => {
    rangeRef.current = value;
  }, [value]);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [playheadMs, setPlayheadMs] = useState<number | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const stopPreview = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      audioRef.current = null;
    }
    setPlaying(false);
    setPlayheadMs(null);
  }, []);

  // Stop and tear down playback on unmount or when the source stem changes.
  useEffect(() => {
    return () => stopPreview();
  }, [stemId, stopPreview]);

  const setStart = useCallback(
    (nextStartMs: number) => {
      onChange(
        clampClipRange(
          { startMs: nextStartMs, endMs: value.endMs },
          durationMs,
          minMs,
          maxMs,
        ),
      );
    },
    [onChange, value.endMs, durationMs, minMs, maxMs],
  );

  const setEnd = useCallback(
    (nextEndMs: number) => {
      onChange(
        clampClipRange(
          { startMs: value.startMs, endMs: nextEndMs },
          durationMs,
          minMs,
          maxMs,
        ),
      );
    },
    [onChange, value.startMs, durationMs, minMs, maxMs],
  );

  const msFromClientX = useCallback(
    (clientX: number): number => {
      const el = trackRef.current;
      if (!el) return 0;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0) return 0;
      const ratio = (clientX - rect.left) / rect.width;
      return clampInt(ratio * durationMs, 0, durationMs);
    },
    [durationMs],
  );

  const onHandlePointerDown =
    (handle: ActiveHandle) => (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      activeHandleRef.current = handle;
      event.currentTarget.setPointerCapture?.(event.pointerId);
    };

  const onHandlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!activeHandleRef.current) return;
    const ms = msFromClientX(event.clientX);
    if (activeHandleRef.current === "start") setStart(ms);
    else setEnd(ms);
  };

  const onHandlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!activeHandleRef.current) return;
    activeHandleRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  };

  const onHandleKeyDown =
    (handle: ActiveHandle) => (event: React.KeyboardEvent<HTMLDivElement>) => {
      const step = event.shiftKey ? NUDGE_COARSE_MS : NUDGE_MS;
      let delta = 0;
      if (event.key === "ArrowRight" || event.key === "ArrowUp") delta = step;
      else if (event.key === "ArrowLeft" || event.key === "ArrowDown")
        delta = -step;
      else return;
      event.preventDefault();
      if (handle === "start") setStart(value.startMs + delta);
      else setEnd(value.endMs + delta);
    };

  const startPreview = useCallback(() => {
    if (!validation.valid) return;
    // Always start from a clean element so the seek + range window is exact.
    stopPreview();
    setPreviewError(null);

    const audio = new Audio(getStemPreviewUrl(stemId));
    audio.preload = "auto";
    audioRef.current = audio;

    const seekToStart = () => {
      audio.currentTime = rangeRef.current.startMs / 1000;
    };
    audio.addEventListener("loadedmetadata", seekToStart);

    const handleTimeUpdate = () => {
      const currentMs = audio.currentTime * 1000;
      setPlayheadMs(currentMs);
      if (currentMs >= rangeRef.current.endMs) {
        stopPreview();
      }
    };
    audio.addEventListener("timeupdate", handleTimeUpdate);
    audio.addEventListener("ended", stopPreview);

    const handleError = () => {
      const message = "Could not load the vocal preview. Please try again.";
      setPreviewError(message);
      onPreviewError?.(message);
      stopPreview();
    };
    audio.addEventListener("error", handleError);

    seekToStart();
    audio
      .play()
      .then(() => setPlaying(true))
      .catch(() => handleError());
  }, [validation.valid, stopPreview, stemId, onPreviewError]);

  const total = Math.max(1, durationMs);
  const pct = (ms: number) =>
    Math.min(100, Math.max(0, (ms / total) * 100));

  const startPct = pct(value.startMs);
  const endPct = pct(value.endMs);

  return (
    <div className="punchline-clip-selector">
      <div className="punchline-clip-readout">
        <div className="punchline-clip-times">
          <span className="punchline-clip-time-label">Start</span>
          <span className="punchline-clip-time-value">
            {formatClipTime(value.startMs)}
          </span>
          <span className="punchline-clip-arrow" aria-hidden="true">
            →
          </span>
          <span className="punchline-clip-time-label">End</span>
          <span className="punchline-clip-time-value">
            {formatClipTime(value.endMs)}
          </span>
        </div>
        <span
          className={`punchline-clip-duration-badge ${
            validation.valid ? "is-valid" : "is-invalid"
          }`}
        >
          {formatClipDuration(Math.max(0, lengthMs))}
        </span>
      </div>

      <div
        className="punchline-clip-track"
        ref={trackRef}
        role="group"
        aria-label="Clip range on the vocals stem"
      >
        <div
          className="punchline-clip-band"
          style={{ left: `${startPct}%`, width: `${Math.max(0, endPct - startPct)}%` }}
        />

        {playing && playheadMs != null && (
          <div
            className="punchline-clip-playhead"
            style={{ left: `${pct(playheadMs)}%` }}
            aria-hidden="true"
          />
        )}

        <div
          className="punchline-clip-handle punchline-clip-handle-start"
          style={{ left: `${startPct}%` }}
          role="slider"
          tabIndex={0}
          aria-label="Clip start"
          aria-valuemin={0}
          aria-valuemax={durationMs}
          aria-valuenow={value.startMs}
          aria-valuetext={formatClipTime(value.startMs)}
          onPointerDown={onHandlePointerDown("start")}
          onPointerMove={onHandlePointerMove}
          onPointerUp={onHandlePointerUp}
          onKeyDown={onHandleKeyDown("start")}
        >
          <span className="punchline-clip-knob" aria-hidden="true" />
        </div>

        <div
          className="punchline-clip-handle punchline-clip-handle-end"
          style={{ left: `${endPct}%` }}
          role="slider"
          tabIndex={0}
          aria-label="Clip end"
          aria-valuemin={0}
          aria-valuemax={durationMs}
          aria-valuenow={value.endMs}
          aria-valuetext={formatClipTime(value.endMs)}
          onPointerDown={onHandlePointerDown("end")}
          onPointerMove={onHandlePointerMove}
          onPointerUp={onHandlePointerUp}
          onKeyDown={onHandleKeyDown("end")}
        >
          <span className="punchline-clip-knob" aria-hidden="true" />
        </div>
      </div>

      <div className="punchline-clip-steppers">
        <div className="punchline-clip-stepper">
          <span className="punchline-clip-stepper-label">Start</span>
          <button
            type="button"
            className="punchline-clip-step-btn"
            aria-label="Move start earlier"
            onClick={() => setStart(value.startMs - NUDGE_MS)}
          >
            −
          </button>
          <button
            type="button"
            className="punchline-clip-step-btn"
            aria-label="Move start later"
            onClick={() => setStart(value.startMs + NUDGE_MS)}
          >
            +
          </button>
        </div>
        <div className="punchline-clip-stepper">
          <span className="punchline-clip-stepper-label">End</span>
          <button
            type="button"
            className="punchline-clip-step-btn"
            aria-label="Move end earlier"
            onClick={() => setEnd(value.endMs - NUDGE_MS)}
          >
            −
          </button>
          <button
            type="button"
            className="punchline-clip-step-btn"
            aria-label="Move end later"
            onClick={() => setEnd(value.endMs + NUDGE_MS)}
          >
            +
          </button>
        </div>
      </div>

      {!validation.valid && validation.reason && (
        <p className="punchline-clip-validation" role="alert">
          {validation.reason}
        </p>
      )}

      <div className="punchline-clip-preview-row">
        <button
          type="button"
          className="punchline-clip-preview-btn"
          onClick={playing ? stopPreview : startPreview}
          aria-disabled={!validation.valid && !playing}
          disabled={!validation.valid && !playing}
          title={
            !validation.valid && !playing
              ? validation.reason
              : "Preview the selected range"
          }
        >
          {playing ? "■ Stop" : "▶ Preview range"}
        </button>
        {!validation.valid && !playing && (
          <span className="punchline-clip-preview-hint">
            Fix the selection to preview.
          </span>
        )}
        {previewError && (
          <span className="punchline-clip-preview-error" role="alert">
            {previewError}
          </span>
        )}
      </div>
    </div>
  );
}

export default PunchlineClipSelector;
