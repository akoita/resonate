"use client";

/**
 * Cue and loop points (#2540, Remix Studio Pro, S6d of #1903). The artist
 * marks an intro and an outro loop in whole bars of the grid, loops either
 * one in the preview, and exports a DJ extended version: each loop played
 * more times right after itself, plus a sidecar with the beat grid and cues.
 */
import { useState } from "react";
import type { RemixCueLoop, RemixCues } from "../../lib/api";
import {
  CUE_LOOP_BAR_CHOICES,
  CUE_MAX_REPEATS,
  CUE_MIN_REPEATS,
  REMIX_CUES_SCHEMA_VERSION,
  cueAddedSeconds,
  cueBarsLabel,
  cueLoopSpan,
  cuesPayload,
  cuesProblems,
  lastLoopStartBar,
  sameCues,
  suggestedCues,
  type CueName,
  type CueSpan,
} from "../../lib/remixCues";

const btn =
  "rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200 hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed";
const field = "rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-100";

const EMPTY: RemixCues = { schemaVersion: REMIX_CUES_SCHEMA_VERSION, intro: null, outro: null };
const NAMES: Record<CueName, string> = { intro: "Intro", outro: "Outro" };

function seconds(sec: number): string {
  return `${sec.toFixed(1)} s`;
}

