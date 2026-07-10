import type { ArtistSocialLinks } from "./api";

/** Ownership check for the "Edit profile" affordance on `/artist/[id]` (#1419). */
export function isArtistProfileOwner(
  me: { id?: string | null } | null | undefined,
  artist: { id?: string | null } | null | undefined,
): boolean {
  return Boolean(me?.id && artist?.id && me.id === artist.id);
}

/** True for absolute http(s) URLs only — rejects `javascript:`, `data:`, bare strings, etc. */
export function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Normalizes a user-entered URL for the artist profile form: trims
 * whitespace, adds an `https://` scheme when the user typed a bare domain
 * (e.g. "instagram.com/artist"), and rejects anything that isn't a genuine
 * http(s) URL (e.g. `javascript:`/`data:` schemes). Returns `null` for a
 * blank input or an unsalvageable value.
 */
export function normalizeSocialUrl(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return null;

  const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed);
  const candidate = hasScheme ? trimmed : `https://${trimmed}`;

  return isValidHttpUrl(candidate) ? candidate : null;
}

export const ARTIST_SOCIAL_LINK_FIELDS = [
  "x",
  "instagram",
  "tiktok",
  "youtube",
  "soundcloud",
] as const;

export type ArtistSocialLinkField = (typeof ARTIST_SOCIAL_LINK_FIELDS)[number];

export const ARTIST_SOCIAL_LINK_LABELS: Record<ArtistSocialLinkField, string> = {
  x: "X",
  instagram: "Instagram",
  tiktok: "TikTok",
  youtube: "YouTube",
  soundcloud: "SoundCloud",
};

export type ArtistProfileFormState = {
  imageUrl: string;
  summary: string;
  website: string;
} & Record<ArtistSocialLinkField, string>;

export function artistProfileFormStateFromProfile(profile: {
  imageUrl?: string | null;
  summary?: string | null;
  website?: string | null;
  socialLinks?: ArtistSocialLinks | null;
}): ArtistProfileFormState {
  const state: ArtistProfileFormState = {
    imageUrl: profile.imageUrl || "",
    summary: profile.summary || "",
    website: profile.website || "",
    x: "",
    instagram: "",
    tiktok: "",
    youtube: "",
    soundcloud: "",
  };
  for (const field of ARTIST_SOCIAL_LINK_FIELDS) {
    state[field] = profile.socialLinks?.[field] || "";
  }
  return state;
}

export type ArtistProfileUpdateBody = {
  imageUrl?: string;
  summary?: string;
  website?: string;
  socialLinks?: ArtistSocialLinks;
};

export type ArtistProfileUpdateResult =
  | { ok: true; body: ArtistProfileUpdateBody }
  | { ok: false; error: string };

/**
 * Validates + normalizes the artist profile edit form into the
 * `PATCH /artists/:id` request body. Rejects the whole submission with a
 * user-facing message if any non-blank URL field fails validation, rather
 * than silently dropping the bad value.
 */
export function buildArtistProfileUpdatePayload(
  form: ArtistProfileFormState,
): ArtistProfileUpdateResult {
  const socialLinks: ArtistSocialLinks = {};
  for (const field of ARTIST_SOCIAL_LINK_FIELDS) {
    const trimmed = form[field].trim();
    if (!trimmed) continue;
    const normalized = normalizeSocialUrl(trimmed);
    if (!normalized) {
      return {
        ok: false,
        error: `Enter a valid web address for ${ARTIST_SOCIAL_LINK_LABELS[field]}, or leave it blank.`,
      };
    }
    socialLinks[field] = normalized;
  }

  let website = "";
  const trimmedWebsite = form.website.trim();
  if (trimmedWebsite) {
    const normalized = normalizeSocialUrl(trimmedWebsite);
    if (!normalized) {
      return { ok: false, error: "Enter a valid web address for your website, or leave it blank." };
    }
    website = normalized;
  }

  return {
    ok: true,
    body: {
      imageUrl: form.imageUrl.trim(),
      summary: form.summary.trim(),
      website,
      socialLinks,
    },
  };
}
