import Link from "next/link";
import type { CSSProperties } from "react";
import type { PublicPlaylistSummary } from "../../lib/api";
import { formatCount } from "../../lib/catalogDisplay";

/**
 * A public playlist as it appears in catalog/discovery grids. Uses the same
 * artwork-first shape as the release card (`ng-cat-card`), with the cover
 * mosaic as the art, owner attribution, and a track count.
 */
export function CatalogPlaylistCard({
  playlist,
  onSelect,
}: {
  playlist: PublicPlaylistSummary;
  onSelect?: (playlist: PublicPlaylistSummary) => void;
}) {
  const owner = playlist.ownerDisplayName?.trim();

  return (
    <article className="ng-cat-card ng-cat-card--playlist">
      <div className="ng-cat-card__art">
        <span className="ng-cat-card__media">
          <CatalogPlaylistThumb playlist={playlist} />
        </span>
      </div>
      <div className="ng-cat-card__body">
        <h3 className="ng-cat-card__title">
          <Link
            href={`/playlist/${playlist.id}`}
            className="ng-cat-card__link"
            onClick={onSelect ? () => onSelect(playlist) : undefined}
          >
            {playlist.name}
          </Link>
        </h3>
        <p className="ng-cat-card__subtitle">{owner ? `by ${owner}` : "Public playlist"}</p>
        <p className="ng-cat-card__meta">{formatCount(playlist.trackCount, "track")}</p>
      </div>
    </article>
  );
}

/** Leading tracks sampled for a playlist's cover mosaic (4 distinct covers). */
export const COVER_TRACK_SAMPLE = 8;

/**
 * Cover URLs for a playlist built from its track ids: distinct artwork of its
 * leading tracks, in playlist order — the same cover set a public playlist
 * shows in the catalog. `coverFor` returns a track's artwork, if known.
 */
export function playlistCoverUrls(
  trackIds: readonly string[],
  coverFor: (trackId: string) => string | null | undefined,
): string[] {
  const covers: string[] = [];
  for (const trackId of trackIds.slice(0, COVER_TRACK_SAMPLE)) {
    const url = coverFor(trackId);
    if (url && !covers.includes(url)) covers.push(url);
    if (covers.length >= 4) break;
  }
  return covers;
}

/** Cover art for a public playlist summary — see `PlaylistCoverThumb`. */
export function CatalogPlaylistThumb({ playlist }: { playlist: PublicPlaylistSummary }) {
  return <PlaylistCoverThumb name={playlist.name} covers={playlist.coverArtworkUrls ?? []} />;
}

/** Cover art for a playlist: a 2×2 mosaic when there are ≥4 covers, a single
 *  cover for 1–3, and a name monogram when the playlist has no artwork. Fills
 *  its container. Shared by public playlists in the catalog and the listener's
 *  own playlists in the library, so a playlist looks the same everywhere. */
export function PlaylistCoverThumb({
  name,
  covers,
}: {
  name: string;
  covers: readonly string[];
}) {
  const monogram = (name.trim()[0] ?? "?").toUpperCase();

  return (
    <span className="ng-playlist-thumb" aria-hidden>
      {covers.length >= 4 ? (
        <span className="ng-playlist-thumb__mosaic">
          {covers.slice(0, 4).map((url, index) => (
            <span
              key={`${url}-${index}`}
              className="ng-playlist-thumb__cell"
              style={{ "--cover": `url(${JSON.stringify(url)})` } as CSSProperties}
            />
          ))}
        </span>
      ) : covers.length >= 1 ? (
        <span
          className="ng-playlist-thumb__single"
          style={{ "--cover": `url(${JSON.stringify(covers[0])})` } as CSSProperties}
        />
      ) : (
        <span className="ng-playlist-thumb__monogram">{monogram}</span>
      )}
      <span className="ng-playlist-thumb__badge">
        <span className="ms-icon">queue_music</span>
      </span>
    </span>
  );
}
