import Link from "next/link";
import type { CSSProperties } from "react";
import type { PublicPlaylistSummary } from "../../lib/api";

/**
 * A public playlist as it appears in catalog/discovery grids. Mirrors the
 * release card layout (`ng-resource-card`) so playlists sit naturally beside the
 * other catalog content types, with a 2×2 cover mosaic, owner attribution, and a
 * track count.
 */
export function CatalogPlaylistCard({
  playlist,
  onSelect,
}: {
  playlist: PublicPlaylistSummary;
  onSelect?: (playlist: PublicPlaylistSummary) => void;
}) {
  const owner = playlist.ownerDisplayName?.trim();
  const trackLabel = `${playlist.trackCount} ${playlist.trackCount === 1 ? "track" : "tracks"}`;

  return (
    <Link
      href={`/playlist/${playlist.id}`}
      className="ng-resource-card ng-resource-card__link"
      onClick={onSelect ? () => onSelect(playlist) : undefined}
    >
      <CatalogPlaylistThumb playlist={playlist} />
      <div className="ng-resource-card__body">
        <h4>{playlist.name}</h4>
        <p>{owner ? `by ${owner}` : "Public playlist"}</p>
        <div className="ng-resource-card__meta">
          <span>Playlist</span>
          <span>{trackLabel}</span>
        </div>
      </div>
    </Link>
  );
}

/** Cover art for a playlist: a 2×2 mosaic when there are ≥4 covers, a single
 *  cover for 1–3, and a name monogram when the playlist has no catalog artwork. */
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
