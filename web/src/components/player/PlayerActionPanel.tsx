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
  const primaryKeySet = new Set(PRIMARY_ACTION_KEYS);

  for (const action of actionState.actions) {
    const isPrimaryCandidate = primaryKeySet.has(action.key);
    const isAvailable = action.status === "available";

    if (isPrimaryCandidate && isAvailable) {
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
    (a, b) => PRIMARY_ACTION_KEYS.indexOf(a.key) - PRIMARY_ACTION_KEYS.indexOf(b.key),
  );

  return { primaryActions, unavailableActions };
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
        <div className="player-action-header">
          <div>
            <div className="studio-label">Now Playing Actions</div>
            <p className="player-action-reason">Checking what this track can do right now.</p>
          </div>
        </div>
        <div className="player-action-primary-grid">
          {["Save", "Playlist", "Stems", "License"].map((label) => (
            <button key={label} className="player-action-button is-loading" type="button" disabled>
              <span>{label}</span>
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
      <div className="player-action-header">
        <div>
          <div className="studio-label">Now Playing Actions</div>
          {actionState.recommendation?.summary && (
            <p className="player-action-reason">{actionState.recommendation.summary}</p>
          )}
        </div>
      </div>

      {primaryActions.length > 0 && (
        <div className="player-action-primary-grid" aria-label="Available actions">
          {primaryActions.map((action) => {
            const isSavedAction = action.key === "save" && saved;

            return (
              <button
                key={action.key}
                className={`player-action-button player-action-button--available ${
                  isSavedAction ? "is-saved" : ""
                }`}
                type="button"
                onClick={() => onAction(action)}
                disabled={isSavedAction}
                aria-pressed={isSavedAction || undefined}
                title={action.reason}
              >
                <span>{action.label}</span>
                {action.reason && <small>{action.reason}</small>}
              </button>
            );
          })}
        </div>
      )}

      {unavailableActions.length > 0 && (
        <div className="player-action-unavailable" aria-label="Unavailable and coming soon actions">
          <div className="player-action-unavailable-title">Unavailable / Coming soon</div>
          <div className="player-action-unavailable-list">
            {unavailableActions.map((action) => (
              <div
                key={action.key}
                className={`player-action-unavailable-item player-action-unavailable-item--${action.status}`}
              >
                <span>{action.label}</span>
                <small>{action.reason || "Not available for this track yet."}</small>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
