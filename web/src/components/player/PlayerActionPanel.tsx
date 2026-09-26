"use client";

import type {
  PlayerTrackAction,
  PlayerTrackActionKey,
  PlayerTrackActionsResponse,
} from "../../lib/api";

const PRIMARY_ACTION_KEYS: PlayerTrackActionKey[] = [
  "save",
  "add_to_playlist",
  "inspect_stems",
  "buy_license",
  "shows_campaign",
  "remix",
];

export type GroupedPlayerActions = {
  primaryActions: PlayerTrackAction[];
  unavailableActions: PlayerTrackAction[];
};

export function groupPlayerActions(
  actionState: PlayerTrackActionsResponse | null,
  saved = false,
): GroupedPlayerActions {
  if (!actionState) {
    return { primaryActions: [], unavailableActions: [] };
  }

  const primaryActions: PlayerTrackAction[] = [];
  const unavailableActions: PlayerTrackAction[] = [];
  const actionOrder = new Map(actionState.actions.map((action, index) => [action.key, index]));

  for (const action of actionState.actions) {
    const isAvailable = action.status === "available";

    if (isAvailable) {
      primaryActions.push(
        action.key === "save" && saved
          ? { ...action, label: "Saved", reason: "In your library" }
          : action,
      );
      continue;
    }

    unavailableActions.push(action);
  }

  primaryActions.sort(
    (a, b) => {
      const aPriority = PRIMARY_ACTION_KEYS.indexOf(a.key);
      const bPriority = PRIMARY_ACTION_KEYS.indexOf(b.key);
      if (aPriority !== -1 || bPriority !== -1) {
        return (aPriority === -1 ? 99 : aPriority) - (bPriority === -1 ? 99 : bPriority);
      }
      return (actionOrder.get(a.key) ?? 0) - (actionOrder.get(b.key) ?? 0);
    },
  );

  return { primaryActions, unavailableActions };
}

function getActionDetail(action: PlayerTrackAction) {
  if (action.key !== "shows_campaign") return null;

  const title = typeof action.metadata?.title === "string" ? action.metadata.title : null;
  const city = typeof action.metadata?.city === "string" ? action.metadata.city : null;
  const progressPct = typeof action.metadata?.progressPct === "number"
    ? `${action.metadata.progressPct}% funded`
    : null;
  // Campaign titles usually already name a place ("Artist in Brooklyn") —
  // only append the city when the title carries no location of its own.
  const titleNamesPlace = Boolean(
    title && (/ in /i.test(title) || (city && title.toLocaleLowerCase().includes(city.toLocaleLowerCase()))),
  );
  const campaignTitle = title && city && !titleNamesPlace ? `${title} in ${city}` : title;

  return [campaignTitle, progressPct].filter(Boolean).join(" \u00b7 ") || null;
}

/* Compact inline glyphs per action — keeps the action layer to a single
 * row instead of stacked cards, so the queue gets the vertical space. */
