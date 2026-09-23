import Link from "next/link";
import { artistProfileHref, catalogArtistHref } from "../../lib/artistRoutes";
import { formatCount, type CatalogArtistSummary } from "../../lib/catalogDisplay";
import { CatalogMonogram, CatalogReleaseArtwork } from "./CatalogReleaseCard";

/**
 * Credited artist in catalog grids: circular latest-release artwork (else a
 * monogram), the name, pluralized release/stem counts, and the main genre.
 */
export function CatalogArtistCard({
  artist,
  onSelect,
}: {
  artist: CatalogArtistSummary;
  onSelect?: (artist: CatalogArtistSummary) => void;
}) {
  const genre = artist.latestRelease?.genre?.trim() || Array.from(artist.genres)[0];
  const meta = `${formatCount(artist.releaseCount, "release")} · ${formatCount(artist.stemCount, "stem")}`;

  return (
    <Link
      href={artist.artistId ? artistProfileHref(artist.artistId) : catalogArtistHref(artist.name)}
      className="ng-cat-artist"
      onClick={onSelect ? () => onSelect(artist) : undefined}
    >
      <span className="ng-cat-artist__art">
        {artist.latestRelease ? (
          <CatalogArtistArtwork artist={artist} />
        ) : (
          <CatalogMonogram name={artist.name} />
        )}
      </span>
      <span className="ng-cat-artist__name">{artist.name}</span>
      <span className="ng-cat-artist__meta">{meta}</span>
      {genre && <span className="ng-cat-artist__genre">{genre}</span>}
    </Link>
  );
}

function CatalogArtistArtwork({ artist }: { artist: CatalogArtistSummary }) {
  const release = artist.latestRelease;
  if (!release || (!release.artworkUrl && !release.artworkMimeType)) {
    return <CatalogMonogram name={artist.name} />;
  }
  return <CatalogReleaseArtwork release={release} sizes="(max-width: 640px) 45vw, 180px" />;
}
