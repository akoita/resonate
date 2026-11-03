"use client";

/**
 * Grid correction (#2539, Remix Studio Pro, S6c of #1903). When the measured
 * tempo or first downbeat is off, the artist taps the tempo and nudges the
 * downbeat by ear, then applies it. The correction is saved on the project;
 * the measured analysis stays as it was and "Use measured" returns to it.
 */
import { useState } from "react";
import type { RemixGridOverride, RemixSectionGrid } from "../../lib/api";
import {
  GRID_MAX_BPM,
  GRID_MIN_BPM,
  NUDGE_FINE_MS,
  addTap,
  formatBpm,
  formatSeconds,
  gridDraftChanged,
  gridDraftFrom,
  gridOverridePayload,
  nudgeFirstBeat,
  tapTempoBpm,
  type GridDraft,
} from "../../lib/remixGridCorrection";

const btn =
  "rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200 hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed";

export function RemixGridPanel({
  grid,
  disabled,
  disabledReason,
  saving,
  error,
  onApply,
}: {
  grid: RemixSectionGrid;
  disabled?: boolean;
  disabledReason?: string | null;
  saving?: boolean;
  error?: string | null;
  onApply(override: RemixGridOverride | null): void;
}) {
  const initial = gridDraftFrom(grid);
  const [draft, setDraft] = useState<GridDraft | null>(initial);
  const [bpmText, setBpmText] = useState(initial ? String(initial.tempoBpm) : "");
  const [taps, setTaps] = useState<number[]>([]);
  // Re-sync when the served grid changes (after Apply or Use measured).
  const [syncedFrom, setSyncedFrom] = useState(grid);
  if (syncedFrom !== grid) {
    setSyncedFrom(grid);
    const next = gridDraftFrom(grid);
    setDraft(next);
    setBpmText(next ? String(next.tempoBpm) : "");
    setTaps([]);
  }

  if (!draft) {
    return (
      <p className="text-xs text-zinc-500 remix-grid-panel">
        Grid: this source has no measured tempo, so there is no bar grid to correct.
      </p>
    );
  }

  const measured = grid.measured;
  const tapped = tapTempoBpm(taps);
  const setTempo = (bpm: number) => {
    setDraft({ ...draft, tempoBpm: bpm });
    setBpmText(String(bpm));
  };
  const nudge = (beats: number, ms: number) =>
    setDraft({ ...draft, firstBeatSec: nudgeFirstBeat(draft.firstBeatSec, draft.tempoBpm, beats, ms) });
  const payload = gridOverridePayload(draft);
  const changed = gridDraftChanged(grid, draft);
  const locked = disabled || saving;

  return (
    <div className="mt-3 rounded-md border border-zinc-800 bg-zinc-950/60 p-3 text-xs text-zinc-300 remix-grid-panel" role="group" aria-label="Grid correction">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-semibold text-zinc-100">Grid</span>
        <span>
          {formatBpm(grid.bpm ?? draft.tempoBpm)} · first downbeat {formatSeconds(grid.firstBeatSec ?? 0)}
          {grid.overridden ? " · corrected" : " · measured"}
        </span>
        {grid.overridden && measured?.bpm ? (
          <span className="text-zinc-500">
            measured {formatBpm(measured.bpm)} · {formatSeconds(measured.firstBeatSec ?? 0)}
          </span>
        ) : null}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1">
          <span>Tempo</span>
          <input
            type="number"
            inputMode="decimal"
            step={0.1}
            min={GRID_MIN_BPM}
            max={GRID_MAX_BPM}
            value={bpmText}
            disabled={locked}
            onChange={(e) => {
              setBpmText(e.target.value);
              const n = Number(e.target.value);
              if (Number.isFinite(n) && n > 0) setDraft({ ...draft, tempoBpm: n });
            }}
            className="w-20 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-zinc-100"
            aria-label="Tempo in BPM"
          />
          <span>BPM</span>
        </label>
        <button
          type="button"
          className={btn}
          disabled={locked}
          onClick={() => {
            const next = addTap(taps, performance.now());
            setTaps(next);
            const bpm = tapTempoBpm(next);
            if (bpm) setTempo(bpm);
          }}
          title="Tap along to the beat, at least four times"
        >
          Tap tempo
        </button>
        <span aria-live="polite" className="text-zinc-500">
          {taps.length === 0
            ? "Tap along while it plays"
            : tapped
              ? `Tapped ${formatBpm(tapped)}`
              : `${taps.length} tap${taps.length === 1 ? "" : "s"}…`}
        </span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span>First downbeat {formatSeconds(draft.firstBeatSec)}</span>
        <button type="button" className={btn} disabled={locked} onClick={() => nudge(-1, 0)}>−1 beat</button>
        <button type="button" className={btn} disabled={locked} onClick={() => nudge(0, -NUDGE_FINE_MS)}>−{NUDGE_FINE_MS} ms</button>
        <button type="button" className={btn} disabled={locked} onClick={() => nudge(0, NUDGE_FINE_MS)}>+{NUDGE_FINE_MS} ms</button>
        <button type="button" className={btn} disabled={locked} onClick={() => nudge(1, 0)}>+1 beat</button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="rounded-md border border-purple-400/60 bg-purple-600/70 px-3 py-1 text-xs font-semibold text-white hover:bg-purple-600 disabled:opacity-50 disabled:cursor-not-allowed"
          disabled={locked || !changed || !payload}
          onClick={() => payload && onApply(payload)}
        >
          {saving ? "Applying…" : "Apply grid"}
        </button>
        {grid.overridden && (
          <button type="button" className={btn} disabled={locked} onClick={() => onApply(null)}>
            Use measured
          </button>
        )}
        {changed && !locked && (
          <button
            type="button"
            className="border-0 bg-transparent text-xs text-zinc-400 hover:text-zinc-200"
            onClick={() => {
              setDraft(initial);
              setBpmText(initial ? String(initial.tempoBpm) : "");
              setTaps([]);
            }}
          >
            Undo changes
          </button>
        )}
      </div>
      <p className="mt-2 text-zinc-500">
        The beat maker, AI parts and song shape follow the applied grid, in the preview and in the render. A new tempo can
        change the sections: section edits that no longer fit play everywhere until you redo them.
      </p>
      {disabledReason && <p className="mt-1 text-zinc-500">{disabledReason}</p>}
      {!payload && <p className="mt-1 text-red-300">Tempo must be between {GRID_MIN_BPM} and {GRID_MAX_BPM} BPM.</p>}
      {error && <p className="mt-1 text-red-300" role="alert">{error}</p>}
    </div>
  );
}
