"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { resolveDjQueue } from "../../lib/agentDjPlayback";
import { getDjSet, replaceDjSetTracks, useDjSet } from "../../lib/agentDjSet";
import { humanPickReason } from "../../lib/agentPickReason";
import { buildUpNext, pickNotesFromResponse, type UpNextItem } from "../../lib/agentUpNext";
import { trackIdsAt, upcomingDjIndices } from "../../lib/agentSessionRequest";
import {
    ApiRequestError,
    getAgentNextPick,
    recordAgentSignal,
    type AgentNextPickResponse,
    type AgentNextPreferences,
} from "../../lib/api";
import { saveTracksMetadata } from "../../lib/localLibrary";
import { usePlayer } from "../../lib/playerContext";
import { recordProductAnalytics } from "../../lib/productAnalytics";
import { pickNewIds } from "./AgentDjContinuation";

export type UpNextAction = "skip" | "not_this" | "more_like_this";

/** Which item an action is working on, so its buttons (and only the busy ones) are disabled. */
export type UpNextBusy = { action: UpNextAction; id: string } | null;

const RATE_LIMITED_NOTICE = "The DJ needs a moment. Your queue keeps playing.";
const FAILED_NOTICE = "Couldn't reach the DJ just now. Your queue keeps playing.";

function failureNotice(error: unknown): string {
    return error instanceof ApiRequestError && error.status === 429 ? RATE_LIMITED_NOTICE : FAILED_NOTICE;
}

type Options = {
    token: string | null | undefined;
    /** The open DJ session; actions do nothing without one. */
    sessionId: string | null;
    /** The freshest filters the DJ is following (same as a refill uses). */
    buildPreferences: () => AgentNextPreferences;
    /** Analytics surface and the intent label of the session. */
    surface: string;
    intent?: string;
    intentName?: string;
    /** The DJ asked for new picks: let the host refresh coverage and history. */
    onPicks?: (result: AgentNextPickResponse) => void;
};

/**
 * The Now & Up next card's data and actions (#2243). Reads the DJ set and the
 * player queue; every action goes through APIs the DJ already uses:
 * the player's skip, the agent "skip" signal, and the next-pick request.
 */
