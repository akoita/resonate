"use client";

import { SplitButton } from "../ui/SplitButton";
import { useQueueActions } from "../../lib/useQueueActions";
import type { QueueFeedbackMode } from "../../lib/queueFeedback";
import type { LocalTrack } from "../../lib/localLibrary";

interface QueueActionsButtonProps {
  /**
   * Tracks to queue. Pass a function when the selection is derived per render
   * (release detail) so the mapping only runs on click.
   */
  tracks: LocalTrack[] | (() => LocalTrack[]);
  /** Default-action label; surfaces adapt it to their selection state. */
  label?: string;
  nextLabel?: string;
  disabled?: boolean;
  className?: string;
}

/**
 * The one queue control every listing surface uses. Release, playlist detail
 * and shared playlists each grew their own "Add to queue" + "Play next" pair
 * with hand-rolled toast copy; this collapses them into a single split button
 * with shared wording so the same action reads the same everywhere.
 */
export function QueueActionsButton({
  tracks,
  label = "Add to queue",
  nextLabel = "Play next",
  disabled = false,
  className,
}: QueueActionsButtonProps) {
  const { queue } = useQueueActions();

  const run = (mode: QueueFeedbackMode) => {
    queue(typeof tracks === "function" ? tracks() : tracks, mode);
  };

  return (
    <SplitButton
      className={className}
      variant="ghost"
      label={label}
      menuLabel="More queue actions"
      disabled={disabled}
      icon={<QueueGlyph />}
      onClick={() => run("queue")}
      items={[
        {
          key: "next",
          label: nextLabel,
          description: "Jump the line, right after the current track",
          icon: <NextGlyph />,
          onSelect: () => run("next"),
        },
      ]}
    />
  );
}

function QueueGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="3" y1="6" x2="14" y2="6" />
      <line x1="3" y1="12" x2="14" y2="12" />
      <line x1="3" y1="18" x2="10" y2="18" />
      <line x1="18" y1="11" x2="18" y2="21" />
      <line x1="13" y1="16" x2="23" y2="16" />
    </svg>
  );
}

function NextGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polygon points="4 5 13 12 4 19 4 5" fill="currentColor" stroke="none" />
      <line x1="18" y1="6" x2="18" y2="18" />
    </svg>
  );
}
