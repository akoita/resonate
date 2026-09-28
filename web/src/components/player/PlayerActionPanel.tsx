"use client";

import type {
  PlayerTrackAction,
  PlayerTrackActionKey,
  PlayerTrackActionsResponse,
} from "../../lib/api";

/*
 * Fixed slots (#1913 follow-up): every track shows the same actions in the
 * same places. An action that is not available stays in its slot, dimmed, and
 * explains itself when pressed — it never jumps rows. Availability changing
 * from one track to the next therefore never changes the panel's shape, so the
 * console below it does not move when the listener switches tracks.
 */
export const PRIMARY_ACTION_SLOTS: PlayerTrackActionKey[] = [
  "save",
  "add_to_playlist",
  "inspect_stems",
  "remix",
];

export const SECONDARY_ACTION_SLOTS: PlayerTrackActionKey[] = [
  "buy_license",
  "shows_campaign",
  "artist_room",
  "collect_drop",
];

export type GroupedPlayerActions = {
  /** The four main actions, always in slot order, whatever their status. */
  primaryActions: PlayerTrackAction[];
  /** Commerce/community actions, always in slot order, then any unknown keys. */
  secondaryActions: PlayerTrackAction[];
};

export function groupPlayerActions(
  actionState: PlayerTrackActionsResponse | null,
  saved = false,
): GroupedPlayerActions {
  if (!actionState) {
    return { primaryActions: [], secondaryActions: [] };
  }

  const byKey = new Map(
    actionState.actions.map((action) => [
      action.key,
      action.key === "save" && saved && action.status === "available"
        ? { ...action, label: "Saved", reason: "In your library" }
        : action,
    ]),
  );
  const pick = (keys: PlayerTrackActionKey[]) =>
    keys.map((key) => byKey.get(key)).filter((action): action is PlayerTrackAction => Boolean(action));
  const slotted = new Set<string>([...PRIMARY_ACTION_SLOTS, ...SECONDARY_ACTION_SLOTS]);

  return {
    primaryActions: pick(PRIMARY_ACTION_SLOTS),
    secondaryActions: [
      ...pick(SECONDARY_ACTION_SLOTS),
      ...actionState.actions.filter((action) => !slotted.has(action.key)),
    ],
  };
}

/** Short progress suffix for the one-line secondary pill ("53% funded"). */
function getActionProgress(action: PlayerTrackAction) {
  if (action.key !== "shows_campaign" || action.status !== "available") return null;
  return typeof action.metadata?.progressPct === "number" ? `${action.metadata.progressPct}% funded` : null;
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
    // Same slots and grid as the loaded panel, so nothing below moves when
    // the actions arrive.
    return (
      <section className="player-action-panel is-loading" aria-label="Now Playing actions" aria-busy="true">
        <div className="player-action-kicker-row">
          <div className="studio-label player-action-kicker">Now Playing Actions</div>
        </div>
        <div className="player-action-row" aria-hidden="true">
          {PRIMARY_ACTION_SLOTS.map((k) => (
            <span key={k} className="player-action-chip is-loading">
              <ActionIcon k={k} />
            </span>
          ))}
        </div>
        <div className="player-action-locked" aria-hidden="true">
          {SECONDARY_ACTION_SLOTS.map((k) => (
            <span key={k} className="player-action-lockchip player-action-lockchip--loading">
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

  const { primaryActions, secondaryActions } = groupPlayerActions(actionState, saved);
  const inert = stale || loading;
  const press = (action: PlayerTrackAction) => {
    // Unavailable actions are pressable too: the page explains why.
    if (!inert) onAction(action);
  };

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

      <div className="player-action-row" aria-label="Track actions">
        {primaryActions.map((action) => {
          const available = action.status === "available";
          const isSavedAction = action.key === "save" && saved && available;
          const isBusy = saving && action.key === "save";
          const disabled = isBusy || inert;
          const hint = available ? action.reason : action.reason || "Not available for this track yet.";
          return (
            <button
              key={action.key}
              className={`player-action-chip${available && !inert ? " player-action-chip--available" : ""}${available ? "" : " is-unavailable"}${isSavedAction ? " is-saved" : ""}${isBusy ? " is-busy" : ""}`}
              type="button"
              onClick={() => press(action)}
              disabled={disabled}
              style={inert ? { cursor: "progress" } : undefined}
              aria-disabled={!available || undefined}
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
                <span className="player-action-chip-label">{action.label}</span>
              </span>
            </button>
          );
        })}
      </div>

      {secondaryActions.length > 0 && (
        <div className="player-action-locked" aria-label="More actions">
          {secondaryActions.map((action) => {
            const available = action.status === "available";
            const detail = getActionDetail(action);
            const progress = getActionProgress(action);
            const hint = available
              ? detail || action.reason
              : action.reason || "Not available for this track yet.";
            return (
              <button
                key={action.key}
                type="button"
                className={`player-action-lockchip player-action-lockchip--${available ? "available" : action.status}`}
                onClick={() => press(action)}
                disabled={inert}
                aria-disabled={!available || undefined}
                title={hint ? `${action.label} — ${hint}` : action.label}
              >
                {action.label}
                {progress ? <span className="player-action-lockchip__detail">{` \u00b7 ${progress}`}</span> : null}
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
