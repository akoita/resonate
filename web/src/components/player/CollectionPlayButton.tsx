"use client";

import { useMemo, type ReactNode } from "react";
import { usePlayer } from "../../lib/playerContext";
import { isCollectionActive } from "../../lib/collectionPlayback";
import { Button } from "../ui/Button";
import { PauseIcon, PlayIcon } from "../ui/MenuIcons";

type CollectionPlayButtonProps = {
  /** Ids of the tracks this collection plays (track id or catalog track id). */
  trackIds: readonly string[];
  /** Set for playlists, so a queue edited after starting it still counts. */
  playlistId?: string;
  /** Starts the collection from the top. Called only when it isn't the one playing. */
  onPlay: () => void;
  /** Label while the collection isn't playing, such as "Play" or "Play all". */
  label?: ReactNode;
  /** Name for screen readers, such as "Hip-Hop", read as "Play Hip-Hop". */
  collectionName?: string;
  className?: string;
  disabled?: boolean;
};

/**
 * The Play button in a collection header. While this collection is what the
 * player is playing it becomes Pause, and once paused it becomes Resume,
 * which carries on from where the listener stopped instead of starting over.
 */
export function CollectionPlayButton({
  trackIds,
  playlistId,
  onPlay,
  label = "Play",
  collectionName,
  className,
  disabled,
}: CollectionPlayButtonProps) {
  const { queue, currentTrack, queueSource, isPlaying, togglePlay } = usePlayer();
  const active = useMemo(
    () => isCollectionActive({ queue, currentTrack, queueSource }, { trackIds, playlistId }),
    [queue, currentTrack, queueSource, trackIds, playlistId],
  );
  const state = !active ? "idle" : isPlaying ? "playing" : "paused";
  const text = state === "playing" ? "Pause" : state === "paused" ? "Resume" : label;
  const name = collectionName ? ` ${collectionName}` : "";
  const ariaLabel = typeof text === "string" && name ? `${text}${name}` : undefined;

  return (
    <Button
      variant="primary"
      className={className ? `collection-play-btn ${className}` : "collection-play-btn"}
      disabled={disabled}
      data-playback-state={state}
      aria-label={ariaLabel}
      onClick={() => (active ? togglePlay() : onPlay())}
    >
      {state === "playing" ? <PauseIcon /> : <PlayIcon />}
      <span>{text}</span>
    </Button>
  );
}
