import { sanitizeArtistNames } from "./agent_session_artists";

/**
 * Seeded AI DJ sessions (#2244): a session that starts from "something like
 * this" (a track, an artist or a playlist) and keeps that seed for its whole
 * live session, unlike the one-request "More like this" seed (#2243).
 *
 * The listener's client sends `preferences.seed = { kind, id, label }`. The
 * server never trusts it: it checks the shape, looks the subject up, replaces
 * the label with the catalog's own, and, for a playlist, refuses unless the
 * caller owns it or it is public. What is kept for the live session (in memory,
 * like the other session preferences) is the resolved seed; Session History
 * keeps only its kind and label.
 */

export const SESSION_SEED_KINDS = ["track", "artist", "playlist"] as const;
export type SessionSeedKind = (typeof SESSION_SEED_KINDS)[number];

export const SESSION_SEED_ID_MAX_LENGTH = 100;
export const SESSION_SEED_LABEL_MAX_LENGTH = 120;

export interface SessionSeed {
  kind: SessionSeedKind;
  id: string;
  /** The catalog's own name for the subject (never the client's text). */
  label: string;
}

/** The slice of the seed Session History keeps: no id, so no private playlist is addressable from it. */
export interface SessionSeedFilter {
  kind: SessionSeedKind;
  label: string;
}

/** Seeds by kind for the selector (`AgentSelectorInput.seeds`). */
export interface SessionSeedSelectorSeeds {
  artists?: string[];
  trackIds?: string[];
  playlistId?: string;
}

function isKind(value: unknown): value is SessionSeedKind {
  return typeof value === "string" && (SESSION_SEED_KINDS as readonly string[]).includes(value);
}

export function cleanSeedLabel(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, SESSION_SEED_LABEL_MAX_LENGTH).trim() : "";
}

/**
 * The shape check: `{ kind, id, label? }` with a known kind and a bounded id,
 * or undefined for anything else. Pure; the label is trimmed and bounded.
 */
export function parseSessionSeedShape(raw: unknown): SessionSeed | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const record = raw as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id.trim() : "";
  if (!isKind(record.kind) || !id || id.length > SESSION_SEED_ID_MAX_LENGTH) return undefined;
  return { kind: record.kind, id, label: cleanSeedLabel(record.label) };
}

/** A REMEMBERED seed (already resolved once), or undefined when it is absent, null or malformed. */
export const rememberedSessionSeed = parseSessionSeedShape;

/**
 * The selector seeds a session seed stands for. An artist seed carries the
 * artist's display name (what the artist-seed source matches on); a playlist
 * seed carries the playlist id, which the playlist source re-verifies for the
 * caller on every retrieval.
 */
export function selectorSeedsFor(seed: SessionSeed | undefined): SessionSeedSelectorSeeds | undefined {
  if (!seed) return undefined;
  if (seed.kind === "track") return { trackIds: [seed.id] };
  if (seed.kind === "playlist") return { playlistId: seed.id };
  const artists = sanitizeArtistNames([seed.label]);
  return artists.length > 0 ? { artists } : undefined;
}

/** What Session History stores for the seed. */
export function sessionSeedFilter(seed: { kind?: unknown; label?: unknown } | undefined | null): SessionSeedFilter | undefined {
  if (!seed || !isKind(seed.kind)) return undefined;
  const label = cleanSeedLabel(seed.label);
  return label ? { kind: seed.kind, label } : undefined;
}
