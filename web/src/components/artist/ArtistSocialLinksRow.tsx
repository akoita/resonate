import type { ArtistSocialLinks } from "../../lib/api";
import { ARTIST_SOCIAL_LINK_FIELDS, ARTIST_SOCIAL_LINK_LABELS } from "../../lib/artistProfileForm";

type ArtistSocialLinksRowProps = {
  website?: string | null;
  socialLinks?: ArtistSocialLinks | null;
};

/**
 * Read-only row of an artist's website + social links (#1419). Renders real,
 * keyboard-focusable anchors that open in a new tab — nothing here is shown
 * unless a URL is actually present.
 */
export function ArtistSocialLinksRow({ website, socialLinks }: ArtistSocialLinksRowProps) {
  const links: Array<{ key: string; href: string; label: string }> = [];

  if (website) {
    links.push({ key: "website", href: website, label: "Website" });
  }
  for (const field of ARTIST_SOCIAL_LINK_FIELDS) {
    const href = socialLinks?.[field];
    if (href) {
      links.push({ key: field, href, label: ARTIST_SOCIAL_LINK_LABELS[field] });
    }
  }

  if (links.length === 0) return null;

  return (
    <div className="artist-social-links">
      {links.map((link) => (
        <a
          key={link.key}
          href={link.href}
          target="_blank"
          rel="noreferrer noopener"
          className="artist-social-link"
        >
          {link.label}
        </a>
      ))}
    </div>
  );
}
