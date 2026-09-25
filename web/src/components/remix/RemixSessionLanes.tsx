"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { MouseEvent, PointerEvent } from "react";
import type { RemixSectionGrid } from "../../lib/api";
import {
  sectionGridSummaryLabel,
  sectionStartLabel,
} from "../../lib/remixArrangement";
import { clampGainDb, GAIN_DB_MAX, GAIN_DB_MIN } from "../../lib/remixGain";
import {
  formatFxAmount,
  formatFxTone,
  REMIX_FX_STEM_RANGES,
  type RemixFxStem,
} from "../../lib/remixFx";

/**
 * Session view for the Remix Studio (#1879): one row per stem — a channel
 * strip (mute / solo / gain) next to a time-proportional lane showing the
 * stem's waveform, its section on/off cells, a section ruler, and a playhead.
 * Purely presentational: every edit is reported through callbacks, and the
 * playhead polls `getPositionSec` itself so the parent never re-renders per
 * animation frame.
 */

export type LaneStem = {
  stemId: string;
  name: string;
  type: string;
  muted: boolean;
  soloed: boolean;
  soloedOut: boolean;
  gainDb: number | null;
  /** Per-section on/off mask; null = every section on. */
  sections: boolean[] | null;
  /** 0..1 amplitude buckets across the whole stem; null = still loading. */
  peaks: number[] | null;
  /** Per-stem effects (#1897); absent = defaults. */
  fx?: RemixFxStem;
};

export type RemixSessionLanesProps = {
  stems: LaneStem[];
  /** null → lanes show the waveform only, no cells and no section ruler. */
  grid: RemixSectionGrid | null;
  /** Timeline length; falls back to grid.durationSeconds. */
  durationSec: number | null;
  /** Polled once per animation frame by the playhead only. */
  getPositionSec: () => number | null;
  playing: boolean;
  loopSectionIndex: number | null;
  /** Saving / published → no edits (solo, loop and seek stay available). */
  disabled: boolean;
  onToggleMute(stemId: string): void;
  onToggleSolo(stemId: string): void;
  onGainChange(stemId: string, gainDb: number): void;
  /** Receives null when the resulting mask is all-on. */
  onSetSections(stemId: string, sections: boolean[] | null): void;
  onSeek(sec: number): void;
  onLoopSection(index: number | null): void;
  /** Per-stem effects edits (#1897); absent = no FX toggle. */
  onFxChange?(stemId: string, key: keyof RemixFxStem, value: number): void;
};

type LaneFxControl = {
  key: keyof RemixFxStem;
  label: string;
  low: string;
  high: string;
  format(value: number): string;
  /** Compact label for the narrow channel strip. */
  short(value: number): string;
};

/** Tone in one word for the strip; the full label is the valuetext. */
function toneWord(tone: number): string {
  const label = formatFxTone(tone);
  return label.split(" ")[0];
}

/** Per-stem effect controls, in plain language (#1897). */
export const LANE_FX_CONTROLS: readonly LaneFxControl[] = [
  { key: "space", label: "Space", low: "Dry", high: "Roomy", format: formatFxAmount, short: formatFxAmount },
  { key: "echo", label: "Echo", low: "None", high: "Lots", format: formatFxAmount, short: formatFxAmount },
  { key: "tone", label: "Tone", low: "Darker", high: "Brighter", format: formatFxTone, short: toneWord },
];

/** Whether a stem has any non-default effect (the FX button's dot). */
export function laneHasFx(fx: RemixFxStem | undefined): boolean {
  if (!fx) return false;
  return LANE_FX_CONTROLS.some(
    (control) =>
      (fx[control.key] ?? REMIX_FX_STEM_RANGES[control.key].default) !==
      REMIX_FX_STEM_RANGES[control.key].default,
  );
}

/** Minimum on-screen width of one section column, in CSS pixels. */
export const LANE_MIN_SECTION_PX = 28;

