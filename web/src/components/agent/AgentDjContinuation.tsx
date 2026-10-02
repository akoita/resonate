"use client";

import { useEffect, useRef } from "react";
import { useAuth } from "../auth/AuthProvider";
import { resolveDjQueue } from "../../lib/agentDjPlayback";
import { addDjSetTracks, getDjSet, setDjSet, useDjSet, type DjSet } from "../../lib/agentDjSet";
import { getAgentNextPick } from "../../lib/api";
import { saveTracksMetadata, type LocalTrack } from "../../lib/localLibrary";
import { usePlayer } from "../../lib/playerContext";

/** Refill when the player is on the last or second-to-last track of the queue. */
const REFILL_WITHIN_LAST = 2;

type RefillInput = {
    set: DjSet | null;
    hasToken: boolean;
    currentTrackId: string | null | undefined;
    currentIndex: number;
    queueLength: number;
};

/** Whether the player has reached the end of the DJ's picks while the DJ set is live. */
export function shouldRefill({ set, hasToken, currentTrackId, currentIndex, queueLength }: RefillInput): boolean {
    if (!set || !hasToken || !currentTrackId) return false;
    if (currentIndex < 0 || queueLength === 0) return false;
    if (!set.trackIds.includes(currentTrackId)) return false;
    return currentIndex >= queueLength - REFILL_WITHIN_LAST;
}

/** The picked ids that are not already in the queue, de-duplicated, order preserved. */
export function pickNewIds(ids: Array<string | null | undefined>, queue: readonly LocalTrack[]): string[] {
    const queued = new Set<string>();
    for (const track of queue) {
        queued.add(track.id);
        if (track.catalogTrackId) queued.add(track.catalogTrackId);
    }
    const fresh: string[] = [];
    for (const id of ids) {
        if (!id || queued.has(id) || fresh.includes(id)) continue;
        fresh.push(id);
    }
    return fresh;
}

/** Identity of a set for "exhausted" bookkeeping: appends keep it, a newly played set changes it. */
function setKey(set: DjSet): string {
    return `${set.sessionId}:${set.trackIds[0] ?? ""}`;
}

/**
 * Keeps the AI DJ's set going from anywhere in the app. When the player reaches
 * the end of the DJ's queue while the DJ session is live, ask for the next
 * picks and append them. Renders nothing.
 */
export default function AgentDjContinuation() {
    const { token } = useAuth();
    const set = useDjSet();
    const { queue, currentIndex, currentTrack, addTracksToQueue } = usePlayer();
    const inFlightRef = useRef(false);
    // Set + queue length of the last request, so one render burst cannot
    // double-fetch but a queue that has grown (or a new set) can refill again.
    const requestedRef = useRef<string | null>(null);
    // Set that returned nothing (or failed): do not retry until a new set is played.
    const exhaustedKeyRef = useRef<string | null>(null);

    const currentTrackId = currentTrack?.catalogTrackId || currentTrack?.id;

    useEffect(() => {
        if (!set) {
            exhaustedKeyRef.current = null;
            requestedRef.current = null;
            return;
        }
        if (!token) return;
        const key = setKey(set);
        if (exhaustedKeyRef.current === key) return;
        const requestId = `${key}:${queue.length}`;
        if (inFlightRef.current || requestedRef.current === requestId) return;
        if (!shouldRefill({ set, hasToken: true, currentTrackId, currentIndex, queueLength: queue.length })) return;

        inFlightRef.current = true;
        requestedRef.current = requestId;
        const queueAtRequest = queue;

        const refill = async () => {
            try {
                const result = await getAgentNextPick(token, {
                    sessionId: set.sessionId,
                    preferences: set.preferences,
                });
                // The set may have been stopped or replaced while the request ran.
                const live = getDjSet();
                if (!live || setKey(live) !== key) return;

                if (result.status === "session_inactive") {
                    setDjSet(null);
                    return;
                }
                if (result.status !== "ok") {
                    exhaustedKeyRef.current = key;
                    return;
                }
                const ids = pickNewIds(
                    [result.track?.id, ...(result.tracks ?? []).map((pick) => pick.trackId)],
                    queueAtRequest,
                );
                const resolved = ids.length > 0 ? await resolveDjQueue(ids, token) : [];
                const stillLive = getDjSet();
                if (!stillLive || setKey(stillLive) !== key) return;
                if (resolved.length === 0) {
                    exhaustedKeyRef.current = key;
                    return;
                }
                await saveTracksMetadata(resolved, "remote");
                const added = addTracksToQueue(resolved);
                if (added && added.added.length === 0) {
                    exhaustedKeyRef.current = key;
                    return;
                }
                addDjSetTracks(resolved.map((track) => track.catalogTrackId || track.id));
            } catch (error) {
                console.warn("AI DJ could not fetch more picks", error);
                exhaustedKeyRef.current = key;
            } finally {
                inFlightRef.current = false;
            }
        };
        void refill();
    }, [set, token, queue, currentIndex, currentTrackId, addTracksToQueue]);

    return null;
}
