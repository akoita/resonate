"use client";

import { useEffect, useRef } from "react";
import type { ReactNode } from "react";

/**
 * Sticky transport for the Remix Studio session view (#1879): play/stop,
 * a position clock, the preview source switch, the loop chip, and the level
 * meter slot. Presentational — the clock polls `getPositionSec` itself so
 * playback never re-renders the bar.
 */

export type RemixTransportSource =
  | { kind: "arrangement" }
  | { kind: "original" }
  | { kind: "draft"; jobId: string | null };

export type RemixTransportSourceChange =
  | { kind: "arrangement" }
  | { kind: "original" }
  | { kind: "draft"; jobId: null };

export type RemixTransportBarProps = {
  status: "idle" | "loading" | "playing";
  getPositionSec: () => number | null;
  durationSec: number | null;
  source: RemixTransportSource;
  hasOriginal: boolean;
  hasDraft: boolean;
  /** e.g. "Looping bar 9"; null = no loop. */
  loopLabel: string | null;
  /** The editor passes <PreviewLevelMeter/>. */
  meter: ReactNode;
  onToggle(): void;
  onSourceChange(source: RemixTransportSourceChange): void;
  onClearLoop(): void;
};

/** m:ss clock text; unknown/invalid → "–:––". */
export function formatTransportClock(sec: number | null): string {
  if (sec === null || !Number.isFinite(sec) || sec < 0) return "–:––";
  const total = Math.floor(sec);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function clockText(position: number | null, durationSec: number | null) {
  return `${formatTransportClock(position ?? 0)} / ${formatTransportClock(durationSec)}`;
}

const SOURCE_OPTIONS: {
  kind: RemixTransportSourceChange["kind"];
  label: string;
  title: string;
}[] = [
  {
    kind: "arrangement",
    label: "Arrangement",
    title: "Hear your stems as arranged here",
  },
  {
    kind: "draft",
    label: "Draft",
    title: "Hear the latest rendered draft",
  },
  {
    kind: "original",
    label: "Original",
    title: "Hear the track's original full mix",
  },
];

function sourceChange(
  kind: RemixTransportSourceChange["kind"],
): RemixTransportSourceChange {
  if (kind === "draft") return { kind: "draft", jobId: null };
  return { kind };
}

export function RemixTransportBar({
  status,
  getPositionSec,
  durationSec,
  source,
  hasOriginal,
  hasDraft,
  loopLabel,
  meter,
  onToggle,
  onSourceChange,
  onClearLoop,
}: RemixTransportBarProps) {
  const options = SOURCE_OPTIONS.filter(
    (option) =>
      option.kind === "arrangement" ||
      (option.kind === "draft" && hasDraft) ||
      (option.kind === "original" && hasOriginal),
  );
  const active = status !== "idle";
  const buttonLabel = active ? "Stop" : "Play";

  return (
    <div className="remix-transport-bar sticky top-0 z-10 flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-zinc-800 bg-zinc-900 px-3 py-2">
      <button
        type="button"
        aria-label={buttonLabel}
        aria-busy={status === "loading"}
        title={
          status === "loading"
            ? "Loading preview… click to cancel"
            : status === "playing"
              ? "Stop"
              : "Play"
        }
        className={`remix-transport-toggle flex h-9 w-9 shrink-0 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-300 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-900 ${
          active
            ? "bg-purple-500 text-white hover:bg-purple-400"
            : "bg-purple-500/90 text-white hover:bg-purple-400"
        }`}
        onClick={onToggle}
      >
        {status === "loading" ? (
          <span
            aria-hidden="true"
            className="remix-transport-spinner h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white"
          />
        ) : status === "playing" ? (
          <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3.5 w-3.5">
            <rect x="3" y="3" width="10" height="10" rx="1.5" fill="currentColor" />
          </svg>
        ) : (
          <svg aria-hidden="true" viewBox="0 0 16 16" className="ml-0.5 h-4 w-4">
            <path d="M4 2.5v11l9.5-5.5z" fill="currentColor" />
          </svg>
        )}
      </button>

      <TransportClock getPositionSec={getPositionSec} durationSec={durationSec} />

      {options.length > 1 && (
        <div
          role="group"
          aria-label="Preview source"
          className="remix-transport-source inline-flex overflow-hidden rounded-md border border-zinc-700"
        >
          {options.map((option) => {
            const pressed = source.kind === option.kind;
            return (
              <button
                key={option.kind}
                type="button"
                aria-pressed={pressed}
                title={option.title}
                className={`px-2.5 py-1 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-purple-300 ${
                  pressed
                    ? "bg-purple-500/25 text-purple-100"
                    : "bg-zinc-900 text-zinc-400 hover:text-zinc-200"
                }`}
                onClick={() => {
                  if (!pressed) onSourceChange(sourceChange(option.kind));
                }}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      )}

      {loopLabel && (
        <span className="remix-transport-loop inline-flex items-center gap-1 rounded-full border border-purple-400/50 bg-purple-500/15 py-0.5 pl-2.5 pr-1 text-xs text-purple-100">
          <span>{loopLabel}</span>
          <button
            type="button"
            aria-label="Clear loop"
            title="Clear loop"
            className="flex h-4 w-4 items-center justify-center rounded-full text-purple-200 hover:bg-purple-400/30 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-300"
            onClick={onClearLoop}
          >
            <span aria-hidden="true">×</span>
          </button>
        </span>
      )}

      <div className="remix-transport-meter ml-auto flex min-w-0 items-center">
        {meter}
      </div>
    </div>
  );
}

/**
 * "m:ss / m:ss" clock. Polls the position every animation frame and writes
 * its own text node, so playback never re-renders the transport bar.
 */
function TransportClock({
  getPositionSec,
  durationSec,
}: {
  getPositionSec: () => number | null;
  durationSec: number | null;
}) {
  const textRef = useRef<HTMLSpanElement>(null);
  const getPositionRef = useRef(getPositionSec);

  useEffect(() => {
    getPositionRef.current = getPositionSec;
  }, [getPositionSec]);

  useEffect(() => {
    let frame = 0;
    let last: string | null = null;
    const tick = () => {
      const next = clockText(getPositionRef.current(), durationSec);
      if (textRef.current && next !== last) {
        textRef.current.textContent = next;
        last = next;
      }
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [durationSec]);

  return (
    <span
      ref={textRef}
      role="timer"
      title="Playback position / length"
      className="remix-transport-clock shrink-0 font-mono text-xs tabular-nums text-zinc-300"
    >
      {clockText(null, durationSec)}
    </span>
  );
}