export function RemixCuesPanel({
  saved,
  downbeats,
  barSec,
  endSec,
  disabled,
  disabledReason,
  saving,
  error,
  looping,
  onSave,
  onLoop,
  dj,
}: {
  saved: RemixCues | null;
  /** Timeline downbeats (`timelineDownbeats`). */
  downbeats: number[];
  barSec: number;
  /** Timeline end, seconds. */
  endSec: number;
  disabled?: boolean;
  disabledReason?: string | null;
  saving?: boolean;
  error?: string | null;
  /** The cue loop playing in the preview, if any. */
  looping: CueName | null;
  onSave(cues: RemixCues | null): void;
  /** Loop a cue in the preview (null span stops it). */
  onLoop(name: CueName, span: CueSpan | null): void;
  dj: { enabled: boolean; reason: string | null; busy: boolean; onExport(): void };
}) {
  const [draft, setDraft] = useState<RemixCues>(saved ?? EMPTY);
  const [syncedFrom, setSyncedFrom] = useState(saved);
  if (syncedFrom !== saved) {
    setSyncedFrom(saved);
    setDraft(saved ?? EMPTY);
  }

  if (downbeats.length < 2) {
    return (
      <p className="mt-3 text-xs text-zinc-500 remix-cues-panel">
        Cues: this source has no bar grid, so there are no bars to mark.
      </p>
    );
  }

  const suggestion = suggestedCues(downbeats, barSec, endSec);
  const problems = cuesProblems(draft, downbeats, barSec, endSec);
  const changed = !sameCues(draft, saved);
  const locked = disabled || saving;
  const setLoop = (name: CueName, loop: RemixCueLoop | null) => setDraft({ ...draft, [name]: loop });

  const loopRow = (name: CueName) => {
    const loop = draft[name];
    const span = loop ? cueLoopSpan(downbeats, barSec, endSec, loop) : null;
    const maxStart = loop ? lastLoopStartBar(downbeats, barSec, endSec, loop.bars) : -1;
    const label = NAMES[name];
    return (
      <div className="mt-2 flex flex-wrap items-center gap-2" role="group" aria-label={`${label} loop`}>
        <label className="flex min-w-[5.5rem] items-center gap-1 font-medium text-zinc-100">
          <input
            type="checkbox"
            checked={loop !== null}
            disabled={locked}
            onChange={(e) =>
              setLoop(
                name,
                e.target.checked
                  ? (suggestion?.[name] ?? {
                      startBar: name === "intro" ? 0 : Math.max(0, lastLoopStartBar(downbeats, barSec, endSec, 1)),
                      bars: 1,
                      repeats: 2,
                    })
                  : null,
              )
            }
          />
          {label}
        </label>
        {loop ? (
          <>
            <label className="flex items-center gap-1">
              <span>from bar</span>
              <input
                type="number"
                min={1}
                max={Math.max(1, maxStart + 1)}
                step={1}
                value={loop.startBar + 1}
                disabled={locked}
                onChange={(e) => {
                  const n = Math.round(Number(e.target.value));
                  if (Number.isFinite(n) && n >= 1) setLoop(name, { ...loop, startBar: n - 1 });
                }}
                className={`${field} w-16`}
                aria-label={`${label} loop start bar`}
              />
            </label>
            <label className="flex items-center gap-1">
              <span>for</span>
              <select
                value={loop.bars}
                disabled={locked}
                onChange={(e) => setLoop(name, { ...loop, bars: Number(e.target.value) })}
                className={field}
                aria-label={`${label} loop length`}
              >
                {CUE_LOOP_BAR_CHOICES.map((bars) => (
                  <option key={bars} value={bars}>
                    {bars} bar{bars === 1 ? "" : "s"}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1">
              <span>DJ version plays it</span>
              <select
                value={loop.repeats}
                disabled={locked}
                onChange={(e) => setLoop(name, { ...loop, repeats: Number(e.target.value) })}
                className={field}
                aria-label={`${label} loop extra plays`}
              >
                {Array.from({ length: CUE_MAX_REPEATS - CUE_MIN_REPEATS + 1 }, (_, i) => i + CUE_MIN_REPEATS).map((n) => (
                  <option key={n} value={n}>
                    {n} more time{n === 1 ? "" : "s"}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className={btn}
              aria-pressed={looping === name}
              disabled={!span}
              onClick={() => onLoop(name, looping === name ? null : span)}
            >
              {looping === name ? "Stop loop" : "Loop"}
            </button>
            <span className="text-zinc-500">
              {span
                ? `${cueBarsLabel(loop)} · ${seconds(span.endSec - span.startSec)} · adds ${seconds(cueAddedSeconds(span, loop.repeats))}`
                : cueBarsLabel(loop)}
            </span>
          </>
        ) : (
          <span className="text-zinc-500">Off</span>
        )}
      </div>
    );
  };

  return (
    <div
      className="mt-3 rounded-md border border-zinc-800 bg-zinc-950/60 p-3 text-xs text-zinc-300 remix-cues-panel"
      role="group"
      aria-label="Cue and loop points"
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-semibold text-zinc-100">Cues</span>
        <span className="text-zinc-500">Mark an intro and an outro in whole bars, then loop them or export a DJ version.</span>
      </div>
      {loopRow("intro")}
      {loopRow("outro")}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="rounded-md border border-purple-400/60 bg-purple-600/70 px-3 py-1 text-xs font-semibold text-white hover:bg-purple-600 disabled:opacity-50 disabled:cursor-not-allowed"
          disabled={locked || !changed || problems.length > 0}
          onClick={() => onSave(cuesPayload(draft))}
        >
          {saving ? "Saving…" : "Save cues"}
        </button>
        {changed && !locked && (
          <button
            type="button"
            className="border-0 bg-transparent text-xs text-zinc-400 hover:text-zinc-200"
            onClick={() => setDraft(saved ?? EMPTY)}
          >
            Undo changes
          </button>
        )}
        <span className="mx-1 h-4 w-px bg-zinc-800" aria-hidden />
        <button
          type="button"
          className={btn}
          disabled={!dj.enabled || dj.busy || changed}
          aria-busy={dj.busy || undefined}
          onClick={dj.onExport}
        >
          {dj.busy ? "Exporting…" : "Export DJ version"}
        </button>
      </div>
      <p className="mt-2 text-zinc-500">
        The DJ version is your current draft with each loop played again right after itself, so the bars stay even. It downloads
        as a zip: the MP3 and a .cues.json file with the beat grid and the cues.
      </p>
      {changed && <p className="mt-1 text-zinc-500">Save the cues before exporting.</p>}
      {!changed && dj.reason && <p className="mt-1 text-zinc-500">{dj.reason}</p>}
      {disabledReason && <p className="mt-1 text-zinc-500">{disabledReason}</p>}
      {problems.map((problem) => (
        <p key={problem} className="mt-1 text-red-300">
          {problem}
        </p>
      ))}
      {error && (
        <p className="mt-1 text-red-300" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