export function useDjUpNext({ token, sessionId, buildPreferences, surface, intent, intentName, onPicks }: Options) {
    const player = usePlayer();
    const set = useDjSet();
    const playerRef = useRef(player);
    playerRef.current = player;
    const [busy, setBusy] = useState<UpNextBusy>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const busyRef = useRef(false);
    // Tracks the listener rejected in this session; never queued again from a refill.
    const rejectedRef = useRef<Set<string>>(new Set());

    const view = useMemo(
        () => buildUpNext(player.queue, player.currentIndex, sessionId && set?.sessionId === sessionId ? set : null),
        [player.queue, player.currentIndex, set, sessionId],
    );

    const record = useCallback(
        (action: UpNextAction, trackId: string, extra: Record<string, number> = {}) => {
            void recordProductAnalytics(token, "agent.up_next_action", {
                source: "agent_up_next_card",
                subjectType: "agent_session",
                subjectId: sessionId ?? undefined,
                payload: { surface, action, trackId, ...(intent ? { intent } : {}), ...extra },
            });
        },
        [token, sessionId, surface, intent],
    );

    /** Ask the DJ for picks and resolve the ones that are new to the queue. */
    const requestPicks = useCallback(
        async (seedTrackId?: string) => {
            if (!token || !sessionId) return null;
            const result = await getAgentNextPick(token, {
                sessionId,
                preferences: { ...buildPreferences(), ...(seedTrackId ? { seedTrackId } : {}) },
            });
            onPicks?.(result);
            if (result.status !== "ok") return { result, tracks: [] as Awaited<ReturnType<typeof resolveDjQueue>> };
            const ids = pickNewIds(
                [result.track?.id, ...(result.tracks ?? []).map((pick) => pick.trackId)],
                playerRef.current.queue,
            ).filter((id) => !rejectedRef.current.has(id));
            const tracks = ids.length > 0 ? await resolveDjQueue(ids, token) : [];
            if (tracks.length > 0) await saveTracksMetadata(tracks, "remote");
            return { result, tracks };
        },
        [token, sessionId, buildPreferences, onPicks],
    );

    /**
     * The DJ added picks to the queue from a next-pick response. Same event, same
     * payload and same "accepted pick" meaning (status ok + trackId) as the retired
     * Next AI Pick button, so DJ impressions and ranker-variant metrics stay comparable.
     */
    const recordNextPick = useCallback(
        (result: AgentNextPickResponse) => {
            void recordProductAnalytics(token, "agent.next_pick_requested", {
                source: "agent_next_pick_card",
                subjectType: "agent_session",
                subjectId: sessionId ?? undefined,
                payload: {
                    surface,
                    intent,
                    intentName,
                    status: result.status,
                    trackId: result.track?.id,
                    runtimeStatus: result.runtimeStatus,
                    score: result.score,
                    // #2005: variant labels so DJ picks are counted per ranker variant.
                    ...(result.rankerVariant ? { rankerVariant: result.rankerVariant } : {}),
                    ...(result.experimentKey ? { experimentKey: result.experimentKey } : {}),
                },
            });
        },
        [token, sessionId, surface, intent, intentName],
    );

    const run = useCallback(
        async (action: UpNextAction, id: string, work: () => Promise<void>) => {
            if (busyRef.current) return;
            busyRef.current = true;
            setBusy({ action, id });
            setNotice(null);
            try {
                await work();
            } catch (error) {
                setNotice(failureNotice(error));
            } finally {
                busyRef.current = false;
                setBusy(null);
            }
        },
        [],
    );

    /** Skip the playing track (the player records its own skip). */
    const skip = useCallback(async () => {
        const now = view.now;
        if (!now) return;
        await run("skip", now.id, async () => {
            playerRef.current.nextTrack();
            record("skip", now.id);
        });
    }, [view.now, run, record]);

    /**
     * "Not this": write the DJ's existing skip signal, drop the track from the
     * queue (or move past it when it is playing) and ask the DJ to refill.
     */
    const notThis = useCallback(
        async (item: UpNextItem) => {
            if (!token || !sessionId) return;
            await run("not_this", item.id, async () => {
                rejectedRef.current.add(item.id);
                let signalError: unknown = null;
                try {
                    await recordAgentSignal(token, {
                        trackId: item.id,
                        action: "skip",
                        sessionId,
                        metadata: { source: "ai_dj_up_next", agentSessionId: sessionId },
                    });
                } catch (error) {
                    signalError = error;
                }
                const current = playerRef.current;
                const isPlaying = view.now?.id === item.id;
                if (isPlaying) {
                    current.nextTrack();
                } else {
                    const index = current.queue.findIndex(
                        (track, i) => i > current.currentIndex && (track.catalogTrackId || track.id) === item.id,
                    );
                    if (index >= 0) current.removeFromQueue(index);
                    replaceDjSetTracks([item.id], []);
                }
                record("not_this", item.id);
                const picked = await requestPicks();
                const live = getDjSet();
                if (picked && live?.sessionId === sessionId && picked.tracks.length > 0) {
                    const batch = playerRef.current.addTracksToQueue(picked.tracks);
                    const added = (batch?.added ?? picked.tracks).map((track) => track.catalogTrackId || track.id);
                    replaceDjSetTracks([], added, pickNotesFromResponse(picked.result));
                    recordNextPick(picked.result);
                } else if (picked && picked.result.status !== "ok" && picked.result.status !== "session_inactive") {
                    setNotice(humanPickReason(picked.result.status, picked.result.reason));
                }
                if (signalError) setNotice(failureNotice(signalError));
            });
        },
        [token, sessionId, view.now, run, record, requestPicks, recordNextPick],
    );

    /** "More like this": seed the next picks with this track and swap them in for the upcoming ones. */
    const moreLikeThis = useCallback(
        async (item: UpNextItem) => {
            if (!token || !sessionId) return;
            await run("more_like_this", item.id, async () => {
                const picked = await requestPicks(item.id);
                const live = getDjSet();
                if (!picked || !live || live.sessionId !== sessionId) return;
                if (picked.result.status === "session_inactive") return;
                if (picked.tracks.length === 0) {
                    setNotice(
                        picked.result.status === "ok"
                            ? "Nothing closer to that track yet. Your queue is unchanged."
                            : humanPickReason(picked.result.status, picked.result.reason),
                    );
                    record("more_like_this", item.id, { added: 0 });
                    return;
                }
                const current = playerRef.current;
                // Keep the seed where it is; swap the other not-yet-played DJ picks for its neighbours.
                const indices = upcomingDjIndices(current.queue, current.currentIndex, live.trackIds).filter(
                    (index) => (current.queue[index].catalogTrackId || current.queue[index].id) !== item.id,
                );
                const removed = trackIdsAt(current.queue, indices);
                for (const index of indices) current.removeFromQueue(index);
                const batch = current.addTracksToQueue(picked.tracks);
                const added = (batch?.added ?? picked.tracks).map((track) => track.catalogTrackId || track.id);
                replaceDjSetTracks(Array.from(removed), added, pickNotesFromResponse(picked.result));
                recordNextPick(picked.result);
                record("more_like_this", item.id, { added: added.length });
            });
        },
        [token, sessionId, run, requestPicks, record, recordNextPick],
    );

    return { view, busy, notice, dismissNotice: () => setNotice(null), skip, notThis, moreLikeThis };
}
