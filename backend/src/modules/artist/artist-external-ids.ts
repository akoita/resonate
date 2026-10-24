/**
 * #2258 - the durable artist identity signal enrichment leaves behind.
 *
 * When artist enrichment resolves an artist against MusicBrainz (and, through
 * its relationships, Wikidata), the matched identifiers are stored on the
 * `Artist` row with a match confidence and the time of the match. The #2252
 * catalog attestation report reads them as the artist half of its provenance
 * evidence and falls back to URL-host inference when they are absent.
 *
 * These are public reference identifiers about a public artist, not personal
 * data of a listener. They are NOT proof of identity: a person managing the
 * profile picks the MusicBrainz candidate, so the stored confidence compares
 * the profile's display name with the matched record's name.
 */

export const EXTERNAL_ID_MATCH_CONFIDENCES = ["high", "medium", "low"] as const;
export type ExternalIdMatchConfidence = (typeof EXTERNAL_ID_MATCH_CONFIDENCES)[number];

/** Confidences the attestation report accepts as a supporting artist signal. */
export const TRUSTED_EXTERNAL_ID_CONFIDENCES: readonly ExternalIdMatchConfidence[] = [
    "high",
    "medium",
];

export const MUSICBRAINZ_ID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const WIKIDATA_QID_PATTERN = /^Q[1-9][0-9]{0,11}$/;

export function isExternalIdMatchConfidence(
    value: unknown,
): value is ExternalIdMatchConfidence {
    return (
        typeof value === "string"
        && (EXTERNAL_ID_MATCH_CONFIDENCES as readonly string[]).includes(value)
    );
}

function nameTokens(value: string): string[] {
    return value
        .normalize("NFKD")
        .replace(/\p{M}+/gu, "")
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .trim()
        .split(" ")
        .filter((token) => token.length > 0);
}

/**
 * How well the matched MusicBrainz name agrees with the profile's display name.
 *
 * - `high`: the names are equal ignoring case, accents and punctuation.
 * - `medium`: one name is a whole-word run of the other ("Ada Example Band" for
 *   "Ada Example").
 * - `low`: anything else - the person picked a differently named record.
 */
export function externalIdMatchConfidence(
    displayName: string,
    matchedName: string,
): ExternalIdMatchConfidence {
    const profile = nameTokens(displayName);
    const matched = nameTokens(matchedName);
    if (profile.length === 0 || matched.length === 0) return "low";
    if (profile.join(" ") === matched.join(" ")) return "high";
    const [shorter, longer] =
        profile.length <= matched.length ? [profile, matched] : [matched, profile];
    for (let start = 0; start + shorter.length <= longer.length; start += 1) {
        if (shorter.every((token, offset) => longer[start + offset] === token)) {
            return "medium";
        }
    }
    return "low";
}

export type ArtistExternalIds = {
    musicbrainzArtistId: string | null;
    wikidataQid: string | null;
    externalIdMatchConfidence: string | null;
    externalIdMatchedAt: Date | null;
};

export type StoredArtistIdSignal = {
    musicbrainzArtistId: string;
    wikidataQid: string | null;
    confidence: ExternalIdMatchConfidence;
    matchedAt: Date | null;
};

/**
 * The stored ids as an attestation signal, or null when the artist has none or
 * the match is too weak to support provenance (`low`, or a missing/unknown
 * confidence). Malformed stored values are ignored rather than trusted.
 */
export function storedArtistIdSignal(
    artist:
        | {
              musicbrainzArtistId?: string | null;
              wikidataQid?: string | null;
              externalIdMatchConfidence?: string | null;
              externalIdMatchedAt?: Date | null;
          }
        | null
        | undefined,
): StoredArtistIdSignal | null {
    if (!artist) return null;
    const mbid = artist.musicbrainzArtistId;
    if (typeof mbid !== "string" || !MUSICBRAINZ_ID_PATTERN.test(mbid)) return null;
    const confidence = artist.externalIdMatchConfidence;
    if (
        !isExternalIdMatchConfidence(confidence)
        || !TRUSTED_EXTERNAL_ID_CONFIDENCES.includes(confidence)
    ) {
        return null;
    }
    const qid = artist.wikidataQid;
    return {
        musicbrainzArtistId: mbid,
        wikidataQid: typeof qid === "string" && WIKIDATA_QID_PATTERN.test(qid) ? qid : null,
        confidence,
        matchedAt: artist.externalIdMatchedAt ?? null,
    };
}
