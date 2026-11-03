"use client";

/**
 * Automation lanes (#2541, Remix Studio Pro, S6e of #1903). Per stem, a
 * level lane (dB) and a filter lane (one DJ filter knob) drawn as points on
 * whole bars; values move in a straight line between points. The preview
 * plays the unsaved lanes; the render applies the saved ones.
 */
import { useEffect, useRef, useState } from "react";
import type { RemixAutomation } from "../../lib/api";
import { registerVisibleInterval } from "../../lib/visibleInterval";
import {
  AUTOMATION_LANES,
  AUTOMATION_MAX_POINTS,
  automationPayload,
  automationProblems,
  automationValueLabel,
  clearAutomationLane,
  moveAutomationPoint,
  removeAutomationPoint,
  sameAutomation,
  setAutomationPoint,
  snapAutomationValue,
  type AutomationLaneName,
} from "../../lib/remixAutomation";

const btn =
  "rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200 hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed";
const field = "rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-100";
const LANES: AutomationLaneName[] = ["level", "filter"];

const CURVE_W = 600;
const CURVE_H = 72;
const CURVE_PAD = 6;

/** The bar under a horizontal position (0..1 across the lane), whole bars only. */
export function curveBarAt(ratioX: number, barCount: number): number {
  const span = Math.max(1, barCount - 1);
  const inner = (ratioX * CURVE_W - CURVE_PAD) / (CURVE_W - 2 * CURVE_PAD);
  return Math.max(0, Math.min(barCount - 1, Math.round(inner * span)));
}

/** The lane value under a vertical position (0 top .. 1 bottom), snapped to the lane's step. */
export function curveValueAt(ratioY: number, lane: AutomationLaneName): number {
  const spec = AUTOMATION_LANES[lane];
  const inner = (ratioY * CURVE_H - CURVE_PAD) / (CURVE_H - 2 * CURVE_PAD);
  return snapAutomationValue(lane, spec.max - Math.max(0, Math.min(1, inner)) * (spec.max - spec.min));
}

type CurvePoint = { bar: number; value: number };

/**
 * The lane as a line across the song (#2541), editable on the curve (#2551):
 * click an empty spot to add a point, drag a point (bar and value snap),
 * double-click or Delete to remove it, arrows to nudge it (Shift: 10 steps).
 * A drag previews locally and commits once, on release, so the preview
 * restarts once per edit.
 */
