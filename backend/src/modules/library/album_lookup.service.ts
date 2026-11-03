import { BadRequestException, Injectable, ServiceUnavailableException } from "@nestjs/common";
import {
    MUSICBRAINZ_ORIGIN,
    PROVIDER_USER_AGENT,
    scheduleMusicBrainzRequest,
} from "../shared/musicbrainz_queue";

/**
 * "Look up details" for an album of the listener's own files (#2538).
 *
 * CD rips often carry artist, album and track titles but no year, genre or
 * label. The listener can ask MusicBrainz for the album, pick the right
 * release, and the editor fills only the fields that are still empty.
 *
 * Privacy: the request runs from this server, so MusicBrainz sees neither the
 * listener's address nor any account identifier. Only the album artist, album
 * title and track count are sent, and only when the listener clicks. Nothing
 * is stored here; the editor saves the picked values as ordinary overrides.
 */

const MAX_TEXT = 200;
const MAX_MATCHES = 5;
const SEARCH_LIMIT = 10;
const TIMEOUT_MS = 8_000;
const MAX_RESPONSE_BYTES = 1_000_000;
const CACHE_TTL_MS = 6 * 60 * 60 * 1_000;
const CACHE_MAX_ENTRIES = 500;
const MBID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type AlbumLookupQuery = { artist?: string; album?: string; tracks?: string };

export type AlbumLookupMatch = {
    /** MusicBrainz release id. */
    id: string;
    title: string;
    artist: string;
    year: number | null;
    country: string | null;
    label: string | null;
    trackCount: number | null;
    /** True when the release has as many tracks as the listener's album. */
    trackCountMatches: boolean;
    sourceUrl: string;
};

export type AlbumLookupDetails = {
    id: string;
    year: number | null;
    genre: string | null;
    label: string | null;
    sourceUrl: string;
};

type Json = Record<string, unknown>;

class LookupProviderError extends Error {
    constructor(message: string, readonly status?: number, readonly retryAfterMs = 0) {
        super(message);
        this.name = "LookupProviderError";
    }
}

@Injectable()
export class AlbumLookupService {
    private readonly cache = new Map<string, { at: number; value: unknown }>();

    async search(query: AlbumLookupQuery): Promise<{ matches: AlbumLookupMatch[] }> {
        const album = cleanText(query.album);
        const artist = cleanText(query.artist);
        if (!album) throw new BadRequestException("An album title is needed to look it up.");
        if (album.length > MAX_TEXT || artist.length > MAX_TEXT) {
            throw new BadRequestException(`Artist and album must be at most ${MAX_TEXT} characters.`);
        }
        let trackCount: number | null = null;
        if (query.tracks !== undefined && query.tracks !== "") {
            const n = Number(query.tracks);
            if (!Number.isInteger(n) || n < 1 || n > 999) {
                throw new BadRequestException("Track count must be a whole number from 1 to 999.");
            }
            trackCount = n;
        }

        const url = new URL("/ws/2/release", MUSICBRAINZ_ORIGIN);
        url.searchParams.set("query", releaseSearchQuery(artist, album));
        url.searchParams.set("fmt", "json");
        url.searchParams.set("limit", String(SEARCH_LIMIT));

        const data = await this.cached(`search:${url.search}`, () => this.request(url));
        return { matches: rankMatches(parseReleases(data), trackCount).slice(0, MAX_MATCHES) };
    }

    async details(releaseId: string): Promise<AlbumLookupDetails> {
        if (!MBID_PATTERN.test(releaseId)) throw new BadRequestException("Unknown release.");
        const id = releaseId.toLowerCase();
        const url = new URL(`/ws/2/release/${id}`, MUSICBRAINZ_ORIGIN);
        url.searchParams.set("inc", "genres labels release-groups");
        url.searchParams.set("fmt", "json");
        const release = await this.cached(`release:${id}`, () => this.request(url));

        let genre = topGenre(release.genres);
        const group = asRecord(release["release-group"]);
        const groupId = typeof group?.id === "string" && MBID_PATTERN.test(group.id) ? group.id.toLowerCase() : null;
        if (!genre && groupId) {
            // Genres are usually voted on the release group (the album across
            // its editions), not on one pressing.
            const groupUrl = new URL(`/ws/2/release-group/${groupId}`, MUSICBRAINZ_ORIGIN);
            groupUrl.searchParams.set("inc", "genres");
            groupUrl.searchParams.set("fmt", "json");
            try {
                const releaseGroup = await this.cached(`group:${groupId}`, () => this.request(groupUrl));
                genre = topGenre(releaseGroup.genres);
            } catch {
                // The year and label are still worth returning without a genre.
            }
        }

        return {
            id,
            year: yearOf(release.date),
            genre,
            label: firstLabel(release["label-info"]),
            sourceUrl: `${MUSICBRAINZ_ORIGIN}/release/${id}`,
        };
    }

    private async cached(key: string, load: () => Promise<Json>): Promise<Json> {
        const hit = this.cache.get(key);
        if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value as Json;
        const value = await load();
        if (this.cache.size >= CACHE_MAX_ENTRIES) {
            const oldest = this.cache.keys().next().value;
            if (oldest !== undefined) this.cache.delete(oldest);
        }
        this.cache.set(key, { at: Date.now(), value });
        return value;
    }

    private async request(url: URL): Promise<Json> {
        try {
            return await scheduleMusicBrainzRequest(
                () => fetchJson(url),
                (error) => (error instanceof LookupProviderError ? error.retryAfterMs : 0),
            );
        } catch (error) {
            const message = error instanceof LookupProviderError && (error.status === 429 || error.status === 503)
                ? "MusicBrainz is busy right now. Try again in a minute."
                : "MusicBrainz can't be reached right now. Try again later.";
            throw new ServiceUnavailableException(message);
        }
    }
}

