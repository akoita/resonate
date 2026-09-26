"use client";

import { useEffect, useId, useRef, useState } from "react";
import type {
  CSSProperties,
  KeyboardEvent,
  MouseEvent,
  PointerEvent,
  Ref,
} from "react";
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
import {
  isIdentityTimeline,
  moveBlock,
  removeBlock,
  repeatBlock,
  REMIX_STRUCTURE_MAX_BLOCKS,
  structureTimeline,
  structureTooLongReason,
  toggleFade,
  type RemixStructureEditResult,
  type RemixStructureEditState,
  type RemixStructureSegment,
  type RemixStructureTimeline,
} from "../../lib/remixStructure";

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
  /**
   * Per-block on/off mask (#1899: indexed by timeline block; without a
   * structure the blocks are the grid's sections); null = every block on.
   */
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
  /**
   * Structure timeline (#1899): the columns are its blocks, sized by their
   * timeline duration. Absent/null = the grid's sections in order.
   */
  timeline?: RemixStructureTimeline | null;
  /**
   * Structure edit state (#1899) behind each block's "⋯" menu; the menu
   * shows only with `onBlockAction`.
   */
  structureState?: RemixStructureEditState | null;
  onBlockAction?(index: number, action: LaneBlockAction): void;
};

/** Section-menu actions on one timeline block (#1899). */
export type LaneBlockAction =
  | "repeat"
  | "remove"
  | "earlier"
  | "later"
  | "fade_in"
  | "fade_out";

export type LaneBlockMenuEntry = {
  action: LaneBlockAction;
  label: string;
  /** Fade entries only: whether the fade is on (a checkable entry). */
  checked?: boolean;
  enabled: boolean;
  /** Honest reason the entry is unavailable; null when enabled. */
  reason: string | null;
};

/** Runs one section-menu action through the structure ops; null = refused. */
export function blockActionResult(
  state: RemixStructureEditState,
  index: number,
  action: LaneBlockAction,
  grid: Pick<RemixSectionGrid, "sections" | "durationSeconds">,
): RemixStructureEditResult | null {
  switch (action) {
    case "repeat":
      return repeatBlock(state, index, grid);
    case "remove":
      return removeBlock(state, index);
    case "earlier":
      return moveBlock(state, index, -1);
    case "later":
      return moveBlock(state, index, 1);
    case "fade_in":
      return toggleFade(state, index, "in");
    case "fade_out":
      return toggleFade(state, index, "out");
  }
}

function refusalReason(
  state: RemixStructureEditState,
  action: LaneBlockAction,
  grid: Pick<RemixSectionGrid, "durationSeconds">,
): string {
  switch (action) {
    case "repeat":
      return state.blocks.length >= REMIX_STRUCTURE_MAX_BLOCKS
        ? `The song can't have more than ${REMIX_STRUCTURE_MAX_BLOCKS} sections`
        : structureTooLongReason(grid);
    case "remove":
      return "The song needs at least one section";
    case "earlier":
      return "This is already the first section";
    case "later":
      return "This is already the last section";
    default:
      return "This section can't fade";
  }
}

const BLOCK_MENU_ITEMS: readonly { action: LaneBlockAction; label: string }[] = [
  { action: "repeat", label: "Repeat this section" },
  { action: "remove", label: "Remove" },
  { action: "earlier", label: "Move earlier" },
  { action: "later", label: "Move later" },
  { action: "fade_in", label: "Fade in" },
  { action: "fade_out", label: "Fade out" },
];

/**
 * The "⋯" menu entries for block `index` (#1899): an entry whose structure
 * op refuses is disabled with a plain reason, never a dead button.
 */
export function blockMenuEntries(
  state: RemixStructureEditState,
  index: number,
  grid: Pick<RemixSectionGrid, "sections" | "durationSeconds">,
): LaneBlockMenuEntry[] {
  const block = state.blocks[index];
  return BLOCK_MENU_ITEMS.map(({ action, label }) => {
    const enabled = blockActionResult(state, index, action, grid) !== null;
    return {
      action,
      label,
      ...(action === "fade_in" ? { checked: block?.fadeIn === true } : {}),
      ...(action === "fade_out" ? { checked: block?.fadeOut === true } : {}),
      enabled,
      reason: enabled ? null : refusalReason(state, action, grid),
    };
  });
}

