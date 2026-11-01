import Link from "next/link";
import { artistProfileHref, catalogArtistHref } from "../../lib/artistRoutes";
import { formatCount, type CatalogArtistSummary } from "../../lib/catalogDisplay";
import { CardQueueButton } from "../ui/CardQueueButton";
import { CatalogMonogram, CatalogReleaseArtwork } from "./CatalogReleaseCard";

/**
 * Credited artist in catalog grids: circular latest-release artwork (else a
 * monogram), the name, pluralized release/stem counts, and the main genre.
 * With `queueable`, a hover button over the portrait and a right-click menu
 * queue all of the artist's tracks without opening the profile.
 */
export function CatalogArtistCard({
  artist,
  onSelect,
  queueable = false,
}: {
  artist: CatalogArtistSummary;
  onSelect?: (artist: CatalogArtistSummary) => void;
  /** Offer Play Next / Add to Queue from the card. Needs the player provider. */
  queueable?: boolean;
}) {
  const genre = artist.latestRelease?.genre?.trim() || Array.from(artist.genres)[0];
  const meta = `${formatCount(artist.releaseCount, "release")} · ${formatCount(artist.stemCount, "stem")}`;

  const link = (
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

  if (!queueable) return link;

  // The button is a sibling of the link (never nested in it), laid over the
  // portrait by an overlay box that mirrors the portrait's square.
  return (
    <div className="ng-cat-artist-wrap" data-card-queue="">
      {link}
      <span className="ng-cat-artist__queue">
        <CardQueueButton target={{ kind: "artist", title: artist.name, releases: artist.releases }} />
      </span>
    </div>
  );
}

function CatalogArtistArtwork({ artist }: { artist: CatalogArtistSummary }) {
  const release = artist.latestRelease;
  if (!release || (!release.artworkUrl && !release.artworkMimeType)) {
    return <CatalogMonogram name={artist.name} />;
  }
  return <CatalogReleaseArtwork release={release} sizes="(max-width: 640px) 45vw, 180px" />;
}