/** A leading section shorter than this share of a full section is a pickup. */
const PICKUP_THRESHOLD = 0.75;

const BARS_PER_SECTION = 8;

/**
 * Ruler labels for each section column. Bar grids count bars from the first
 * full 8-bar section (a short leading section is the "Pickup"); time grids
 * label each column with its start time.
 */
export function sectionColumnLabels(grid: RemixSectionGrid): string[] {
  if (grid.kind !== "bars") {
    return grid.sections.map((interval) => sectionStartLabel(interval));
  }
  const first = grid.sections[0];
  const hasPickup =
    first !== undefined &&
    first.endSec - first.startSec < PICKUP_THRESHOLD * grid.sectionSeconds;
  const firstFullIndex = hasPickup ? 1 : 0;
  return grid.sections.map((_, index) =>
    index < firstFullIndex
      ? "Pickup"
      : String(1 + BARS_PER_SECTION * (index - firstFullIndex)),
  );
}

/**
 * Closed SVG path for a waveform mirrored around the horizontal center line.
 * Peaks are clamped to 0..1; an empty list yields an empty path.
 */
export function peaksToSvgPath(
  peaks: readonly number[],
  width: number,
  height: number,
): string {
  if (peaks.length === 0 || width <= 0 || height <= 0) return "";
  const mid = height / 2;
  const step = width / peaks.length;
  const round = (value: number) => Math.round(value * 100) / 100;
  const amplitude = peaks.map((peak) =>
    Number.isFinite(peak) ? Math.min(1, Math.max(0, peak)) * mid : 0,
  );
  const xs = amplitude.map((_, index) => round((index + 0.5) * step));
  const top = amplitude.map(
    (amp, index) => `L${xs[index]} ${round(mid - amp)}`,
  );
  const bottom = amplitude
    .map((amp, index) => `L${xs[index]} ${round(mid + amp)}`)
    .reverse();
  return [
    `M0 ${round(mid)}`,
    ...top,
    `L${round(width)} ${round(mid)}`,
    ...bottom,
    "Z",
  ].join(" ");
}

/** Normalized working mask: a copy of `sections`, or all-on when absent/stale. */
export function sectionMask(
  sections: boolean[] | null,
  count: number,
): boolean[] {
  return sections && sections.length === count
    ? [...sections]
    : new Array<boolean>(count).fill(true);
}

/** Persisted form of a mask: null when every section is on. */
export function normalizeSections(mask: boolean[]): boolean[] | null {
  return mask.every(Boolean) ? null : [...mask];
}

/** Set one section of a stem's mask; returns the normalized result. */
export function applyPaint(
  sections: boolean[] | null,
  count: number,
  index: number,
  value: boolean,
): boolean[] | null {
  const mask = sectionMask(sections, count);
  if (index >= 0 && index < count) mask[index] = value;
  return normalizeSections(mask);
}

/** Timeline length: the explicit duration, else the grid's, else unknown. */
export function timelineSeconds(
  durationSec: number | null,
  grid: RemixSectionGrid | null,
): number | null {
  for (const candidate of [durationSec, grid?.durationSeconds ?? null]) {
    if (candidate !== null && Number.isFinite(candidate) && candidate > 0) {
      return candidate;
    }
  }
  return null;
}

function formatGainDb(gainDb: number): string {
  return `${gainDb > 0 ? "+" : ""}${gainDb.toFixed(1)} dB`;
}

function fractionOf(sec: number, totalSec: number): number {
  if (!Number.isFinite(sec) || totalSec <= 0) return 0;
  return Math.min(1, Math.max(0, sec / totalSec));
}

function percent(sec: number, totalSec: number): string {
  return `${fractionOf(sec, totalSec) * 100}%`;
}

/** Hatching for OFF cells so they read as "cut", not just darker. */
const OFF_CELL_STYLE = {
  backgroundImage:
    "repeating-linear-gradient(135deg, rgba(161, 161, 170, 0.16) 0 2px, transparent 2px 7px)",
};

