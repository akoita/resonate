import type { AgentNextPickResponse, AgentSessionLicense } from "./api";
import type { DjPickNote, DjSet } from "./agentDjSet";
import type { LocalTrack } from "./localLibrary";

/** How many upcoming DJ picks the Now & Up next card lists (#2243). */
export const UP_NEXT_COUNT = 3;

/** Shown for a rule-based pick or a fallback; never claims an AI pick (#2075). */
export const RULES_PICK_LABEL = "Picked from your filters";
export const AI_PICK_LABEL = "Picked by the AI curator";
/** Shown when the client has no note on a pick (the session's first picks arrive through history). */
export const UNNOTED_PICK_LABEL = "Picked for this session";

/** Sentences of the shared vocabulary that say nothing a listener can use. */
const UNHELPFUL_REASONS = new Set(["Catalog candidate"]);

/**
 * One plain reason from the server's explanation vocabulary. The pick's free
 * `reason` string can carry model text, so it is never read here.
 */
export function reasonSentence(explanation?: readonly string[]): string | undefined {
    return explanation
        ?.map((line) => (typeof line === "string" ? line.trim() : ""))
        .find((line) => line && !UNHELPFUL_REASONS.has(line));
}

/** What to remember about each pick of a next-pick response, keyed by track id. */
export function pickNotesFromResponse(result: AgentNextPickResponse): Record<string, DjPickNote> {
    const source: DjPickNote["source"] =
        result.curatedBy === "llm" && !result.runtimeFallback ? "ai" : "rules";
    const notes: Record<string, DjPickNote> = {};
    const add = (id: string | undefined, explanation?: readonly string[], requestMatch?: boolean) => {
        if (!id) return;
        const reason = reasonSentence(explanation);
        notes[id] = {
            ...(reason ? { reason } : {}),
            source,
            ...(typeof requestMatch === "boolean" ? { matched: requestMatch } : {}),
        };
    };
    add(result.track?.id, result.explanation);
    for (const pick of result.tracks ?? []) add(pick.trackId, pick.explanation, pick.requestMatch);
    return notes;
}

/**
 * What Session History says about a session's first picks (#2243): the
 * server-kept explanation and who curated them. Picks without either are left out.
 */
export function pickNotesFromLicenses(
    licenses: ReadonlyArray<Pick<AgentSessionLicense, "trackId" | "recommendation">>,
): Record<string, DjPickNote> {
    const notes: Record<string, DjPickNote> = {};
    for (const license of licenses) {
        const summary = license.recommendation;
        const reason = reasonSentence(summary?.recommendation?.explanation);
        const source: DjPickNote["source"] =
            summary?.curatedBy === "llm" ? "ai" : summary?.curatedBy === "rules" ? "rules" : undefined;
        const matched = typeof summary?.requestMatch === "boolean" ? summary.requestMatch : undefined;
        if (!reason && !source && matched === undefined) continue;
        notes[license.trackId] = {
            ...(reason ? { reason } : {}),
            ...(source ? { source } : {}),
            ...(matched !== undefined ? { matched } : {}),
        };
    }
    return notes;
}

/** The kicker for a pick: who chose it, in words that never overclaim. */
export function pickSourceLabel(note?: DjPickNote): string {
    if (!note?.source) return UNNOTED_PICK_LABEL;
    return note.source === "ai" ? AI_PICK_LABEL : RULES_PICK_LABEL;
}

export type UpNextItem = {
    /** The catalog id the DJ set and the server know the track by. */
    id: string;
    title: string;
    artist: string;
    artworkUrl: string | null;
    reason: string | null;
    sourceLabel: string;
    /** Where the track sits in the player queue now. */
    queueIndex: number;
};

export type UpNextView = {
    now: UpNextItem | null;
    upNext: UpNextItem[];
};

const setId = (track: LocalTrack) => track.catalogTrackId || track.id;

function toItem(track: LocalTrack, queueIndex: number, set: DjSet): UpNextItem {
    const id = setId(track);
    const note = set.picks?.[id] ?? set.picks?.[track.id];
    return {
        id,
        title: track.title,
        artist: track.artist?.trim() || track.creditedArtistName?.trim() || track.albumArtist?.trim() || "Unknown artist",
        artworkUrl: track.remoteArtworkUrl || null,
        reason: note?.reason ?? null,
        sourceLabel: pickSourceLabel(note),
        queueIndex,
    };
}

function inSet(track: LocalTrack, set: DjSet): boolean {
    return set.trackIds.includes(track.id) || (!!track.catalogTrackId && set.trackIds.includes(track.catalogTrackId));
}

/**
 * The DJ track playing now and the next DJ picks queued after it. Tracks the
 * listener queued themselves are not the DJ's and are left out.
 */
export function buildUpNext(
    queue: readonly LocalTrack[],
    currentIndex: number,
    set: DjSet | null,
    count: number = UP_NEXT_COUNT,
): UpNextView {
    if (!set) return { now: null, upNext: [] };
    const current = currentIndex >= 0 ? queue[currentIndex] : undefined;
    const now = current && inSet(current, set) ? toItem(current, currentIndex, set) : null;
    const upNext: UpNextItem[] = [];
    for (let index = Math.max(currentIndex + 1, 0); index < queue.length && upNext.length < count; index += 1) {
        const track = queue[index];
        if (inSet(track, set)) upNext.push(toItem(track, index, set));
    }
    return { now, upNext };
}
