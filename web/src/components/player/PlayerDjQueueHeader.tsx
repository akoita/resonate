"use client";

import Link from "next/link";
import { describeDjSetRequest } from "../../lib/agentDjRequestSummary";
import { useDjSet, type DjSet } from "../../lib/agentDjSet";
import type { LocalTrack } from "../../lib/localLibrary";

/** The catalog id the DJ set knows a queued track by. */
export function queueTrackCatalogId(track: Pick<LocalTrack, "id" | "catalogTrackId">): string {
    return track.catalogTrackId || track.id;
}

/** True when the track is one of the live set's picks (the same test playback attribution uses). */
export function isDjSetTrack(set: Pick<DjSet, "trackIds"> | null, track: Pick<LocalTrack, "id" | "catalogTrackId">): boolean {
    return Boolean(set?.trackIds.includes(queueTrackCatalogId(track)));
}

/** True when at least one queued track belongs to the live DJ set. */
export function queueHoldsDjSet(set: Pick<DjSet, "trackIds"> | null, queue: ReadonlyArray<Pick<LocalTrack, "id" | "catalogTrackId">>): boolean {
    return Boolean(set) && queue.some((track) => isDjSetTrack(set, track));
}

type ViewProps = {
    set: DjSet | null;
    queue: ReadonlyArray<Pick<LocalTrack, "id" | "catalogTrackId">>;
};

/** The header itself; renders nothing without a set or without any of its tracks in the queue. */
export function PlayerDjQueueHeaderView({ set, queue }: ViewProps) {
    if (!set || !queueHoldsDjSet(set, queue)) return null;
    return (
        <div className="queue-dj-header" data-testid="queue-dj-header">
            <span className="queue-dj-orb" aria-hidden="true">
                <span className="queue-dj-live" />
            </span>
            <div className="queue-dj-header-text">
                <span className="queue-dj-header-title">AI DJ</span>
                <span className="queue-dj-header-summary">{describeDjSetRequest(set.preferences)}</span>
            </div>
            <Link
                href="/#ai-dj"
                className="queue-dj-steer"
                aria-label="Steer the AI DJ"
                title="Opens the Now & Up next card on Home, where you can steer the DJ"
            >
                Steer
            </Link>
        </div>
    );
}

/**
 * Above the player queue while it holds the live AI DJ set (#2312). The set is
 * cleared when the session stops, which removes the header.
 */
export function PlayerDjQueueHeader({ queue }: { queue: ReadonlyArray<Pick<LocalTrack, "id" | "catalogTrackId">> }) {
    const set = useDjSet();
    return <PlayerDjQueueHeaderView set={set} queue={queue} />;
}
