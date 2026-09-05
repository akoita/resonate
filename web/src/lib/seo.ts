import type { Metadata } from "next";

/**
 * Centralized metadata primitives for public and private application routes.
 *
 * Metadata is generated on the server, but the values that reach these
 * builders can still come from public API payloads. Keep the normalization
 * defensive: a malformed payload must degrade to useful generic copy rather
 * than becoming a metadata error or exposing an exception message.
 */

export const SITE_NAME = "Resonate";
export const SITE_TAGLINE =
  "Discover, remix, and own music on-chain. Stems, royalties, and an AI DJ — all in one studio.";
export const DEFAULT_SITE_URL = "http://localhost:3001";
export const DEFAULT_SOCIAL_IMAGE = "/default-stem-cover.png";
export const DEFAULT_CHAIN_ID = 11155111;

const HTTP_PROTOCOLS = new Set(["http:", "https:"]);
const PUBLIC_ROBOTS = {
  index: true,
  follow: true,
  noarchive: false,
  noimageindex: false,
  nosnippet: false,
} as const;

/** Explicit policy for authenticated, operator, and draft surfaces. */
export const PRIVATE_ROBOTS = {
  index: false,
  follow: false,
  noarchive: true,
  noimageindex: true,
  nosnippet: true,
} as const;

/** Shared noindex metadata used by every private route layout. */
export const PRIVATE_METADATA: Metadata = {
  robots: PRIVATE_ROBOTS,
  alternates: null,
  openGraph: null,
  twitter: null,
};

export type MetadataPathSegment = string | number | null | undefined;

export type PublicMetadataInput = {
  title?: unknown;
  description?: unknown;
  path?: string | null;
  image?: unknown;
  imageAlt?: unknown;
  openGraphType?: "website" | "article";
  /** Optional override used by pure callers/tests; deployment uses SITE_URL. */
  siteUrl?: string | null;
};

export type PrivateMetadataInput = {
  title?: unknown;
  description?: unknown;
};

/**
 * Normalize a configured site URL to an HTTP(S) origin/base without a trailing
 * slash, query string, or fragment. Invalid configuration intentionally uses
 * the documented local frontend default.
 */
