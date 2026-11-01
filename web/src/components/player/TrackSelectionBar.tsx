"use client";

import type { ContextMenuItem } from "../ui/ContextMenu";
import { ClearIcon } from "../ui/MenuIcons";

/**
 * What can be done to the tracks selected in a list, shown above it while a
 * selection exists. The same items fill the right-click menu on a selected
 * row, so the bar and the menu never disagree.
 */
export function TrackSelectionBar({
  count,
  items,
  onClear,
  compact = false,
}: {
  count: number;
  items: ContextMenuItem[];
  onClear: () => void;
  /** Icon-only buttons (labels move to tooltips), for the narrow player console. */
  compact?: boolean;
}) {
  if (count === 0) return null;
  return (
    <div className={`track-selection-bar ${compact ? "is-compact" : ""}`} role="toolbar" aria-label={`${count} selected track${count === 1 ? "" : "s"}`}>
      <span className="track-selection-bar__count" aria-live="polite">
        {count} selected
      </span>
      <div className="track-selection-bar__actions">
        {items.filter((item) => !item.separator).map((item) => (
          <button
            key={item.label}
            type="button"
            className={`track-selection-bar__action ${item.variant === "destructive" ? "is-destructive" : ""}`}
            onClick={item.onClick}
            disabled={item.disabled}
            title={item.label}
            aria-label={compact ? item.label : undefined}
          >
            {item.icon ? <span className="track-selection-bar__icon" aria-hidden="true">{item.icon}</span> : null}
            {compact ? null : <span>{item.label}</span>}
          </button>
        ))}
      </div>
      <button
        type="button"
        className="track-selection-bar__action track-selection-bar__clear"
        onClick={onClear}
        title="Clear selection (Esc)"
        aria-label="Clear selection"
      >
        <ClearIcon />
      </button>
    </div>
  );
}