function ActionIcon({ k }: { k: PlayerTrackActionKey | string }) {
  const common = {
    width: 17,
    height: 17,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (k) {
    case "save":
      return (<svg {...common}><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" /></svg>);
    case "add_to_playlist":
      return (<svg {...common}><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="14" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /></svg>);
    case "inspect_stems":
      return (<svg {...common}><line x1="4" y1="21" x2="4" y2="14" /><line x1="4" y1="10" x2="4" y2="3" /><line x1="12" y1="21" x2="12" y2="12" /><line x1="12" y1="8" x2="12" y2="3" /><line x1="20" y1="21" x2="20" y2="16" /><line x1="20" y1="12" x2="20" y2="3" /><line x1="1" y1="14" x2="7" y2="14" /><line x1="9" y1="8" x2="15" y2="8" /><line x1="17" y1="16" x2="23" y2="16" /></svg>);
    case "buy_license":
      return (<svg {...common}><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" /><line x1="7" y1="7" x2="7.01" y2="7" /></svg>);
    case "remix":
      // Two crossing arrows (shuffle) — the track re-cut into something new.
      return (<svg {...common}><polyline points="16 3 21 3 21 8" /><line x1="4" y1="20" x2="21" y2="3" /><polyline points="21 16 21 21 16 21" /><line x1="15" y1="15" x2="21" y2="21" /><line x1="4" y1="4" x2="9" y2="9" /></svg>);
    case "shows_campaign":
      // Ticket stub — back a live show.
      return (<svg {...common}><path d="M3 8a2 2 0 0 0 2-2h14a2 2 0 0 0 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 0-2 2H5a2 2 0 0 0-2-2v-2a2 2 0 0 0 0-4z" /><line x1="14" y1="6" x2="14" y2="8" /><line x1="14" y1="11" x2="14" y2="13" /><line x1="14" y1="16" x2="14" y2="18" /></svg>);
    default:
      return (<svg {...common}><circle cx="12" cy="12" r="9" /></svg>);
  }
}

export function PlayerActionPanel({
  actionState,
  loading,
  stale = false,
  saved = false,
  saving = false,
  onAction,
}: {
  actionState: PlayerTrackActionsResponse | null;
  /** First load with nothing to show yet: renders a same-height skeleton. */
  loading: boolean;
  /**
   * `actionState` belongs to the previous track while the current one's
   * actions load. The last layout stays in place (no console jump) but every
   * chip is inert so a click can never act on the wrong track.
   */
  stale?: boolean;
  saved?: boolean;
  saving?: boolean;
  onAction: (action: PlayerTrackAction) => void;
}) {
  if (loading && !actionState) {
    // Reserve the loaded panel's footprint (kicker row, primary row, locked
    // row) so the queue below does not jump when the actions arrive.
    return (
      <section className="player-action-panel is-loading" aria-label="Now Playing actions" aria-busy="true">
        <div className="player-action-kicker-row">
          <div className="studio-label player-action-kicker">Now Playing Actions</div>
        </div>
        <div className="player-action-row">
          {["save", "add_to_playlist", "inspect_stems", "buy_license"].map((k) => (
            <button key={k} className="player-action-chip is-loading" type="button" disabled aria-hidden="true" tabIndex={-1}>
              <ActionIcon k={k} />
            </button>
          ))}
        </div>
        <div className="player-action-locked" aria-hidden="true">
          {[72, 88, 64].map((width) => (
            <span
              key={width}
              className="player-action-lockchip player-action-lockchip--loading"
              style={{ width, opacity: 0.4 }}
            >
              {"\u00a0"}
            </span>
          ))}
        </div>
      </section>
    );
  }

  if (!actionState) {
    return null;
  }

  const { primaryActions, unavailableActions } = groupPlayerActions(actionState, saved);
  const inert = stale || loading;

  return (
    <section
      className={`player-action-panel${inert ? " is-stale" : ""}`}
      aria-label="Now Playing actions"
      aria-busy={inert || undefined}
      style={inert ? { opacity: 0.55, transition: "opacity 0.15s ease" } : { transition: "opacity 0.15s ease" }}
    >
      <div className="player-action-kicker-row">
        <div className="studio-label player-action-kicker">Now Playing Actions</div>
        {actionState.recommendation?.summary && (
          <p className="player-action-reason" title={actionState.recommendation.summary}>
            {actionState.recommendation.summary}
          </p>
        )}
      </div>

      {primaryActions.length > 0 && (
        <div className="player-action-row" aria-label="Available actions">
          {primaryActions.map((action) => {
            const isSavedAction = action.key === "save" && saved;
            const isBusy = saving && action.key === "save";
            const disabled = isBusy || inert;
            const detail = getActionDetail(action);
            const hint = detail || action.reason;
            return (
              <button
                key={action.key}
                className={`player-action-chip ${inert ? "" : "player-action-chip--available"} ${isSavedAction ? "is-saved" : ""} ${isBusy ? "is-busy" : ""}`}
                type="button"
                onClick={() => {
                  if (!disabled) onAction(action);
                }}
                disabled={disabled}
                style={inert ? { cursor: "progress" } : undefined}
                aria-pressed={isSavedAction || undefined}
                aria-busy={isBusy || undefined}
                /* The accessible name has to contain the visible label
                 * (WCAG 2.5.3), so the saved chip extends "Saved" rather than
                 * replacing it with an unrelated "Remove from library". */
                aria-label={isSavedAction ? `${action.label} — remove from library` : undefined}
                title={isSavedAction
                  ? `${action.label} — remove from library`
                  : hint ? `${action.label} — ${hint}` : action.label}
              >
                {isBusy
                  ? <span className="player-action-chip__spinner" aria-hidden="true" />
                  : <ActionIcon k={action.key} />}
                <span className="player-action-chip-copy">
                  <span>{action.label}</span>
                  {detail && <small>{detail}</small>}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {unavailableActions.length > 0 && (
        <div className="player-action-locked" aria-label="Unavailable and coming soon actions">
          {unavailableActions.map((action) => (
            <span
              key={action.key}
              className={`player-action-lockchip player-action-lockchip--${action.status}`}
              title={action.reason || "Not available for this track yet."}
            >
              {action.label}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}
