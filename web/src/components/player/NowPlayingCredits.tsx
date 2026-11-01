import Link from "next/link";

export type NowPlayingCreditsProps = {
  artist?: string | null;
  album?: string | null;
  /** Catalog release id; when known the album name opens its release page. */
  releaseId?: string | null;
  /** Catalog artist id; when known the artist name opens their artist page. */
  artistId?: string | null;
  className?: string;
};

/** Path to a catalog release page, or null when the track has no release. */
export function nowPlayingReleaseHref(releaseId?: string | null): string | null {
  const id = releaseId?.trim();
  return id ? `/release/${encodeURIComponent(id)}` : null;
}

/** Path to a catalog artist page, or null when the track has no artist id. */
export function nowPlayingArtistHref(artistId?: string | null): string | null {
  const id = artistId?.trim();
  return id ? `/artist/${encodeURIComponent(id)}` : null;
}

/**
 * The "Artist • Album" line under the now-playing title. Catalog tracks link
 * the album to its release page and the artist to their page; files from the
 * listener's own library have no such pages, so they stay plain text.
 */
export function NowPlayingCredits({ artist, album, releaseId, artistId, className }: NowPlayingCreditsProps) {
  const releaseHref = nowPlayingReleaseHref(releaseId);
  const artistHref = nowPlayingArtistHref(artistId);
  const artistName = artist?.trim();
  const albumName = album?.trim();

  return (
    <p className={className}>
      {artistName && (artistHref ? (
        <Link href={artistHref} className="hero-credit-link" title={`Go to ${artistName}`}>
          {artistName}
        </Link>
      ) : (
        <span>{artistName}</span>
      ))}
      {artistName && albumName && <span aria-hidden="true"> • </span>}
      {albumName && (releaseHref ? (
        <Link href={releaseHref} className="hero-credit-link" title={`Go to album ${albumName}`}>
          {albumName}
        </Link>
      ) : (
        <span>{albumName}</span>
      ))}
    </p>
  );
}