export function normalizeSiteUrl(value?: string | null): string {
  const candidate = typeof value === "string" && value.trim()
    ? value.trim()
    : DEFAULT_SITE_URL;

  try {
    const parsed = new URL(candidate);
    if (!HTTP_PROTOCOLS.has(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password) {
      return DEFAULT_SITE_URL;
    }
    parsed.search = "";
    parsed.hash = "";
    parsed.pathname = parsed.pathname.replace(/\/+$/, "") || "/";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return DEFAULT_SITE_URL;
  }
}

/** Build-time/runtime site base derived from the public deployment setting. */
export const SITE_URL = normalizeSiteUrl(process.env.NEXT_PUBLIC_SITE_URL);
export const SITE_URL_OBJECT = new URL(SITE_URL);

function normalizedText(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

/**
 * Return bounded, single-line metadata text. Non-string or blank values use a
 * caller-provided fallback, and long text is shortened with an ellipsis.
 */
export function safeText(value: unknown, fallback: string, maxLength = 160): string {
  const candidate = normalizedText(value) || normalizedText(fallback);
  if (candidate.length <= maxLength) return candidate;
  if (maxLength <= 1) return candidate.slice(0, Math.max(0, maxLength));
  return `${candidate.slice(0, maxLength - 1).trimEnd()}…`;
}

/** Encode each dynamic route segment while preserving segment boundaries. */
export function canonicalPath(...segments: MetadataPathSegment[]): string {
  const encoded = segments
    .filter((segment): segment is string | number => segment !== null && segment !== undefined && String(segment) !== "")
    .map((segment) => encodeURIComponent(String(segment)))
    .filter(Boolean);
  return encoded.length > 0 ? `/${encoded.join("/")}` : "/";
}

/** Decode a framework route segment without letting malformed escapes throw. */
export function decodePathSegment(value: string | undefined): string {
  if (typeof value !== "string") return "";
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Resolve a route path or absolute URL against the configured site URL. */
export function canonicalUrl(pathOrUrl?: string | null, siteUrl = SITE_URL): string {
  const base = normalizeSiteUrl(siteUrl);
  const candidate = normalizedText(pathOrUrl) || "/";

  try {
    // Canonicals always belong to the configured site, even if a malformed or
    // external value is accidentally passed by a route.
    const isAbsolute = candidate.startsWith("//") || /^[a-z][a-z\d+.-]*:/i.test(candidate);
    const resolved = new URL(candidate, `${base}/`);
    if (isAbsolute && !HTTP_PROTOCOLS.has(resolved.protocol)) {
      return new URL("/", `${base}/`).toString();
    }
    const path = isAbsolute
      ? `${resolved.pathname}${resolved.search}`
      : candidate;
    const parsed = new URL(path, `${base}/`);
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return new URL("/", `${base}/`).toString();
  }
}

/** Resolve an image candidate, rejecting unsafe/unsupported URL schemes. */
export function resolveImageUrl(value: unknown, siteUrl = SITE_URL): string | undefined {
  const candidate = normalizedText(value);
  if (!candidate) return undefined;

  try {
    const parsed = new URL(candidate, `${normalizeSiteUrl(siteUrl)}/`);
    if (!HTTP_PROTOCOLS.has(parsed.protocol)) return undefined;
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return undefined;
  }
}

/** Resolve a supplied image or the shared public social-image fallback. */
export function socialImageUrl(value?: unknown, siteUrl = SITE_URL): string {
  return resolveImageUrl(value, siteUrl) ?? canonicalUrl(DEFAULT_SOCIAL_IMAGE, siteUrl);
}

/**
 * Build complete indexable metadata for a public route. Public robots flags
 * are explicit so a public child route can safely override a private parent
 * layout such as `/community`.
 */
export function publicMetadata(input: PublicMetadataInput = {}): Metadata {
  const siteUrl = normalizeSiteUrl(input.siteUrl ?? SITE_URL);
  const siteUrlObject = new URL(siteUrl);
  const title = safeText(input.title, SITE_NAME, 70);
  const description = safeText(input.description, SITE_TAGLINE, 200);
  const canonical = canonicalUrl(input.path ?? "/", siteUrl);
  const image = socialImageUrl(input.image, siteUrl);
  const imageAlt = safeText(input.imageAlt, title, 120);

  return {
    metadataBase: siteUrlObject,
    title,
    description,
    alternates: { canonical },
    robots: PUBLIC_ROBOTS,
    openGraph: {
      type: input.openGraphType ?? "website",
      url: canonical,
      siteName: SITE_NAME,
      title,
      description,
      images: [{ url: image, alt: imageAlt }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [image],
    },
  };
}

/** Build explicit noindex metadata for private/authenticated surfaces. */
export function privateMetadata(input: PrivateMetadataInput = {}): Metadata {
  const metadata: Metadata = {
    ...PRIVATE_METADATA,
    robots: { ...PRIVATE_ROBOTS },
    description: null,
  };
  if (input.title !== undefined) metadata.title = safeText(input.title, SITE_NAME, 70);
  if (input.description !== undefined) {
    metadata.description = safeText(input.description, SITE_TAGLINE, 200);
  }
  return metadata;
}

/** Match the frontend's current chain selection: Sepolia by default. */
export function configuredChainId(value = process.env.NEXT_PUBLIC_CHAIN_ID): number {
  const candidate = normalizedText(value);
  if (candidate === "31337") return 31337;
  if (candidate === "84532") return 84532;
  if (candidate === "11155111") return 11155111;
  return DEFAULT_CHAIN_ID;
}

// Descriptive aliases keep call sites readable and make the policy primitives
// discoverable for future metadata routes.
export const buildCanonicalUrl = canonicalUrl;
export const buildPublicMetadata = publicMetadata;
export const buildPrivateMetadata = privateMetadata;
