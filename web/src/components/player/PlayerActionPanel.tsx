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
    default:
      return (<svg {...common}><circle cx="12" cy="12" r="9" /></svg>);
  }
}

export function PlayerActionPanel({
  actionState,
  loading,
  saved = false,
  onAction,
}: {
  actionState: PlayerTrackActionsResponse | null;
  loading: boolean;
  saved?: boolean;
  onAction: (action: PlayerTrackAction) => void;
}) {
  if (loading) {
    return (
      <section className="player-action-panel" aria-label="Now Playing actions" aria-busy="true">
        <div className="studio-label player-action-kicker">Now Playing Actions</div>
        <div className="player-action-row">
          {["save", "add_to_playlist", "inspect_stems", "buy_license"].map((k) => (
            <button key={k} className="player-action-chip is-loading" type="button" disabled>
              <ActionIcon k={k} />
            </button>
          ))}
        </div>
      </section>
    );
  }

  if (!actionState) {
    return null;
  }

  const { primaryActions, unavailableActions } = groupPlayerActions(actionState, saved);

  return (
    <section className="player-action-panel" aria-label="Now Playing actions">
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
            const detail = getActionDetail(action);
            return (
              <button
                key={action.key}
                className={`player-action-chip player-action-chip--available ${isSavedAction ? "is-saved" : ""}`}
                type="button"
                onClick={() => onAction(action)}
                disabled={isSavedAction}
                aria-pressed={isSavedAction || undefined}
                title={detail || action.reason ? `${action.label} — ${detail || action.reason}` : action.label}
              >
                <ActionIcon k={action.key} />
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