function LaneCurve({
  points,
  lane,
  barCount,
  playheadBar,
  disabled,
  onAdd,
  onMove,
  onRemove,
}: {
  points: CurvePoint[];
  lane: AutomationLaneName;
  barCount: number;
  playheadBar: number | null;
  disabled?: boolean;
  onAdd(bar: number, value: number): void;
  /** Move the point on `fromBar` to `to` (replacing a point already there). */
  onMove(fromBar: number, to: CurvePoint): void;
  onRemove(bar: number): void;
}) {
  const spec = AUTOMATION_LANES[lane];
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [drag, setDrag] = useState<{ fromBar: number; to: CurvePoint } | null>(null);
  // A keyboard nudge re-keys the point (by bar); keep the focus on it.
  const focusBar = useRef<number | null>(null);
  useEffect(() => {
    if (focusBar.current === null) return;
    const el = svgRef.current?.querySelector<SVGCircleElement>(`circle[data-bar="${focusBar.current}"]`);
    focusBar.current = null;
    el?.focus();
  }, [points]);
  const w = CURVE_W;
  const h = CURVE_H;
  const pad = CURVE_PAD;
  const span = Math.max(1, barCount - 1);
  const x = (bar: number) => pad + ((w - 2 * pad) * Math.min(bar, span)) / span;
  const y = (value: number) => pad + ((h - 2 * pad) * (spec.max - value)) / (spec.max - spec.min);
  const neutralY = y(spec.neutral);
  // While dragging, draw the lane as it would be after the drop.
  const shown: CurvePoint[] = drag
    ? [...points.filter((p) => p.bar !== drag.fromBar && p.bar !== drag.to.bar), drag.to].sort((a, b) => a.bar - b.bar)
    : points;
  const line =
    shown.length > 0
      ? [
          `M ${pad} ${y(shown[0].value)}`,
          ...shown.map((p) => `L ${x(p.bar)} ${y(p.value)}`),
          `L ${w - pad} ${y(shown[shown.length - 1].value)}`,
        ].join(" ")
      : `M ${pad} ${neutralY} L ${w - pad} ${neutralY}`;
  const pointAt = (clientX: number, clientY: number): CurvePoint | null => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return null;
    return {
      bar: curveBarAt((clientX - rect.left) / rect.width, barCount),
      value: curveValueAt((clientY - rect.top) / rect.height, lane),
    };
  };
  const nudge = (point: CurvePoint, key: string, shift: boolean): CurvePoint | null => {
    const steps = shift ? 10 : 1;
    if (key === "ArrowLeft") return point.bar > 0 ? { ...point, bar: point.bar - 1 } : null;
    if (key === "ArrowRight") return point.bar < barCount - 1 ? { ...point, bar: point.bar + 1 } : null;
    if (key === "ArrowUp") return { ...point, value: snapAutomationValue(lane, point.value + steps * spec.step) };
    if (key === "ArrowDown") return { ...point, value: snapAutomationValue(lane, point.value - steps * spec.step) };
    return null;
  };
  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${w} ${h}`}
      className={`mt-2 h-16 w-full touch-none select-none rounded border border-zinc-800 bg-zinc-900/70 ${disabled ? "" : "cursor-crosshair"}`}
      role="group"
      aria-label={`${spec.label} lane: ${points.length === 0 ? "no points" : `${points.length} point${points.length === 1 ? "" : "s"}`}`}
      preserveAspectRatio="none"
      onPointerDown={(e) => {
        if (disabled || e.button !== 0 || e.target !== e.currentTarget) return;
        const at = pointAt(e.clientX, e.clientY);
        if (at && !points.some((p) => p.bar === at.bar)) onAdd(at.bar, at.value);
      }}
    >
      {Array.from({ length: Math.floor(span / 4) + 1 }, (_, i) => i * 4).map((bar) => (
        <line key={bar} x1={x(bar)} x2={x(bar)} y1={pad} y2={h - pad} stroke="#27272a" strokeWidth={1} pointerEvents="none" />
      ))}
      <line x1={pad} x2={w - pad} y1={neutralY} y2={neutralY} stroke="#3f3f46" strokeDasharray="4 4" strokeWidth={1} pointerEvents="none" />
      {playheadBar !== null && (
        <line x1={x(playheadBar)} x2={x(playheadBar)} y1={0} y2={h} stroke="#a78bfa" strokeWidth={1.5} pointerEvents="none" />
      )}
      <path d={line} fill="none" stroke={shown.length > 0 ? "#c084fc" : "#52525b"} strokeWidth={2} pointerEvents="none" />
      {points.map((p) => {
        const at = drag?.fromBar === p.bar ? drag.to : p;
        return (
          <circle
            key={p.bar}
            cx={x(at.bar)}
            cy={y(at.value)}
            r={5}
            fill={drag?.fromBar === p.bar ? "#ffffff" : "#e9d5ff"}
            stroke="#7c3aed"
            strokeWidth={1}
            className={disabled ? "" : "cursor-grab focus:outline-none"}
            data-bar={p.bar}
            role="slider"
            tabIndex={disabled ? -1 : 0}
            aria-label={`${spec.label} point at bar ${p.bar + 1}`}
            aria-valuemin={spec.min}
            aria-valuemax={spec.max}
            aria-valuenow={p.value}
            aria-valuetext={`Bar ${p.bar + 1}, ${automationValueLabel(lane, p.value)}`}
            aria-disabled={disabled || undefined}
            onPointerDown={(e) => {
              if (disabled || e.button !== 0) return;
              e.stopPropagation();
              e.currentTarget.setPointerCapture?.(e.pointerId);
              setDrag({ fromBar: p.bar, to: p });
            }}
            onPointerMove={(e) => {
              if (!drag || drag.fromBar !== p.bar) return;
              const to = pointAt(e.clientX, e.clientY);
              if (to && (to.bar !== drag.to.bar || to.value !== drag.to.value)) setDrag({ fromBar: p.bar, to });
            }}
            onPointerUp={() => {
              if (!drag || drag.fromBar !== p.bar) return;
              setDrag(null);
              if (drag.to.bar !== p.bar || drag.to.value !== p.value) onMove(p.bar, drag.to);
            }}
            onPointerCancel={() => setDrag(null)}
            onDoubleClick={() => {
              if (!disabled) onRemove(p.bar);
            }}
            onKeyDown={(e) => {
              if (disabled) return;
              if (e.key === "Delete" || e.key === "Backspace") {
                e.preventDefault();
                onRemove(p.bar);
                return;
              }
              const to = nudge(p, e.key, e.shiftKey);
              if (!to) return;
              e.preventDefault();
              if (to.bar === p.bar && to.value === p.value) return;
              focusBar.current = to.bar;
              onMove(p.bar, to);
            }}
          />
        );
      })}
    </svg>
  );
}

export function RemixAutomationPanel({
  stems,
  draft,
  saved,
  downbeats,
  getPositionSec,
  disabled,
  disabledReason,
  saving,
  error,
  onChange,
  onSave,
  onUndo,
}: {
  stems: Array<{ stemId: string; label: string }>;
  /** The lanes being edited (the preview plays these). */
  draft: RemixAutomation;
  saved: RemixAutomation | null;
  /** Timeline downbeats (`timelineDownbeats`). */
  downbeats: number[];
  /** The playhead in timeline seconds, polled for "Add point at bar N". */
  getPositionSec: () => number | null;
  disabled?: boolean;
  disabledReason?: string | null;
  saving?: boolean;
  error?: string | null;
  onChange(next: RemixAutomation): void;
  onSave(automation: RemixAutomation | null): void;
  onUndo(): void;
}) {
  const [stemId, setStemId] = useState<string>(stems[0]?.stemId ?? "");
  const [lane, setLane] = useState<AutomationLaneName>("level");
  const [playheadBar, setPlayheadBar] = useState(0);
  const clock = useRef({ downbeats, getPositionSec });
  useEffect(() => {
    clock.current = { downbeats, getPositionSec };
  });
  useEffect(() => {
    const read = () =>
      setPlayheadBar(barAtTime(clock.current.downbeats, clock.current.getPositionSec() ?? 0));
    read();
    // Paused while the tab is hidden (#2436 interval budget).
    return registerVisibleInterval(read, 250);
  }, []);
  const barCount = downbeats.length;
  const selected = stems.some((stem) => stem.stemId === stemId) ? stemId : (stems[0]?.stemId ?? "");

  if (barCount < 2 || stems.length === 0) {
    return (
      <p className="mt-3 text-xs text-zinc-500 remix-automation-panel">
        Automation: this source has no bar grid, so there are no bars to draw on.
      </p>
    );
  }

  const spec = AUTOMATION_LANES[lane];
  const points = draft.stems[selected]?.[lane] ?? [];
  const problems = automationProblems(draft, barCount);
  const payload = automationPayload(draft);
  const changed = !sameAutomation(draft, saved);
  const locked = disabled || saving;
  const here = Math.max(0, Math.min(barCount - 1, playheadBar));
  const hasHere = points.some((p) => p.bar === here);
  const stemLabel = (id: string) => stems.find((stem) => stem.stemId === id)?.label ?? id;
  const automated = Object.entries(draft.stems).map(
    ([id, lanes]) =>
      `${stemLabel(id)} (${LANES.filter((name) => lanes[name]?.length)
        .map((name) => AUTOMATION_LANES[name].label.toLowerCase())
        .join(", ")})`,
  );

  return (
    <div
      className="mt-3 rounded-md border border-zinc-800 bg-zinc-950/60 p-3 text-xs text-zinc-300 remix-automation-panel"
      role="group"
      aria-label="Automation lanes"
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-semibold text-zinc-100">Automation</span>
        <span className="text-zinc-500">
          Move a stem&apos;s level or filter over the song: set points on bars, and it glides from one to the next.
        </span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1">
          <span>Stem</span>
          <select
            value={selected}
            disabled={locked}
            onChange={(e) => setStemId(e.target.value)}
            className={field}
            aria-label="Automation stem"
          >
            {stems.map((stem) => (
              <option key={stem.stemId} value={stem.stemId}>
                {stem.label}
              </option>
            ))}
          </select>
        </label>
        <div className="flex gap-1" role="group" aria-label="Automation lane">
          {LANES.map((name) => (
            <button
              key={name}
              type="button"
              className={
                lane === name
                  ? "rounded-md border border-purple-400/70 bg-purple-600/50 px-2 py-1 text-xs font-semibold text-white"
                  : btn
              }
              aria-pressed={lane === name}
              onClick={() => setLane(name)}
            >
              {AUTOMATION_LANES[name].label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className={btn}
          disabled={locked || hasHere || points.length >= AUTOMATION_MAX_POINTS}
          onClick={() =>
            onChange(
              setAutomationPoint(draft, selected, lane, here, points.length > 0 ? valueAtBar(points, here) : spec.neutral),
            )
          }
        >
          Add point at bar {here + 1}
        </button>
        {points.length > 0 && (
          <button
            type="button"
            className="border-0 bg-transparent text-xs text-zinc-400 hover:text-zinc-200"
            disabled={locked}
            onClick={() => onChange(clearAutomationLane(draft, selected, lane))}
          >
            Clear lane
          </button>
        )}
      </div>
      <LaneCurve
        points={points}
        lane={lane}
        barCount={barCount}
        playheadBar={here}
        disabled={locked}
        onAdd={(bar, value) => onChange(setAutomationPoint(draft, selected, lane, bar, value))}
        onMove={(fromBar, to) =>
          onChange(
            setAutomationPoint(
              removeAutomationPoint(draft, selected, lane, fromBar),
              selected,
              lane,
              to.bar,
              to.value,
            ),
          )
        }
        onRemove={(bar) => onChange(removeAutomationPoint(draft, selected, lane, bar))}
      />
      {points.length === 0 ? (
        <p className="mt-2 text-zinc-500">
          No {spec.label.toLowerCase()} points on {stemLabel(selected)}. Click the lane to add one, or move the playhead to a bar and use Add point.
        </p>
      ) : (
        <ul className="mt-2 space-y-1" aria-label={`${stemLabel(selected)} ${spec.label.toLowerCase()} points`}>
          {points.map((point) => (
            <li key={point.bar} className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-1">
                <span>Bar</span>
                <input
                  type="number"
                  min={1}
                  max={barCount}
                  step={1}
                  // Committed on blur or Enter, so typing "12" never lands on bar 1 first.
                  defaultValue={point.bar + 1}
                  disabled={locked}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                  }}
                  onBlur={(e) => {
                    const n = Math.round(Number(e.target.value));
                    if (Number.isFinite(n) && n >= 1 && n <= barCount && n - 1 !== point.bar) {
                      onChange(moveAutomationPoint(draft, selected, lane, point.bar, n - 1));
                    } else {
                      e.target.value = String(point.bar + 1);
                    }
                  }}
                  className={`${field} w-16`}
                  aria-label={`Point bar (now ${point.bar + 1})`}
                />
              </label>
              <input
                type="range"
                min={spec.min}
                max={spec.max}
                step={spec.step}
                value={point.value}
                disabled={locked}
                onChange={(e) => onChange(setAutomationPoint(draft, selected, lane, point.bar, Number(e.target.value)))}
                className="w-40 accent-purple-400"
                aria-label={`${spec.label} at bar ${point.bar + 1}`}
              />
              <span className="min-w-[7rem] tabular-nums text-zinc-200">{automationValueLabel(lane, point.value)}</span>
              <button
                type="button"
                className="border-0 bg-transparent text-xs text-zinc-400 hover:text-red-300"
                disabled={locked}
                onClick={() => onChange(removeAutomationPoint(draft, selected, lane, point.bar))}
                aria-label={`Remove the point at bar ${point.bar + 1}`}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      {lane === "filter" && (
        <p className="mt-2 text-zinc-500">Below the middle a low-pass closes (darker), above it a high-pass opens (thinner).</p>
      )}
      <p className="mt-2 text-zinc-500">
        {automated.length > 0 ? `Automated: ${automated.join(" · ")}.` : "Nothing automated yet."} The preview plays your
        changes right away; the render uses the saved lanes.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="rounded-md border border-purple-400/60 bg-purple-600/70 px-3 py-1 text-xs font-semibold text-white hover:bg-purple-600 disabled:opacity-50 disabled:cursor-not-allowed"
          disabled={locked || !changed || problems.length > 0}
          onClick={() => onSave(payload)}
        >
          {saving ? "Saving…" : "Save automation"}
        </button>
        {changed && !locked && (
          <button
            type="button"
            className="border-0 bg-transparent text-xs text-zinc-400 hover:text-zinc-200"
            onClick={onUndo}
          >
            Undo changes
          </button>
        )}
      </div>
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

/** The bar (0-based) whose downbeat is at or before `sec`. */
export function barAtTime(downbeats: number[], sec: number): number {
  let bar = 0;
  for (let i = 0; i < downbeats.length; i += 1) {
    if (downbeats[i] <= sec + 1e-6) bar = i;
    else break;
  }
  return bar;
}

/** A lane's value at a bar (straight lines between points), for a new point. */
function valueAtBar(points: Array<{ bar: number; value: number }>, bar: number): number {
  if (bar <= points[0].bar) return points[0].value;
  for (let i = 1; i < points.length; i += 1) {
    if (bar < points[i].bar) {
      const a = points[i - 1];
      const b = points[i];
      return a.value + ((b.value - a.value) * (bar - a.bar)) / (b.bar - a.bar);
    }
  }
  return points[points.length - 1].value;
}
