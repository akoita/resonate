// The deployed commit SHA is the only build identity next.config.js can
// inject, but the tag that names a release is created *after* the image
// is built (the release flow deploys a SHA, then tags that same SHA), so
// build-time injection would be empty for exactly the builds that matter.
// The tag is therefore resolved from the GitHub API when the About dialog
// is viewed. Resolution is unauthenticated and rate-limited, so every
// failure degrades silently to the plain commit link the dialog already
// showed — a build identity is never worth an error surface.

import { REPO_URL } from "./buildInfo";

export type DeployedRelease =
  | { kind: "release"; name: string; url: string }
  | { kind: "tag"; name: string; url: string };

type FetchLike = (
  input: string,
  init?: { headers?: Record<string, string> },
) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

interface StorageLike {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

export interface ResolveDeployedReleaseOptions {
  // Injected by tests so resolution never touches globals.
  fetch?: FetchLike;
  storage?: StorageLike | null;
}

// Derived from the canonical repo URL rather than restating owner/name.
const REPO_SLUG = REPO_URL.replace(/^https?:\/\/github\.com\//, "").replace(
  /\/+$/,
  "",
);
const API_BASE = `https://api.github.com/repos/${REPO_SLUG}`;
const API_HEADERS = { Accept: "application/vnd.github+json" };
const CACHE_PREFIX = "resonate.releaseIdentity.";

function defaultStorage(): StorageLike | null {
  try {
    if (typeof window === "undefined") return null;
    return window.sessionStorage;
  } catch {
    // Storage access itself throws in some privacy modes.
    return null;
  }
}

function isDeployedRelease(value: unknown): value is DeployedRelease {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    (candidate.kind === "release" || candidate.kind === "tag") &&
    typeof candidate.name === "string" &&
    typeof candidate.url === "string"
  );
}

// Negative results are cached too: a rate-limited viewer should not
// re-request on every open.
function readCache(
  storage: StorageLike | null,
  key: string,
): { hit: boolean; value: DeployedRelease | null } {
  if (!storage) return { hit: false, value: null };
  try {
    const raw = storage.getItem(key);
    if (raw === null) return { hit: false, value: null };
    const parsed: unknown = JSON.parse(raw);
    return { hit: true, value: isDeployedRelease(parsed) ? parsed : null };
  } catch {
    return { hit: false, value: null };
  }
}

function writeCache(
  storage: StorageLike | null,
  key: string,
  value: DeployedRelease | null,
): void {
  if (!storage) return;
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota or a disabled store — the lookup simply repeats next time.
  }
}

async function lookup(
  sha: string,
  doFetch: FetchLike,
): Promise<DeployedRelease | null> {
  try {
    // Fewer than 20 tags exist; one page covers the whole repository.
    const tagsResponse = await doFetch(`${API_BASE}/tags?per_page=100`, {
      headers: API_HEADERS,
    });
    if (!tagsResponse.ok) return null;
    const tags: unknown = await tagsResponse.json();
    if (!Array.isArray(tags)) return null;

    const prefix = sha.toLowerCase();
    const match = tags.find((tag) => {
      const entry = tag as { name?: unknown; commit?: { sha?: unknown } };
      return (
        typeof entry?.name === "string" &&
        typeof entry.commit?.sha === "string" &&
        entry.commit.sha.toLowerCase().startsWith(prefix)
      );
    }) as { name: string } | undefined;
    if (!match) return null;

    const name = match.name;
    const releaseResponse = await doFetch(
      `${API_BASE}/releases/tags/${encodeURIComponent(name)}`,
      { headers: API_HEADERS },
    );
    if (releaseResponse.ok) {
      const release = (await releaseResponse.json()) as {
        html_url?: unknown;
      } | null;
      if (release && typeof release.html_url === "string") {
        return { kind: "release", name, url: release.html_url };
      }
    }

    // No published release for this tag. The tag tree page still pins the
    // exact build; /releases/tag/<name> would 404.
    return {
      kind: "tag",
      name,
      url: `${REPO_URL}/tree/${encodeURIComponent(name)}`,
    };
  } catch {
    // Offline, CORS, malformed JSON, aborted request — all mean "unknown".
    return null;
  }
}

/**
 * Resolve the tag or GitHub release that points at the deployed commit.
 * Returns null when nothing matches or the lookup fails for any reason;
 * callers fall back to the commit link.
 */
export async function resolveDeployedRelease(
  sha: string,
  options: ResolveDeployedReleaseOptions = {},
): Promise<DeployedRelease | null> {
  const commit = (sha ?? "").trim();
  if (!commit) return null;

  const storage =
    options.storage === undefined ? defaultStorage() : options.storage;
  const key = `${CACHE_PREFIX}${commit.toLowerCase()}`;
  const cached = readCache(storage, key);
  if (cached.hit) return cached.value;

  const doFetch =
    options.fetch ??
    (typeof globalThis.fetch === "function"
      ? (globalThis.fetch.bind(globalThis) as unknown as FetchLike)
      : null);
  if (!doFetch) return null;

  const resolved = await lookup(commit, doFetch);
  writeCache(storage, key, resolved);
  return resolved;
}
