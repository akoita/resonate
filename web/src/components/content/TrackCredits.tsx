import Link from "next/link";
import type { KeyboardEvent, MouseEvent } from "react";

export type TrackCreditsProps = {
  artist?: string | null;
  album?: string | null;
  /** Where the artist name leads; plain text when null. */
  artistHref?: string | null;
  /** Where the album name leads; plain text when null. */
  albumHref?: string | null;
  /** Shown when the track has no artist name. */
  artistFallback?: string;
  className?: string;
  /**
   * Set inside a clickable row (queue, playlist): a click or Enter on a link
   * follows it without also playing or selecting the row.
   */
  insideRow?: boolean;
  as?: "p" | "div" | "span";
};

function stopRow(event: MouseEvent | KeyboardEvent) {
  event.stopPropagation();
}

/**
 * The "Artist • Album" line for a track, with each name linking to its page
 * when one is known (Now Playing, the queue, playlist rows).
 */
export function TrackCredits({
  artist,
  album,
  artistHref,
  albumHref,
  artistFallback,
  className,
  insideRow = false,
  as: Tag = "p",
}: TrackCreditsProps) {
  const artistName = artist?.trim() || artistFallback;
  const albumName = album?.trim();
  const rowGuard = insideRow ? { onClick: stopRow, onKeyDown: stopRow } : {};

  return (
    <Tag className={className}>
      {artistName && (artistHref && artist?.trim() ? (
        <Link href={artistHref} className="track-credit-link" title={`Go to ${artistName}`} {...rowGuard}>
          {artistName}
        </Link>
      ) : (
        <span>{artistName}</span>
      ))}
      {artistName && albumName && <span aria-hidden="true"> • </span>}
      {albumName && (albumHref ? (
        <Link href={albumHref} className="track-credit-link" title={`Go to album ${albumName}`} {...rowGuard}>
          {albumName}
        </Link>
      ) : (
        <span>{albumName}</span>
      ))}
    </Tag>
  );
}
