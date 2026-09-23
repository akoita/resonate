import Link from "next/link";
import type { Release } from "../../lib/api";
import { publicReleaseHref } from "../../lib/artistRoutes";
import {
  formatCatalogAge,
  formatReleaseType,
  getArtistName,
  getCatalogReleaseArtworkUrl,
  getCatalogSortTime,
} from "../../lib/catalogDisplay";
import { AiDisclosureBadge } from "../content/AiDisclosureBadge";
import { HomeReleaseArtwork } from "../home/HomeReleaseArtwork";

/*
 * Action icons are rendered as literal ligatures so the Material Symbols subset
 * guard (`lib/iconFontSubset.test.ts`) can prove the font covers them. Add a
 * new action icon here (and to the subset in `app/layout.tsx`).
 */
const CATALOG_CARD_ACTION_ICONS = {
  library_add: <span className="ms-icon" aria-hidden>library_add</span>,
  playlist_add: <span className="ms-icon" aria-hidden>playlist_add</span>,
};

export type CatalogCardActionIcon = keyof typeof CATALOG_CARD_ACTION_ICONS;

export type CatalogCardAction = {
  icon: CatalogCardActionIcon;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  busy?: boolean;
};

const CARD_ARTWORK_SIZES = "(max-width: 640px) 50vw, 220px";

/**
 * Artwork-first release card shared by `/catalog` and the home catalog
 * snapshot. The title link is stretched over the whole card, so the play and
 * secondary action buttons stay sibling interactive elements (never nested in
 * the link).
 */
export function CatalogReleaseCard({
  release,
  onSelect,
  onPlay,
  actions,
}: {
  release: Release;
  onSelect?: (release: Release) => void;
  onPlay?: (release: Release) => void;
  actions?: CatalogCardAction[];
}) {
  const canPlay = Boolean(onPlay) && (release.tracks?.length ?? 0) > 0;
  const addedAt = getCatalogSortTime(release);
  const meta = [
    formatReleaseType(release.type),
    release.genre?.trim() || null,
    addedAt ? formatCatalogAge(addedAt) : null,
  ].filter(Boolean).join(" · ");

  return (
    <article className="ng-cat-card">
      <div className="ng-cat-card__art">
        <span className="ng-cat-card__media">
          <CatalogReleaseArtwork release={release} />
        </span>
        {actions && actions.length > 0 && (
          <div className="ng-cat-card__actions">
            {actions.map((action) => (
              <button
                key={action.label}
                type="button"
                className="ng-cat-card__action"
                onClick={action.onClick}
                disabled={action.disabled || action.busy}
                aria-label={action.label}
                title={action.label}
              >
                {action.busy ? (
                  <span className="ms-icon" aria-hidden>progress_activity</span>
                ) : (
                  CATALOG_CARD_ACTION_ICONS[action.icon]
                )}
              </button>
            ))}
          </div>
        )}
        {canPlay && (
          <button
            type="button"
            className="ng-cat-card__play"
            onClick={() => onPlay?.(release)}
            aria-label={`Play ${release.title}`}
            title={`Play ${release.title}`}
          >
            <span className="ms-icon" data-fill="1" aria-hidden>play_arrow</span>
          </button>
        )}
      </div>
      <div className="ng-cat-card__body">
        <h3 className="ng-cat-card__title">
          <Link
            href={publicReleaseHref(release.id)}
            className="ng-cat-card__link"
            onClick={onSelect ? () => onSelect(release) : undefined}
          >
            {release.title}
          </Link>
        </h3>
        <p className="ng-cat-card__subtitle">{getArtistName(release)}</p>
        <p className="ng-cat-card__meta">{meta}</p>
        <AiDisclosureBadge disclosure={release.aiDisclosure} className="ng-cat-card__ai" />
      </div>
    </article>
  );
}

/** Release cover: optimized canonical artwork when stored, else the explicit
 *  artwork URL, else a title monogram on the brand gradient. */
export function CatalogReleaseArtwork({
  release,
  sizes = CARD_ARTWORK_SIZES,
}: {
  release: Release;
  sizes?: string;
}) {
  if (release.artworkMimeType) {
    return (
      <HomeReleaseArtwork
        releaseId={release.id}
        mimeType={release.artworkMimeType}
        artworkRevision={release.artworkRevision}
        alt=""
        sizes={sizes}
      />
    );
  }
  const artworkUrl = getCatalogReleaseArtworkUrl(release);
  if (artworkUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={artworkUrl} alt="" loading="lazy" decoding="async" />;
  }
  return <CatalogMonogram name={release.title} />;
}

export function CatalogMonogram({ name }: { name?: string | null }) {
  return (
    <span className="ng-cat-monogram" aria-hidden>
      {(name?.trim()[0] ?? "?").toUpperCase()}
    </span>
  );
}
