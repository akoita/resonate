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

/** Cover art for a playlist: a 2×2 mosaic when there are ≥4 covers, a single
 *  cover for 1–3, and a name monogram when the playlist has no catalog artwork.
 *  Fills its container. */
export function CatalogPlaylistThumb({ playlist }: { playlist: PublicPlaylistSummary }) {
  const covers = playlist.coverArtworkUrls ?? [];
  const monogram = (playlist.name.trim()[0] ?? "?").toUpperCase();

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
