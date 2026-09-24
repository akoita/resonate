"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";

/*
 * Home v3 Tuner — the genre/mood filter and the one-tap vibe session in one
 * panel. Replaces the old chip row and the separate "Vibe session" strip.
 *
 * - The greeting is computed after hydration so server and first client
 *   render agree ("Tune your home"), then it switches to the listener's
 *   local time.
 * - The energy meter is decorative (aria-hidden); its readable caption states
 *   the active filter's energy.
 * - The deck action is always real: "Open AI DJ" links to /agent for the
 *   all filter; any other filter starts a vibe session via `onStartSession`.
 */

export type TunerFilter = {
  id: string;
  label: string;
  kind: "all" | "genre" | "mood";
  energy?: "low" | "medium" | "high";
};

const ENERGY_LABEL: Record<"low" | "medium" | "high", string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
};

const EQ_BARS = [0, 1, 2, 3, 4, 5, 6];

/** Re-check the hour once a minute so a long-open tab keeps the right greeting. */
function subscribeToClock(onChange: () => void): () => void {
  const timer = window.setInterval(onChange, 60_000);
  return () => window.clearInterval(timer);
}

function readLocalHour(): number {
  return new Date().getHours();
}

function readServerHour(): null {
  return null;
}

export function greetingForHour(hour: number): string {
  if (hour >= 5 && hour < 12) return "Good morning";
  if (hour >= 12 && hour < 18) return "Good afternoon";
  if (hour >= 18 && hour < 23) return "Good evening";
  return "Late night";
}

export function HomeTuner({
  filters,
  activeId,
  onSelect,
  matchCount,
  starting,
  onStartSession,
}: {
  filters: TunerFilter[];
  activeId: string;
  onSelect: (id: string) => void;
  matchCount: number;
  starting: boolean;
  onStartSession: () => void;
}) {
  // Server snapshot is null, so SSR and hydration render "Tune your home";
  // the client then switches to the local-time greeting (no mismatch).
  const hour = useSyncExternalStore(subscribeToClock, readLocalHour, readServerHour);
  const greeting = hour === null ? "Tune your home" : greetingForHour(hour);

  const active = filters.find((filter) => filter.id === activeId) ?? filters[0];
  const isAll = !active || active.kind === "all";
  const energy = isAll ? "medium" : active.energy ?? "medium";
  const allFilters = filters.filter((filter) => filter.kind === "all");
  const genreFilters = filters.filter((filter) => filter.kind === "genre");
  const moodFilters = filters.filter((filter) => filter.kind === "mood");

  const renderChip = (filter: TunerFilter) => {
    const selected = filter.id === activeId;
    return (
      <button
        key={filter.id}
        type="button"
        aria-pressed={selected}
        onClick={() => onSelect(filter.id)}
        className={`ng-chip ${selected ? "ng-chip--active" : ""}`}
      >
        {filter.label}
      </button>
    );
  };

  return (
    <section className="ng-tuner" aria-label="Tune your home">
      <div className="ng-tuner__intro">
        <span className="ng-kicker ng-kicker--primary">Tune in</span>
        <h2 className="ng-tuner__title">{greeting}</h2>
        <p className="ng-tuner__sub" aria-live="polite">
          {isAll
            ? "Pick a genre or mood — the shelves below retune to match."
            : `${matchCount} catalog match${matchCount === 1 ? "" : "es"} for ${active.label}.`}
        </p>
      </div>

      <div className="ng-tuner__groups" role="group" aria-label="Filter trending">
        {allFilters.length + genreFilters.length > 0 ? (
          <div className="ng-tuner__row">
            <span className="ng-tuner__label">Genre</span>
            {/* "All" resets both groups; it leads the first row. */}
            <div className="ng-tuner__chips">{[...allFilters, ...genreFilters].map(renderChip)}</div>
          </div>
        ) : null}
        {moodFilters.length > 0 ? (
          <div className="ng-tuner__row">
            <span className="ng-tuner__label">Mood</span>
            <div className="ng-tuner__chips">{moodFilters.map(renderChip)}</div>
          </div>
        ) : null}
      </div>

      <div className="ng-tuner__deck">
        <div className="ng-tuner__meter">
          <div className="ng-tuner__eq" data-energy={energy} aria-hidden>
            {EQ_BARS.map((bar) => (
              <span key={bar} />
            ))}
          </div>
          <span className="ng-tuner__energy">Energy · {ENERGY_LABEL[energy]}</span>
        </div>
        {isAll ? (
          <Link href="/agent" className="ng-btn ng-btn--glass ng-tuner__action">
            <span className="ms-icon" aria-hidden>auto_awesome</span>
            Open AI DJ
          </Link>
        ) : (
          <button
            type="button"
            className="ng-btn ng-btn--primary ng-tuner__action"
            onClick={onStartSession}
            disabled={starting}
          >
            <span className="ms-icon" data-fill="1" aria-hidden>
              {starting ? "hourglass_top" : "play_arrow"}
            </span>
            {starting ? "Starting…" : `Start ${active.label} session`}
          </button>
        )}
      </div>
    </section>
  );
}