/**
 * Arrow-key navigation inside a menu: Down/Up wrap, Home/End jump; null for
 * any other key. `current` −1 = nothing focused yet.
 */
export function nextMenuIndex(
  key: string,
  current: number,
  count: number,
): number | null {
  if (count <= 0) return null;
  switch (key) {
    case "ArrowDown":
      return current < 0 ? 0 : (current + 1) % count;
    case "ArrowUp":
      return current < 0 ? count - 1 : (current - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}

/**
 * The lane columns: the timeline's blocks, or the grid's sections in order
 * when there is no (or an empty) timeline.
 */
export function laneColumns(
  grid: RemixSectionGrid,
  timeline: RemixStructureTimeline | null | undefined,
): RemixStructureSegment[] {
  return timeline && timeline.segments.length > 0
    ? timeline.segments
    : structureTimeline(grid, null).segments;
}

/** Whether block `index` plays a section an earlier block already played. */
export function isRepeatBlock(
  columns: readonly Pick<RemixStructureSegment, "section">[],
  index: number,
): boolean {
  const section = columns[index]?.section;
  return (
    section !== undefined &&
    columns.slice(0, index).some((column) => column.section === section)
  );
}

/** A section named in plain words: "bar 9", "the pickup", "the section at 0:32". */
export function sectionPlaceLabel(grid: RemixSectionGrid, section: number): string {
  const label = sectionColumnLabels(grid)[section] ?? String(section + 1);
  if (grid.kind !== "bars") return `the section at ${label}`;
  return label === "Pickup" ? "the pickup" : `bar ${label}`;
}

/**
 * The part of a stem's waveform one block plays (#1899): the peak buckets
 * covering source seconds `startSec..endSec`, with the peaks spread evenly
 * across `sourceSec`. At least one bucket for a non-empty span.
 */
export function slicePeaks(
  peaks: readonly number[],
  sourceSec: number,
  startSec: number,
  endSec: number,
): number[] {
  const count = peaks.length;
  if (count === 0 || !(sourceSec > 0) || !(endSec > startSec)) return [];
  const from = Math.min(
    count - 1,
    Math.max(0, Math.floor((startSec / sourceSec) * count)),
  );
  const to = Math.min(
    count,
    Math.max(from + 1, Math.ceil((endSec / sourceSec) * count)),
  );
  return peaks.slice(from, to);
}

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

/**
 * Minimum on-screen width per column, in CSS pixels: room for the label and
 * the "⋯" section menu (#1899).
 */
export const LANE_MIN_SECTION_PX = 40;

/** Section-menu width, for keeping it on screen. */
const BLOCK_MENU_WIDTH_PX = 192;

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

type OpenBlockMenu = {
  index: number;
  top: number;
  left: number;
  focus: "first" | "last";
};

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
  timeline,
  structureState,
  onBlockAction,
}: RemixSessionLanesProps) {
  const fxIdPrefix = useId();
  // Which stems show their FX row: view state only, never saved.
  const [openFx, setOpenFx] = useState<ReadonlySet<string>>(() => new Set());
  const toggleFx = (stemId: string) =>
    setOpenFx((open) => toggleInSet(open, stemId));
  // Columns are timeline blocks (#1899); without a structure, the sections.
  const columns = grid ? laneColumns(grid, timeline) : [];
  const structured = grid !== null && !isIdentityTimeline({ segments: columns });
  const totalSec = structured
    ? columns[columns.length - 1].outEndSec
    : timelineSeconds(durationSec, grid);
  const blockCount = columns.length;
  const labels = grid ? sectionColumnLabels(grid) : [];
  const timelineStyle =
    grid && blockCount > 0
      ? { minWidth: `${blockCount * LANE_MIN_SECTION_PX}px` }
      : undefined;
  const loopColumn =
    loopSectionIndex !== null ? (columns[loopSectionIndex] ?? null) : null;
  const menuAvailable =
    grid !== null &&
    onBlockAction !== undefined &&
    !!structureState &&
    structureState.blocks.length === blockCount;

  // Section "⋯" menu (#1899): one open at a time, placed under its trigger.
  const [menu, setMenu] = useState<OpenBlockMenu | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRefs = useRef(new Map<number, HTMLButtonElement>());
  // Block whose trigger takes focus back after the menu closes.
  const pendingFocusRef = useRef<number | null>(null);
  const openMenu =
    menuAvailable && !disabled && menu && menu.index < blockCount ? menu : null;

  useEffect(() => {
    const index = pendingFocusRef.current;
    if (index === null) return;
    pendingFocusRef.current = null;
    const triggers = triggerRefs.current;
    const target =
      triggers.get(index) ?? triggers.get(Math.min(index, triggers.size - 1));
    target?.focus();
  });

  useEffect(() => {
    if (!openMenu) return;
    const index = openMenu.index;
    const onPointerDown = (event: globalThis.PointerEvent) => {
      const target = event.target instanceof Node ? event.target : null;
      if (
        target &&
        (menuRef.current?.contains(target) ||
          triggerRefs.current.get(index)?.contains(target))
      ) {
        return;
      }
      setMenu(null);
    };
    const close = () => setMenu(null);
    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [openMenu]);

  const toggleBlockMenu = (
    index: number,
    trigger: HTMLButtonElement,
    focus: "first" | "last",
    forceOpen = false,
  ) => {
    if (disabled || !menuAvailable) return;
    if (!forceOpen && menu?.index === index) {
      setMenu(null);
      return;
    }
    const rect = trigger.getBoundingClientRect();
    const maxLeft = Math.max(8, window.innerWidth - BLOCK_MENU_WIDTH_PX - 8);
    setMenu({
      index,
      top: rect.bottom + 4,
      left: Math.min(maxLeft, Math.max(8, rect.right - BLOCK_MENU_WIDTH_PX)),
      focus,
    });
  };

  const closeBlockMenu = (returnFocusTo: number | null) => {
    pendingFocusRef.current = returnFocusTo;
    setMenu(null);
  };

  const selectBlockAction = (index: number, action: LaneBlockAction) => {
    const target =
      action === "remove"
        ? Math.max(0, Math.min(index, blockCount - 2))
        : action === "earlier"
          ? index - 1
          : action === "later"
            ? index + 1
            : index;
    closeBlockMenu(target);
    onBlockAction?.(index, action);
  };

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
    const mask = sectionMask(stem.sections, blockCount);
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
    const current = sectionMask(stem.sections, blockCount);
    onSetSections(
      stem.stemId,
      applyPaint(stem.sections, blockCount, index, !current[index]),
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
                {columns.map((column, index) => {
                  const looped = loopSectionIndex === index;
                  const span = totalSec
                    ? column.outEndSec - column.outStartSec
                    : 0;
                  const start = sectionStartLabel({
                    startSec: column.outStartSec,
                    endSec: column.outEndSec,
                  });
                  const place = sectionPlaceLabel(grid, column.section);
                  const repeat = isRepeatBlock(columns, index);
                  const notes = [
                    repeat ? `repeat of ${place}` : null,
                    column.fadeIn ? "fades in" : null,
                    column.fadeOut ? "fades out" : null,
                  ].filter((note): note is string => note !== null);
                  const menuOpen = openMenu?.index === index;
                  const menuId = `${fxIdPrefix}-block-menu-${index}`;
                  return (
                    <div
                      key={index}
                      className="remix-lane-block-header absolute inset-y-0 flex"
                      style={{
                        left: totalSec ? percent(column.outStartSec, totalSec) : "0%",
                        width: totalSec ? `${fractionOf(span, totalSec) * 100}%` : "0%",
                      }}
                    >
                      <button
                        type="button"
                        aria-pressed={looped}
                        aria-label={`Loop section ${index + 1} (starts ${start}${notes.map((note) => `, ${note}`).join("")})`}
                        title={`Section ${index + 1} · starts ${start}${notes.map((note) => ` · ${note.charAt(0).toUpperCase()}${note.slice(1)}`).join("")} · click to loop`}
                        className={`remix-lane-section-header min-w-0 flex-1 overflow-hidden whitespace-nowrap text-ellipsis border-l px-1 text-left text-[10px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-purple-300 ${
                          looped
                            ? "bg-purple-500/25 text-purple-100 border-purple-400/60"
                            : "bg-transparent text-zinc-400 border-zinc-700 hover:bg-zinc-800 hover:text-zinc-100"
                        }`}
                        onClick={() => onLoopSection(looped ? null : index)}
                      >
                        {repeat && (
                          <span
                            aria-hidden="true"
                            title={`Repeat of ${place}`}
                            className="mr-0.5 text-purple-300 remix-lane-repeat-mark"
                          >
                            ↺
                          </span>
                        )}
                        {column.fadeIn && (
                          <span
                            aria-hidden="true"
                            title="Fades in"
                            className="mr-0.5 text-sky-300 remix-lane-fade-in-mark"
                          >
                            ◢
                          </span>
                        )}
                        {labels[column.section]}
                        {column.fadeOut && (
                          <span
                            aria-hidden="true"
                            title="Fades out"
                            className="ml-0.5 text-sky-300 remix-lane-fade-out-mark"
                          >
                            ◣
                          </span>
                        )}
                      </button>
                      {menuAvailable && (
                        <button
                          ref={(element) => {
                            if (!element) return;
                            triggerRefs.current.set(index, element);
                            return () => {
                              if (triggerRefs.current.get(index) === element) {
                                triggerRefs.current.delete(index);
                              }
                            };
                          }}
                          type="button"
                          aria-haspopup="menu"
                          aria-expanded={menuOpen}
                          aria-controls={menuOpen ? menuId : undefined}
                          aria-label={`Section options for ${place}${repeat ? " (repeat)" : ""}`}
                          title={
                            disabled
                              ? "Section options are locked"
                              : "Repeat, remove, move or fade this section"
                          }
                          disabled={disabled}
                          className={`shrink-0 px-0.5 text-[11px] leading-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-purple-300 disabled:cursor-not-allowed disabled:opacity-40 remix-lane-block-menu-trigger ${
                            menuOpen
                              ? "bg-purple-500/25 text-purple-100"
                              : "bg-transparent text-zinc-500 hover:bg-zinc-800 hover:text-zinc-100"
                          }`}
                          onClick={(event) =>
                            toggleBlockMenu(index, event.currentTarget, "first")
                          }
                          onKeyDown={(event) => {
                            if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
                              return;
                            }
                            event.preventDefault();
                            toggleBlockMenu(
                              index,
                              event.currentTarget,
                              event.key === "ArrowUp" ? "last" : "first",
                              true,
                            );
                          }}
                        >
                          ⋯
                        </button>
                      )}
                    </div>
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
                  columns.map((column, index) => (
                    <span
                      key={index}
                      className="absolute inset-y-0 w-px bg-zinc-600"
                      style={{ left: percent(column.outStartSec, totalSec) }}
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
          const mask = grid ? sectionMask(stem.sections, blockCount) : [];
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
                            new Array<boolean>(blockCount).fill(false),
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
                ) : structured && grid && totalSec !== null ? (
                  // Structure (#1899): each block draws the slice of the
                  // source waveform it plays.
                  columns.map((column, index) => (
                    <svg
                      key={index}
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-y-0 h-full remix-lane-waveform remix-lane-block-waveform"
                      style={{
                        left: percent(column.outStartSec, totalSec),
                        width: `${fractionOf(column.outEndSec - column.outStartSec, totalSec) * 100}%`,
                      }}
                      viewBox="0 0 100 100"
                      preserveAspectRatio="none"
                    >
                      <line
                        x1={0}
                        x2={100}
                        y1={50}
                        y2={50}
                        className="stroke-zinc-700"
                        strokeWidth={1}
                        vectorEffect="non-scaling-stroke"
                      />
                      <path
                        d={peaksToSvgPath(
                          slicePeaks(
                            stem.peaks ?? [],
                            grid.durationSeconds,
                            column.srcStartSec,
                            column.srcEndSec,
                          ),
                          100,
                          100,
                        )}
                        className="fill-purple-200/70"
                      />
                    </svg>
                  ))
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
                  columns.map((column, index) => {
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
                          left: `calc(${percent(column.outStartSec, totalSec)} + 1px)`,
                          width: `calc(${fractionOf(column.outEndSec - column.outStartSec, totalSec) * 100}% - 2px)`,
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
          {loopColumn && totalSec !== null && (
            <div
              className="remix-lane-loop-band absolute inset-y-0 border-x border-purple-400/60 bg-purple-400/10"
              style={{
                left: percent(loopColumn.outStartSec, totalSec),
                width: `${fractionOf(loopColumn.outEndSec - loopColumn.outStartSec, totalSec) * 100}%`,
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
      {openMenu && grid && structureState && (
        <LaneBlockMenu
          key={openMenu.index}
          ref={menuRef}
          id={`${fxIdPrefix}-block-menu-${openMenu.index}`}
          label={`Options for ${sectionPlaceLabel(grid, columns[openMenu.index].section)}`}
          entries={blockMenuEntries(structureState, openMenu.index, grid)}
          initialFocus={openMenu.focus}
          style={{ top: openMenu.top, left: openMenu.left }}
          onSelect={(action) => selectBlockAction(openMenu.index, action)}
          onClose={(returnFocus) =>
            closeBlockMenu(returnFocus ? openMenu.index : null)
          }
        />
      )}
    </div>
  );
}

/**
 * A block's section menu (#1899): `role="menu"`, arrow keys move between
 * entries, Esc closes (focus returns to the trigger), Tab closes. Refused
 * entries stay focusable but inert (`aria-disabled`) and say why.
 */
export function LaneBlockMenu({
  ref,
  id,
  label,
  entries,
  initialFocus = "first",
  style,
  onSelect,
  onClose,
}: {
  ref?: Ref<HTMLDivElement>;
  id: string;
  label: string;
  entries: LaneBlockMenuEntry[];
  initialFocus?: "first" | "last";
  style?: CSSProperties;
  onSelect(action: LaneBlockAction): void;
  /** `returnFocus`: Esc (true) vs Tab away (false). */
  onClose(returnFocus: boolean): void;
}) {
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const initialFocusRef = useRef(initialFocus);
  useEffect(() => {
    const items = itemRefs.current;
    const start = initialFocusRef.current === "last" ? items.length - 1 : 0;
    items[start]?.focus({ preventScroll: true });
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = itemRefs.current;
    const current = items.findIndex((item) => item === document.activeElement);
    const next = nextMenuIndex(event.key, current, entries.length);
    if (next !== null) {
      event.preventDefault();
      items[next]?.focus({ preventScroll: true });
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose(true);
      return;
    }
    if (event.key === "Tab") onClose(false);
  };

  return (
    <div
      ref={ref}
      id={id}
      role="menu"
      aria-label={label}
      style={style}
      className="fixed z-50 w-48 rounded-md border border-zinc-700 bg-zinc-900 py-1 shadow-lg shadow-black/50 remix-lane-block-menu"
      onKeyDown={onKeyDown}
    >
      {entries.map((entry, index) => {
        const checkable = entry.checked !== undefined;
        return (
          <button
            key={entry.action}
            ref={(element) => {
              itemRefs.current[index] = element;
            }}
            type="button"
            role={checkable ? "menuitemcheckbox" : "menuitem"}
            aria-checked={checkable ? entry.checked : undefined}
            aria-disabled={entry.enabled ? undefined : true}
            tabIndex={-1}
            title={entry.reason ?? undefined}
            className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs focus-visible:outline-none remix-lane-block-menu-item remix-lane-block-menu-${entry.action} ${
              entry.enabled
                ? "bg-transparent text-zinc-200 hover:bg-purple-500/15 focus:bg-purple-500/15"
                : "cursor-not-allowed bg-transparent text-zinc-500 focus:bg-zinc-800"
            }`}
            onClick={() => {
              if (entry.enabled) onSelect(entry.action);
            }}
          >
            <span aria-hidden="true" className="w-3 shrink-0 text-purple-300">
              {checkable && entry.checked ? "✓" : ""}
            </span>
            <span>{entry.label}</span>
            {entry.reason && <span className="sr-only">{` — ${entry.reason}`}</span>}
          </button>
        );
      })}
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
