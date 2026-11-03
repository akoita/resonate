"use client";

/**
 * Automation lanes (#2541, Remix Studio Pro, S6e of #1903). Per stem, a
 * level lane (dB) and a filter lane (one DJ filter knob) drawn as points on
 * whole bars; values move in a straight line between points. The preview
 * plays the unsaved lanes; the render applies the saved ones.
 */
import { useEffect, useRef, useState } from "react";
import type { RemixAutomation } from "../../lib/api";
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
  type AutomationLaneName,
} from "../../lib/remixAutomation";

const btn =
  "rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200 hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed";
const field = "rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-100";
const LANES: AutomationLaneName[] = ["level", "filter"];

/** The lane as a line across the song: bar 0 left, the last bar right. */
function LaneCurve({
  points,
  lane,
  barCount,
  playheadBar,
}: {
  points: Array<{ bar: number; value: number }>;
  lane: AutomationLaneName;
  barCount: number;
  playheadBar: number | null;
}) {
  const spec = AUTOMATION_LANES[lane];
  const w = 600;
  const h = 72;
  const pad = 6;
  const span = Math.max(1, barCount - 1);
  const x = (bar: number) => pad + ((w - 2 * pad) * Math.min(bar, span)) / span;
  const y = (value: number) => pad + ((h - 2 * pad) * (spec.max - value)) / (spec.max - spec.min);
  const neutralY = y(spec.neutral);
  const line =
    points.length > 0
      ? [
          `M ${pad} ${y(points[0].value)}`,
          ...points.map((p) => `L ${x(p.bar)} ${y(p.value)}`),
          `L ${w - pad} ${y(points[points.length - 1].value)}`,
        ].join(" ")
      : `M ${pad} ${neutralY} L ${w - pad} ${neutralY}`;
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className="mt-2 h-16 w-full rounded border border-zinc-800 bg-zinc-900/70"
      role="img"
      aria-label={`${spec.label} lane: ${points.length === 0 ? "no points" : `${points.length} point${points.length === 1 ? "" : "s"}`}`}
      preserveAspectRatio="none"
    >
      {Array.from({ length: Math.floor(span / 4) + 1 }, (_, i) => i * 4).map((bar) => (
        <line key={bar} x1={x(bar)} x2={x(bar)} y1={pad} y2={h - pad} stroke="#27272a" strokeWidth={1} />
      ))}
      <line x1={pad} x2={w - pad} y1={neutralY} y2={neutralY} stroke="#3f3f46" strokeDasharray="4 4" strokeWidth={1} />
      {playheadBar !== null && (
        <line x1={x(playheadBar)} x2={x(playheadBar)} y1={0} y2={h} stroke="#a78bfa" strokeWidth={1.5} />
      )}
      <path d={line} fill="none" stroke={points.length > 0 ? "#c084fc" : "#52525b"} strokeWidth={2} />
      {points.map((p) => (
        <circle key={p.bar} cx={x(p.bar)} cy={y(p.value)} r={4} fill="#e9d5ff" />
      ))}
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
    const timer = setInterval(read, 250);
    return () => clearInterval(timer);
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
      <LaneCurve points={points} lane={lane} barCount={barCount} playheadBar={here} />
      {points.length === 0 ? (
        <p className="mt-2 text-zinc-500">
          No {spec.label.toLowerCase()} points on {stemLabel(selected)}. Move the playhead to a bar and add one.
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
