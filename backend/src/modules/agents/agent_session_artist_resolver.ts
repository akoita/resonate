import { Injectable } from "@nestjs/common";
import { prisma } from "../../db/prisma";
import {
  buildArtistNameIndex,
  findArtistMentions,
  matchArtistName,
  SESSION_ARTIST_MAX,
  type ArtistMention,
  type ArtistNameIndex,
} from "./agent_session_artists";

/** Releases a listener can hear: the same statuses the embedding pipeline serves. */
const LISTENABLE_RELEASE_STATUSES = ["ready", "published"];
/** Names read per source; bounds memory on a very large catalog. */
const INDEX_NAME_LIMIT = 20_000;
const INDEX_TTL_MS = 5 * 60_000;

/** What the session parser needs from the catalog; faked in unit tests. */
export interface SessionArtistResolver {
  /** Cued artist mentions in a sentence ("like X", "X-style"), as the catalog spells them. */
  mentionsIn(text: string): Promise<ArtistMention[]>;
  /** Catalog spellings of free names (a model's answer): exact or one conservative near match. */
  resolveNames(names: readonly string[]): Promise<string[]>;
}

/**
 * Resolves artist names against the catalog's CREDITED names: a release's
 * `primaryArtist`, or the artist account's display name when none is credited.
 * The name index is read from Postgres at most once every few minutes, and the
 * sentence never reaches the database: only the in-memory index is searched.
 */
@Injectable()
export class AgentSessionArtistResolver implements SessionArtistResolver {
  private cached: { index: ArtistNameIndex; loadedAt: number } | undefined;
  private loading: Promise<ArtistNameIndex> | undefined;

  async mentionsIn(text: string): Promise<ArtistMention[]> {
    try {
      return findArtistMentions(text, await this.index());
    } catch {
      // Fails open: without the catalog the sentence is read by the other rules only.
      return [];
    }
  }

  async resolveNames(names: readonly string[]): Promise<string[]> {
    let index: ArtistNameIndex;
    try {
      index = await this.index();
    } catch {
      return [];
    }
    const resolved: string[] = [];
    for (const name of names) {
      const match = matchArtistName(name, index);
      if (match && !resolved.includes(match)) resolved.push(match);
      if (resolved.length >= SESSION_ARTIST_MAX) break;
    }
    return resolved;
  }

  private async index(): Promise<ArtistNameIndex> {
    if (this.cached && Date.now() - this.cached.loadedAt < INDEX_TTL_MS) return this.cached.index;
    this.loading ??= this.load().finally(() => {
      this.loading = undefined;
    });
    return this.loading;
  }

  private async load(): Promise<ArtistNameIndex> {
    const release = { status: { in: LISTENABLE_RELEASE_STATUSES } };
    const [credited, accounts] = await Promise.all([
      prisma.release.findMany({
        where: { ...release, primaryArtist: { not: null } },
        distinct: ["primaryArtist"],
        select: { primaryArtist: true },
        take: INDEX_NAME_LIMIT,
      }),
      prisma.artist.findMany({
        where: { releases: { some: { ...release, OR: [{ primaryArtist: null }, { primaryArtist: "" }] } } },
        select: { displayName: true },
        take: INDEX_NAME_LIMIT,
      }),
    ]);
    const index = buildArtistNameIndex([
      ...credited.map((row) => row.primaryArtist ?? ""),
      ...accounts.map((row) => row.displayName),
    ]);
    this.cached = { index, loadedAt: Date.now() };
    return index;
  }
}