/** Lucene query for a release by title and, when known, by credited artist. */
export function releaseSearchQuery(artist: string, album: string): string {
    const phrase = (value: string) => `"${value.replace(/[\\"]/g, (c) => `\\${c}`)}"`;
    return artist ? `release:${phrase(album)} AND artist:${phrase(artist)}` : `release:${phrase(album)}`;
}

/**
 * Releases whose track count matches the listener's album come first; within
 * each group MusicBrainz's own relevance order is kept.
 */
export function rankMatches(matches: AlbumLookupMatch[], trackCount: number | null): AlbumLookupMatch[] {
    const withFlag = matches.map((match, index) => ({
        match: { ...match, trackCountMatches: trackCount !== null && match.trackCount === trackCount },
        index,
    }));
    withFlag.sort((a, b) => Number(b.match.trackCountMatches) - Number(a.match.trackCountMatches) || a.index - b.index);
    return withFlag.map((entry) => entry.match);
}

export function parseReleases(data: Json): AlbumLookupMatch[] {
    const releases = Array.isArray(data.releases) ? data.releases : [];
    const out: AlbumLookupMatch[] = [];
    for (const raw of releases) {
        const release = asRecord(raw);
        if (!release || typeof release.id !== "string" || !MBID_PATTERN.test(release.id)) continue;
        const id = release.id.toLowerCase();
        out.push({
            id,
            title: providerText(release.title),
            artist: artistCredit(release["artist-credit"]),
            year: yearOf(release.date),
            country: typeof release.country === "string" && /^[A-Z]{2}$/.test(release.country) ? release.country : null,
            label: firstLabel(release["label-info"]),
            trackCount: positiveInteger(release["track-count"]),
            trackCountMatches: false,
            sourceUrl: `${MUSICBRAINZ_ORIGIN}/release/${id}`,
        });
    }
    return out;
}

/** The most-voted genre, in title case ("french hip hop" → "French Hip Hop"). */
export function topGenre(input: unknown): string | null {
    if (!Array.isArray(input)) return null;
    let best: { name: string; count: number } | null = null;
    for (const raw of input) {
        const genre = asRecord(raw);
        const name = providerText(genre?.name);
        if (!name) continue;
        const count = typeof genre?.count === "number" ? genre.count : 0;
        if (!best || count > best.count) best = { name, count };
    }
    return best ? best.name.replace(/(^|[\s-])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase()) : null;
}

function artistCredit(input: unknown): string {
    if (!Array.isArray(input)) return "";
    return input
        .map((raw) => {
            const credit = asRecord(raw);
            return `${providerText(credit?.name)}${typeof credit?.joinphrase === "string" ? credit.joinphrase : ""}`;
        })
        .join("")
        .trim()
        .slice(0, MAX_TEXT);
}

function firstLabel(input: unknown): string | null {
    if (!Array.isArray(input)) return null;
    for (const raw of input) {
        const name = providerText(asRecord(asRecord(raw)?.label)?.name);
        // "[no label]" is MusicBrainz's placeholder for self-released records.
        if (name && name.toLowerCase() !== "[no label]") return name;
    }
    return null;
}

function yearOf(input: unknown): number | null {
    if (typeof input !== "string") return null;
    const match = /^(\d{4})/.exec(input);
    if (!match) return null;
    const year = Number(match[1]);
    return year >= 1000 && year <= 2999 ? year : null;
}

function positiveInteger(input: unknown): number | null {
    return typeof input === "number" && Number.isInteger(input) && input > 0 ? input : null;
}

function providerText(input: unknown): string {
    return typeof input === "string" ? input.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, MAX_TEXT) : "";
}

function cleanText(input: unknown): string {
    return typeof input === "string" ? input.replace(/\s+/g, " ").trim() : "";
}

function asRecord(input: unknown): Json | null {
    return input && typeof input === "object" && !Array.isArray(input) ? (input as Json) : null;
}

async function fetchJson(url: URL): Promise<Json> {
    if (url.origin !== MUSICBRAINZ_ORIGIN) throw new LookupProviderError("Provider URL origin was not allowed");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
        let response: Response;
        try {
            response = await fetch(url, {
                method: "GET",
                headers: { Accept: "application/json", "User-Agent": PROVIDER_USER_AGENT },
                redirect: "error",
                signal: controller.signal,
            });
        } catch {
            throw new LookupProviderError("Provider request failed");
        }
        if (!response.ok) {
            throw new LookupProviderError(`Provider returned ${response.status}`, response.status, retryAfter(response.headers.get("retry-after")));
        }
        const declared = Number(response.headers.get("content-length"));
        if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
            throw new LookupProviderError("Provider response exceeded the size limit");
        }
        const text = await response.text();
        if (text.length > MAX_RESPONSE_BYTES) throw new LookupProviderError("Provider response exceeded the size limit");
        let parsed: unknown;
        try {
            parsed = JSON.parse(text);
        } catch {
            throw new LookupProviderError("Provider returned malformed JSON");
        }
        const record = asRecord(parsed);
        if (!record) throw new LookupProviderError("Provider response was not an object");
        return record;
    } finally {
        clearTimeout(timeout);
    }
}

function retryAfter(value: string | null): number {
    const seconds = Number(value);
    return Number.isFinite(seconds) && seconds > 0 ? Math.min(60_000, seconds * 1_000) : 0;
}
