import Link from "next/link";
import { publicReleaseHref } from "../../lib/artistRoutes";
import {
  formatCount,
  formatStemType,
  type CatalogStemTrackGroup,
} from "../../lib/catalogDisplay";
import { CatalogMonogram } from "./CatalogReleaseCard";

/**
 * One catalog row per track with its stem types as tags, linking to the
 * release mixer. Rows are meant to sit together in a `.ng-cat-stem-list` panel.
 */
export function CatalogStemTrackRow({
  group,
  onSelect,
}: {
  group: CatalogStemTrackGroup;
  onSelect?: (group: CatalogStemTrackGroup) => void;
}) {
  return (
    <Link
      href={`${publicReleaseHref(group.releaseId)}?mixer=true`}
      className="ng-cat-stem"
      onClick={onSelect ? () => onSelect(group) : undefined}
    >
      <span className="ng-cat-stem__thumb">
        {group.artworkUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={group.artworkUrl} alt="" loading="lazy" decoding="async" />
        ) : (
          <CatalogMonogram name={group.trackTitle} />
        )}
      </span>
      <span className="ng-cat-stem__main">
        <span className="ng-cat-stem__title">{group.trackTitle}</span>
        <span className="ng-cat-stem__sub">{group.releaseTitle} · {group.artistName}</span>
      </span>
      <span className="ng-cat-stem__tags">
        {group.stemTypes.map((type) => (
          <span key={type} className="ng-cat-stem__tag">{formatStemType(type)}</span>
        ))}
      </span>
      <span className="ng-cat-stem__count">{formatCount(group.stemCount, "stem")}</span>
    </Link>
  );
}