/** Channel-strip width; the playhead overlay offsets by the same amount. */
const STRIP_WIDTH = "w-40 sm:w-60";
const STRIP_OFFSET = "left-40 sm:left-60";

type PaintState = { stemId: string; value: boolean; mask: boolean[] };

export function RemixSessionLanes({
  stems,
  grid,
  durationSec,
  getPositionSec,
  playing,
  loopSectionIndex,
  disabled,
  onToggleMute,
  onToggleSolo,
  onGainChange,
  onSetSections,
  onSeek,
  onLoopSection,
  onFxChange,
}: RemixSessionLanesProps) {
  const fxIdPrefix = useId();
  // Which stems show their FX row: view state only, never saved.
  const [openFx, setOpenFx] = useState<ReadonlySet<string>>(() => new Set());
  const toggleFx = (stemId: string) =>
    setOpenFx((open) => toggleInSet(open, stemId));
  const totalSec = timelineSeconds(durationSec, grid);
  const sectionCount = grid?.sections.length ?? 0;
  const labels = grid ? sectionColumnLabels(grid) : [];
  const timelineStyle =
    grid && sectionCount > 0
      ? { minWidth: `${sectionCount * LANE_MIN_SECTION_PX}px` }
      : undefined;
  const loopInterval =
    grid && loopSectionIndex !== null
      ? (grid.sections[loopSectionIndex] ?? null)
      : null;

  // Drag-to-paint state lives in refs: it only matters inside event handlers.
  const paintRef = useRef<PaintState | null>(null);
  const suppressClickRef = useRef(false);

  useEffect(() => {
    const end = () => {
      if (!paintRef.current) return;
      paintRef.current = null;
      // The click that follows this pointerup was already applied on
      // pointerdown; release the guard once that click has been dispatched.
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
    };
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    window.addEventListener("blur", end);
    return () => {
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      window.removeEventListener("blur", end);
    };
  }, []);

  const seekFromClick = (event: MouseEvent<HTMLElement>) => {
    if (totalSec === null) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    const fraction = Math.min(
      1,
      Math.max(0, (event.clientX - rect.left) / rect.width),
    );
    onSeek(fraction * totalSec);
  };

  const handleCellPointerDown = (
    event: PointerEvent<HTMLButtonElement>,
    stem: LaneStem,
    index: number,
  ) => {
    // Touch keeps native horizontal scrolling; a tap still toggles via click.
    if (disabled || !grid || event.pointerType === "touch") return;
    if (event.button !== 0) return;
    const target = event.currentTarget;
    if (target.hasPointerCapture?.(event.pointerId)) {
      target.releasePointerCapture(event.pointerId);
    }
    const mask = sectionMask(stem.sections, sectionCount);
    const value = !mask[index];
    mask[index] = value;
    paintRef.current = { stemId: stem.stemId, value, mask };
    suppressClickRef.current = true;
    onSetSections(stem.stemId, normalizeSections(mask));
  };

  const handleCellPointerEnter = (
    event: PointerEvent<HTMLButtonElement>,
    stemId: string,
    index: number,
  ) => {
    const paint = paintRef.current;
    if (!paint || paint.stemId !== stemId) return;
    if ((event.buttons & 1) === 0) {
      // The button was released outside the window; stop painting.
      paintRef.current = null;
      suppressClickRef.current = false;
      return;
    }
    if (paint.mask[index] === paint.value) return;
    paint.mask[index] = paint.value;
    onSetSections(stemId, normalizeSections(paint.mask));
  };

  const handleCellClick = (
    event: MouseEvent<HTMLButtonElement>,
    stem: LaneStem,
    index: number,
  ) => {
    event.stopPropagation();
    if (suppressClickRef.current) return;
    if (disabled || !grid) return;
    const current = sectionMask(stem.sections, sectionCount);
    onSetSections(
      stem.stemId,
      applyPaint(stem.sections, sectionCount, index, !current[index]),
    );
  };

  return (
    <div className="remix-session-lanes overflow-x-auto rounded-md border border-zinc-800 bg-zinc-950">
      <div className="relative min-w-full w-max">
        {grid && (
          <div className="flex remix-lane-ruler">
            <div
              className={`sticky left-0 z-20 ${STRIP_WIDTH} shrink-0 bg-zinc-900 border-r border-zinc-800 px-2 py-1 flex items-end`}
            >
              <span
                className="text-[10px] uppercase tracking-wide leading-tight text-zinc-500"
                title={sectionGridSummaryLabel(grid)}
              >
                {grid.kind === "bars" ? "Bar · click to loop" : "Time · click to loop"}
              </span>
            </div>
            <div className="relative flex-1 bg-zinc-900" style={timelineStyle}>
              <div className="relative h-6">
                {grid.sections.map((interval, index) => {
                  const looped = loopSectionIndex === index;
                  const span = totalSec
                    ? interval.endSec - interval.startSec
                    : 0;
                  return (
                    <button
                      key={index}
                      type="button"
                      aria-pressed={looped}
                      aria-label={`Loop section ${index + 1} (starts ${sectionStartLabel(interval)})`}
                      title={`Section ${index + 1} · starts ${sectionStartLabel(interval)} · click to loop`}
                      className={`remix-lane-section-header absolute inset-y-0 overflow-hidden whitespace-nowrap text-ellipsis border-l px-1 text-left text-[10px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-purple-300 ${
                        looped
                          ? "bg-purple-500/25 text-purple-100 border-purple-400/60"
                          : "bg-transparent text-zinc-400 border-zinc-700 hover:bg-zinc-800 hover:text-zinc-100"
                      }`}
                      style={{
                        left: totalSec ? percent(interval.startSec, totalSec) : "0%",
                        width: totalSec ? `${fractionOf(span, totalSec) * 100}%` : "0%",
                      }}
                      onClick={() => onLoopSection(looped ? null : index)}
                    >
                      {labels[index]}
                    </button>
                  );
                })}
              </div>
              <div
                aria-hidden="true"
                title="Click to move the playhead"
                className="remix-lane-seek-strip relative h-2.5 cursor-pointer border-y border-zinc-800 bg-zinc-800/50 hover:bg-zinc-700/50"
                onClick={seekFromClick}
              >
                {totalSec !== null &&
                  grid.sections.map((interval, index) => (
                    <span
                      key={index}
                      className="absolute inset-y-0 w-px bg-zinc-600"
                      style={{ left: percent(interval.startSec, totalSec) }}
                    />
                  ))}
              </div>
            </div>
          </div>
        )}

        {stems.map((stem, stemIndex) => {
          const dimmed = stem.muted || stem.soloedOut;
          const fxOpen = onFxChange !== undefined && openFx.has(stem.stemId);
          const fxActive = laneHasFx(stem.fx);
          const fxRowId = `${fxIdPrefix}-fx-${stemIndex}`;
          const gainDb = stem.gainDb ?? 0;
          const mask = grid ? sectionMask(stem.sections, sectionCount) : [];
          const allOn = mask.every(Boolean);
          const allOff = mask.length > 0 && mask.every((on) => !on);
          return (
            <div
              key={stem.stemId}
              data-stem-id={stem.stemId}
              className={`remix-lane-row flex border-t border-zinc-800 ${
                dimmed ? "remix-lane-row-dimmed" : ""
              }`}
            >
              {/* Channel strip */}
              <div
                className={`sticky left-0 z-20 ${STRIP_WIDTH} shrink-0 bg-zinc-900 border-r border-zinc-800 px-2 py-2 flex flex-col gap-1`}
              >
                <div
                  className={`truncate text-xs font-medium ${
                    dimmed ? "text-zinc-500" : "text-zinc-200"
                  }`}
                  title={stem.name}
                >
                  {stem.name}
                </div>
                <div className="flex items-center gap-1 min-w-0">
                  <span className="truncate text-[10px] text-zinc-500 flex-1 min-w-0">
                    {stem.type}
                    {stem.soloedOut ? " · muted by solo" : ""}
                  </span>
                  {onFxChange && (
                    <button
                      type="button"
                      aria-expanded={fxOpen}
                      aria-controls={fxOpen ? fxRowId : undefined}
                      aria-label={`Effects for ${stem.name}${fxActive ? " (on)" : ""}`}
                      title={fxActive ? "Effects on · show or hide" : "Show effects"}
                      disabled={disabled}
                      className={`relative shrink-0 rounded border px-1.5 text-[10px] disabled:opacity-40 remix-lane-fx-toggle ${
                        fxOpen
                          ? "bg-purple-500/20 border-purple-400/60 text-purple-100"
                          : "bg-transparent border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-100"
                      }`}
                      onClick={() => toggleFx(stem.stemId)}
                    >
                      FX
                      {fxActive && (
                        <span
                          aria-hidden="true"
                          className="absolute -right-1 -top-1 h-1.5 w-1.5 rounded-full bg-purple-400 remix-lane-fx-dot"
                        />
                      )}
                    </button>
                  )}
                  {grid && (
                    <>
                      <button
                        type="button"
                        disabled={disabled || allOn}
                        title={`Turn every section of ${stem.name} on`}
                        className="shrink-0 rounded border border-zinc-700 bg-transparent px-1.5 text-[10px] text-zinc-400 hover:border-zinc-500 hover:text-zinc-100 disabled:opacity-40 disabled:hover:border-zinc-700 disabled:hover:text-zinc-400 remix-lane-all-on"
                        onClick={() => onSetSections(stem.stemId, null)}
                      >
                        All on
                      </button>
                      <button
                        type="button"
                        disabled={disabled || allOff}
                        title={`Turn every section of ${stem.name} off`}
                        className="shrink-0 rounded border border-zinc-700 bg-transparent px-1.5 text-[10px] text-zinc-400 hover:border-zinc-500 hover:text-zinc-100 disabled:opacity-40 disabled:hover:border-zinc-700 disabled:hover:text-zinc-400 remix-lane-all-off"
                        onClick={() =>
                          onSetSections(
                            stem.stemId,
                            new Array<boolean>(sectionCount).fill(false),
                          )
                        }
                      >
                        All off
                      </button>
                    </>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    aria-pressed={stem.muted}
                    aria-label={`Mute ${stem.name}`}
                    title={stem.muted ? "Unmute" : "Mute"}
                    disabled={disabled}
                    className={`h-5 w-5 shrink-0 rounded border text-[10px] font-semibold disabled:opacity-50 remix-lane-mute ${
                      stem.muted
                        ? "bg-red-500/25 text-red-200 border-red-500/50"
                        : "bg-zinc-800 text-zinc-400 border-zinc-700 hover:text-zinc-100"
                    }`}
                    onClick={() => onToggleMute(stem.stemId)}
                  >
                    M
                  </button>
                  <button
                    type="button"
                    aria-pressed={stem.soloed}
                    aria-label={`Solo ${stem.name}`}
                    title={
                      stem.soloed
                        ? "Clear solo"
                        : "Solo (preview only, not saved)"
                    }
                    className={`h-5 w-5 shrink-0 rounded border text-[10px] font-semibold remix-lane-solo ${
                      stem.soloed
                        ? "bg-purple-500/30 text-purple-100 border-purple-400/60"
                        : "bg-zinc-800 text-zinc-400 border-zinc-700 hover:text-zinc-100"
                    }`}
                    onClick={() => onToggleSolo(stem.stemId)}
                  >
                    S
                  </button>
                  <input
                    type="range"
                    min={GAIN_DB_MIN}
                    max={GAIN_DB_MAX}
                    step={0.5}
                    value={gainDb}
                    disabled={disabled}
                    aria-label={`${stem.name} gain in decibels`}
                    className="h-1 min-w-0 flex-1 cursor-pointer accent-purple-400 disabled:cursor-not-allowed disabled:opacity-50 remix-lane-gain"
                    onChange={(event) =>
                      onGainChange(
                        stem.stemId,
                        clampGainDb(parseFloat(event.target.value)),
                      )
                    }
                  />
                  <span className="w-12 shrink-0 text-right text-[10px] tabular-nums text-zinc-300">
                    {formatGainDb(gainDb)}
                  </span>
                </div>
                {fxOpen && onFxChange && (
                  <LaneFxRow
                    id={fxRowId}
                    stem={stem}
                    disabled={disabled}
                    onFxChange={onFxChange}
                  />
                )}
              </div>

              {/* Lane */}
              <div
                className={`remix-lane relative flex-1 min-h-[4.5rem] select-none ${
                  dimmed ? "opacity-40" : ""
                }`}
                style={timelineStyle}
              >
                {!grid && totalSec !== null && (
                  <div
                    aria-hidden="true"
                    className="absolute inset-0 cursor-pointer remix-lane-seek"
                    onClick={seekFromClick}
                  />
                )}
                {stem.peaks === null ? (
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-x-2 top-1/2 h-1.5 -translate-y-1/2 animate-pulse rounded-full bg-zinc-700/70 remix-lane-waveform-loading"
                  />
                ) : (
                  <svg
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0 h-full w-full remix-lane-waveform"
                    viewBox="0 0 1000 100"
                    preserveAspectRatio="none"
                  >
                    <line
                      x1={0}
                      x2={1000}
                      y1={50}
                      y2={50}
                      className="stroke-zinc-700"
                      strokeWidth={1}
                      vectorEffect="non-scaling-stroke"
                    />
                    <path
                      d={peaksToSvgPath(stem.peaks, 1000, 100)}
                      className={grid ? "fill-purple-200/70" : "fill-purple-300/60"}
                    />
                  </svg>
                )}
                {grid &&
                  totalSec !== null &&
                  grid.sections.map((interval, index) => {
                    const on = mask[index];
                    return (
                      <button
                        key={index}
                        type="button"
                        aria-pressed={on}
                        aria-label={`${stem.name}: section ${index + 1} ${on ? "on" : "off"}`}
                        disabled={disabled}
                        className={`remix-lane-cell absolute inset-y-1 rounded-sm border focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-300 disabled:cursor-not-allowed ${
                          on
                            ? "remix-lane-cell-on bg-purple-500/30 border-purple-400/60 hover:bg-purple-500/40"
                            : "remix-lane-cell-off bg-zinc-950/85 border-zinc-700 hover:bg-zinc-900/80"
                        }`}
                        style={{
                          left: `calc(${percent(interval.startSec, totalSec)} + 1px)`,
                          width: `calc(${fractionOf(interval.endSec - interval.startSec, totalSec) * 100}% - 2px)`,
                          ...(on ? {} : OFF_CELL_STYLE),
                        }}
                        onPointerDown={(event) =>
                          handleCellPointerDown(event, stem, index)
                        }
                        onPointerEnter={(event) =>
                          handleCellPointerEnter(event, stem.stemId, index)
                        }
                        onClick={(event) => handleCellClick(event, stem, index)}
                      />
                    );
                  })}
              </div>
            </div>
          );
        })}

        {/* Loop band + playhead overlay (spans ruler and lanes) */}
        <div
          aria-hidden="true"
          className={`pointer-events-none absolute inset-y-0 right-0 ${STRIP_OFFSET} z-10`}
        >
          {loopInterval && totalSec !== null && (
            <div
              className="remix-lane-loop-band absolute inset-y-0 border-x border-purple-400/60 bg-purple-400/10"
              style={{
                left: percent(loopInterval.startSec, totalSec),
                width: `${fractionOf(loopInterval.endSec - loopInterval.startSec, totalSec) * 100}%`,
              }}
            />
          )}
          {totalSec !== null && (
            <LanePlayhead
              getPositionSec={getPositionSec}
              totalSec={totalSec}
              playing={playing}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/** A copy of `set` with `value` toggled. */
export function toggleInSet(
  set: ReadonlySet<string>,
  value: string,
): ReadonlySet<string> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

/**
 * The compact per-stem effects row revealed by a lane's FX toggle (#1897):
 * Space, Echo and Tone sliders with plain labels.
 */
export function LaneFxRow({
  id,
  stem,
  disabled,
  onFxChange,
}: {
  id: string;
  stem: Pick<LaneStem, "stemId" | "name" | "fx">;
  disabled: boolean;
  onFxChange(stemId: string, key: keyof RemixFxStem, value: number): void;
}) {
  return (
    <div
      id={id}
      role="group"
      aria-label={`${stem.name} effects`}
      className="mt-1 flex flex-col gap-1 border-t border-zinc-800 pt-1 remix-lane-fx"
    >
      {LANE_FX_CONTROLS.map((control) => {
        const range = REMIX_FX_STEM_RANGES[control.key];
        const value = stem.fx?.[control.key] ?? range.default;
        return (
          <div
            key={control.key}
            className={`flex items-center gap-1.5 remix-lane-fx-${control.key}`}
          >
            <span
              className="w-9 shrink-0 text-[10px] text-zinc-400"
              title={`${control.low} … ${control.high}`}
            >
              {control.label}
            </span>
            <input
              type="range"
              min={range.min}
              max={range.max}
              step={0.01}
              value={value}
              disabled={disabled}
              aria-label={`${stem.name} ${control.label.toLowerCase()} (${control.low} to ${control.high})`}
              aria-valuetext={control.format(value)}
              className="h-1 min-w-0 flex-1 cursor-pointer accent-purple-400 disabled:cursor-not-allowed disabled:opacity-50"
              onChange={(event) =>
                onFxChange(stem.stemId, control.key, parseFloat(event.target.value))
              }
            />
            <span className="w-12 shrink-0 truncate text-right text-[10px] tabular-nums text-zinc-300">
              {control.short(value)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Playhead line. Polls the position every animation frame and writes its
 * own `left` directly, so playback never re-renders the lanes.
 */
function LanePlayhead({
  getPositionSec,
  totalSec,
  playing,
}: {
  getPositionSec: () => number | null;
  totalSec: number;
  playing: boolean;
}) {
  const lineRef = useRef<HTMLDivElement>(null);
  const getPositionRef = useRef(getPositionSec);

  useEffect(() => {
    getPositionRef.current = getPositionSec;
  }, [getPositionSec]);

  useEffect(() => {
    let frame = 0;
    let last: string | null = null;
    const tick = () => {
      const line = lineRef.current;
      const position = getPositionRef.current();
      const next =
        position === null || !Number.isFinite(position)
          ? ""
          : percent(position, totalSec);
      if (line && next !== last) {
        if (next === "") {
          line.style.display = "none";
        } else {
          line.style.display = "block";
          line.style.left = next;
        }
        last = next;
      }
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [totalSec]);

  return (
    <div
      ref={lineRef}
      className={`remix-lane-playhead absolute inset-y-0 -ml-px w-0.5 ${
        playing ? "bg-white" : "bg-zinc-300/70"
      }`}
      style={{ display: "none", left: "0%" }}
    >
      <span
        className={`absolute -left-1 top-0 h-0 w-0 border-x-[5px] border-t-[6px] border-x-transparent ${
          playing ? "border-t-white" : "border-t-zinc-300/70"
        }`}
      />
    </div>
  );
}
