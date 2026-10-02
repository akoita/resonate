"use client";

import Link from "next/link";
import {
  DEFAULT_WATCH_DAYS,
  watchMatchHref,
  watchMatchLabel,
  watchNotifiedNote,
  watchStatusText,
  watchSummaryText,
  WATCH_DURATIONS,
  type WatchAvailability,
} from "../../lib/crateWatch";
import type { CrateWatch } from "../../lib/crates";
import "../../styles/crates.css";

export type CrateWatchViewProps = {
  availability: WatchAvailability;
  watch: CrateWatch;
  /** The length offered when turning watching on. */
  days: number;
  busy: boolean;
  /** A readable failure of the last change, or null. */
  error: string | null;
  onDaysChange: (days: number) => void;
  onTurnOn: () => void;
  onStop: () => void;
};

/**
 * The markup of the watch panel (#1967); the state lives in `CrateWatchPanel`.
 * Watching only notifies: it never buys anything.
 */
export function CrateWatchView({
  availability,
  watch,
  days,
  busy,
  error,
  onDaysChange,
  onTurnOn,
  onStop,
}: CrateWatchViewProps) {
  const watching = watch.mode === "notify";
  const note = watchNotifiedNote(watch.summary);

  return (
    <section className="crates-panel crates-watch-panel" aria-labelledby="crate-watch-heading">
      <h2 id="crate-watch-heading">Watch for new releases</h2>
      <p className="crates-hint">
        Get a notification when a new track fits this crate&rsquo;s filters. Watching only tells
        you about a match; it never buys anything.
      </p>

      {availability === "draft" && !watching ? (
        <p className="crates-notice" data-testid="crate-watch-draft">
          Save the crate to watch it.
        </p>
      ) : null}

      {availability === "denied" && !watching ? (
        <p className="crates-notice" data-testid="crate-watch-denied">
          Watching a crate is part of Crate Pro.
        </p>
      ) : null}

      {availability === "available" || watching ? (
        <div className="crates-watch-control">
          <fieldset className="crates-watch-modes" disabled={busy || availability !== "available"}>
            <legend>Watch mode</legend>
            <label className="crates-watch-mode">
              <input
                type="radio"
                name="crate-watch-mode"
                checked={!watching}
                onChange={() => {
                  if (watching) onStop();
                }}
              />
              <span>Off</span>
            </label>
            <label className="crates-watch-mode">
              <input
                type="radio"
                name="crate-watch-mode"
                checked={watching}
                onChange={() => {
                  if (!watching) onTurnOn();
                }}
              />
              <span>Notify me</span>
            </label>
          </fieldset>

          {!watching ? (
            <div className="crates-field">
              <label htmlFor="crate-watch-days">Watch for</label>
              <select
                id="crate-watch-days"
                className="crates-select"
                value={days}
                disabled={busy || availability !== "available"}
                onChange={(event) => onDaysChange(Number(event.target.value) || DEFAULT_WATCH_DAYS)}
              >
                {WATCH_DURATIONS.map((option) => (
                  <option key={option.days} value={option.days}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          {watching ? (
            <button
              type="button"
              className="crates-btn"
              onClick={onStop}
              disabled={busy}
              data-testid="crate-watch-stop"
            >
              Stop watching
            </button>
          ) : null}
        </div>
      ) : null}

      <p className="crates-hint" role="status" aria-live="polite" data-testid="crate-watch-status">
        {watchStatusText(watch)}
      </p>
      {error ? (
        <p className="crates-error" role="alert">
          {error}
        </p>
      ) : null}

      <div data-testid="crate-watch-summary">
        <p className="crates-watch-summary">
          <strong>{watchSummaryText(watch.summary)}</strong>
        </p>
        {note ? <p className="crates-hint">{note}</p> : null}
      </div>

      {watch.recentMatches.length > 0 ? (
        <>
          <h3 className="crates-watch-subheading" id="crate-watch-matches-heading">
            Recent matches
          </h3>
          <ul className="crates-watch-matches" aria-labelledby="crate-watch-matches-heading">
            {watch.recentMatches.map((match) => {
              const href = watchMatchHref(match);
              const label = watchMatchLabel(match);
              return (
                <li key={match.trackId} data-testid="crate-watch-match">
                  {href ? <Link href={href}>{label}</Link> : <span>{label}</span>}
                  <span className="crates-hint">
                    {" "}
                    &middot;{" "}
                    {new Date(match.matchedAt).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      timeZone: "UTC",
                    })}
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
    </section>
  );
}
