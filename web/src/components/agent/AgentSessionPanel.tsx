"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useAuth } from "../auth/AuthProvider";
import { useAgentConfig } from "../../hooks/useAgentConfig";
import { useAgentEvents } from "../../hooks/useAgentEvents";
import { useAgentHistory } from "../../hooks/useAgentHistory";
import { useDiscoveryJournal } from "../../hooks/useDiscoveryJournal";
import {
    applyTasteEdits,
    getAgentMixCoverage,
    getAgentMixVocabulary,
    getAgentNextPick,
    getTasteMemory,
    parseAgentSessionRequest,
    type AgentMixCoverage,
    type AgentMixVocabulary,
    type AgentMyMixPreferences,
    type AgentNextPickResponse,
    type AgentNextPreferences,
    type AgentRequestCoverage,
    type AgentSessionEnergy,
    type AgentSessionRequest,
    type AgentSessionRequestIgnoredKey,
    type ListeningLane,
} from "../../lib/api";
import {
    buildMyMixTasteEdits,
    createMyMixPreferences,
    getMyMixLocalContext,
} from "../../lib/agentMyMix";
import { resolveDjQueue } from "../../lib/agentDjPlayback";
import { getDjSet, setDjSet } from "../../lib/agentDjSet";
import {
    emptyRequest,
    hasFilters,
    removeChip,
    requestFilterKeys,
    requestFromPreset,
    setEnergy,
    trackIdsAt,
    upcomingDjIndices,
} from "../../lib/agentSessionRequest";
import { saveTracksMetadata } from "../../lib/localLibrary";
import { usePlayer } from "../../lib/playerContext";
import { recordProductAnalytics } from "../../lib/productAnalytics";
import { sonicRadarBanner } from "../../lib/sonicRadarSummary";
import { useToast } from "../ui/Toast";
import AgentActivityFeed from "./AgentActivityFeed";
import AgentHistoryCard from "./AgentHistoryCard";
import AgentNextPickCard from "./AgentNextPickCard";
import { humanPickReason } from "../../lib/agentPickReason";
import AgentSessionPrompt from "./AgentSessionPrompt";
import { SESSION_PRESETS, type SessionPreset } from "./AgentSessionPresets";
import AgentSetupWizard from "./AgentSetupWizard";
import AgentStatusCard from "./AgentStatusCard";

/** Analytics surface for the DJ session panel (it lives in the Home `#ai-dj` section). */
const ANALYTICS_SURFACE = "home";

/** How often to refetch history while waiting for a started session's first picks. */
const AUTOPLAY_POLL_INTERVAL_MS = 3000;
/** Give up waiting for a started session's first picks after this long (LLM search can take ~30s). */
const AUTOPLAY_MAX_WAIT_MS = 45000;

/** Wait this long after the last keystroke before reading the sentence. */
const PARSE_DEBOUNCE_MS = 600;
/** Wait this long after the last chip edit before re-planning, so rapid removals re-plan once. */
const REPLAN_DEBOUNCE_MS = 800;

/** `.aid-page` was a full-page canvas; embedded in Home it must not claim a viewport. */
const EMBEDDED_STYLE: CSSProperties = { minHeight: 0, padding: 0, background: "transparent" };

type Props = {
    /**
     * Bumped by the host whenever a session is started outside this panel
     * (e.g. from the Home tuner) so the panel refetches config and history
     * without a page reload. 0/undefined means "no external change yet".
     */
    refreshKey?: number;
};

/**
 * Start/stop and follow an AI DJ session: command bar, intent presets, live
 * status/activity/next pick, and session history. DJ preferences (name,
 * vibes) live in Settings → AI DJ; ERC-8004 identity is frozen (ADR-TE-6)
 * and intentionally not surfaced here.
 */
export default function AgentSessionPanel({ refreshKey }: Props) {
    const { token } = useAuth();
    const { config, isLoading, createConfig, updateConfig, startSession, stopSession, refetch: refetchConfig } =
        useAgentConfig();
    const events = useAgentEvents();
    const { sessions, summary: historySummary, isLoading: historyLoading, refetch: refetchHistory } = useAgentHistory();
    // Lifetime counts come from the summary; `sessions` is only the most recent window.
    const lifetime = historySummary ?? {
        sessionCount: sessions.length,
        sessionsWithTracks: sessions.filter((s) => s.licenses.length > 0).length,
        trackCount: sessions.reduce((sum, s) => sum + s.licenses.length, 0),
    };
    const { journal, isLoading: journalLoading } = useDiscoveryJournal();
    const radarBanner = sonicRadarBanner(journal);
    const { addToast } = useToast();
    const player = usePlayer();
    const { playQueue } = player;
    const [wizardOpen, setWizardOpen] = useState(false);
    const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
    const [nextPick, setNextPick] = useState<AgentNextPickResponse | null>(null);
    const [isPickingNext, setIsPickingNext] = useState(false);
    // What this session is for. The typed sentence lives only here, in memory:
    // it is parsed into `request` and never stored, sent with a session, or logged.
    const [text, setText] = useState("");
    const [request, setRequest] = useState<AgentSessionRequest | null>(null);
    const [unparsed, setUnparsed] = useState<string[]>([]);
    const [ignored, setIgnored] = useState<AgentSessionRequestIgnoredKey[]>([]);
    const [activePreset, setActivePreset] = useState<SessionPreset | null>(null);
    const [myMixLanes, setMyMixLanes] = useState<ListeningLane[]>([]);
    const [myMixVocabulary, setMyMixVocabulary] = useState<AgentMixVocabulary>({ genres: [], moods: [] });
    const [myMixPreferences, setMyMixPreferences] = useState<AgentMyMixPreferences | null>(null);
    const [myMixCoverage, setMyMixCoverage] = useState<AgentMixCoverage | null>(null);
    const [isSavingMyMix, setIsSavingMyMix] = useState(false);
    const [myMixSaveMessage, setMyMixSaveMessage] = useState<string | null>(null);
    // Optimistic "include explicit tracks" value while the save is in flight (#2088).
    const [explicitPending, setExplicitPending] = useState<boolean | null>(null);
    const [explicitError, setExplicitError] = useState<string | null>(null);
    const [isParsing, setIsParsing] = useState(false);
    const [parseError, setParseError] = useState<string | null>(null);
    const [isStarting, setIsStarting] = useState(false);
    const [isReplanning, setIsReplanning] = useState(false);
    // Coverage from the latest pick this panel requested (the live feed may carry a newer one).
    const [pickCoverage, setPickCoverage] = useState<{ coverage: AgentRequestCoverage | null; at: number } | null>(null);
    const parseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const parseSeqRef = useRef(0);
    const replanTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const replanSeqRef = useRef(0);
    const myMixPreferencesRef = useRef<AgentMyMixPreferences | null>(null);
    const myMixEditVersionRef = useRef(0);
    const myMixWasSelectedRef = useRef(false);
    const initialMixCoverageVersionRef = useRef<number | null>(null);
    // The newest render's values, for timers that fire after later renders.
    const latestRef = useRef<{ replan: () => Promise<void>; player: typeof player } | null>(null);
    // A session started from this panel whose first picks should autoplay once
    // they appear. The ref is the synchronous source of truth so the picks play
    // only once; the state drives the polling effect.
    const [awaitingAutoplayId, setAwaitingAutoplayId] = useState<string | null>(null);
    const awaitingAutoplayRef = useRef<string | null>(null);

    myMixPreferencesRef.current = myMixPreferences;

    const invalidateMyMixCoverage = () => {
        myMixEditVersionRef.current += 1;
        replanSeqRef.current += 1;
        setIsReplanning(false);
        setMyMixCoverage(null);
    };

    const refreshMyMixCoverage = useCallback(async (sessionId: string) => {
        if (!token || !myMixPreferencesRef.current) return;
        const version = myMixEditVersionRef.current;
        try {
            const result = await getAgentMixCoverage(token, sessionId);
            if (version === myMixEditVersionRef.current && myMixPreferencesRef.current) {
                setMyMixCoverage(result.mixCoverage ?? null);
            }
        } catch {
            // Coverage is an optional explanation; playback remains available if it cannot load.
        }
    }, [token]);

    // My Mix uses the listener's current visible lanes and backend catalog vocabulary.
    useEffect(() => {
        if (!token) {
            setMyMixLanes([]);
            setMyMixVocabulary({ genres: [], moods: [] });
            return;
        }
        let current = true;
        void Promise.all([getTasteMemory(token), getAgentMixVocabulary(token)])
            .then(([memory, vocabulary]) => {
                if (!current) return;
                setMyMixLanes(memory.summary.listeningLanes ?? []);
                setMyMixVocabulary(vocabulary);
            })
            .catch(() => {
                if (!current) return;
                setMyMixLanes([]);
                setMyMixVocabulary({ genres: [], moods: [] });
            });
        return () => { current = false; };
    }, [token]);

    const beginAwaitingAutoplay = useCallback((sessionId: string) => {
        awaitingAutoplayRef.current = sessionId;
        setAwaitingAutoplayId(sessionId);
    }, []);
    const clearAwaitingAutoplay = useCallback(() => {
        awaitingAutoplayRef.current = null;
        setAwaitingAutoplayId(null);
    }, []);

    /** The preferences a next-pick request carries; also what the continuation reuses to keep the set going. */
    const buildNextPickPreferences = useCallback((): AgentNextPreferences => {
        if (myMixPreferences) return { myMix: myMixPreferences };
        const regularPreferences = buildSessionPreferences({
            activePreset,
            request,
            fallbackGenres: config?.vibes,
        }) ?? {
            genres: config?.vibes,
            // Every chip removed: an empty request tells the DJ to drop the
            // session's earlier filters (omitting the key would keep them).
            ...(request ? { request } : {}),
        };
        return myMixWasSelectedRef.current
            ? { ...regularPreferences, myMix: null }
            : regularPreferences;
    }, [myMixPreferences, activePreset, request, config?.vibes]);

    /** Put the DJ's picks in the player. Returns how many tracks were queued. */
    const playDjTracks = useCallback(
        async (sessionId: string, trackIds: string[]): Promise<number> => {
            try {
                const queue = await resolveDjQueue(trackIds, token);
                if (queue.length === 0) return 0;
                await saveTracksMetadata(queue, "remote");
                const previousSet = getDjSet();
                // Let the DJ keep adding picks as this queue runs out (AgentDjContinuation).
                setDjSet({
                    sessionId,
                    preferences: buildNextPickPreferences(),
                    trackIds: queue.map((track) => track.catalogTrackId || track.id),
                });
                const installedSet = getDjSet();
                try {
                    // Starts must already carry the DJ session's provenance.
                    await playQueue(queue, 0);
                } catch (error) {
                    // Preserve a newer set if another action replaced this one.
                    if (getDjSet() === installedSet) setDjSet(previousSet);
                    throw error;
                }
                return queue.length;
            } catch (error) {
                addToast({
                    type: "error",
                    title: "Couldn't play the DJ's picks",
                    message: error instanceof Error ? error.message : "Unable to start playback.",
                });
                return 0;
            }
        },
        [token, playQueue, addToast, buildNextPickPreferences],
    );

    const openSessionId = useMemo(() => {
        return activeSessionId ?? sessions.find((session) => !session.endedAt)?.id ?? null;
    }, [activeSessionId, sessions]);
    const openSessionIdRef = useRef(openSessionId);
    openSessionIdRef.current = openSessionId;

    // How well the latest picks matched the filters: the newest of this panel's own
    // pick response and the live feed's newest decision for the open session.
    const coverage = useMemo((): AgentRequestCoverage | null => {
        const event = openSessionId
            ? events.find(
                  (candidate) =>
                      candidate.type === "agent.decision_made" &&
                      candidate.sessionId === openSessionId &&
                      candidate.coverage,
              )
            : undefined;
        const eventAt = event ? Date.parse(event.timestamp) : Number.NaN;
        if (event?.coverage && (!pickCoverage || (!Number.isNaN(eventAt) && eventAt > pickCoverage.at))) {
            return event.coverage;
        }
        return pickCoverage?.coverage ?? null;
    }, [events, openSessionId, pickCoverage]);

    /**
     * Re-plan the DJ's upcoming picks after the filters changed: ask for picks that
     * follow them, then swap them in for the not-yet-played DJ picks in the player.
     * Tracks already played, the one playing, and tracks the listener queued stay.
     */
    const replanUpcoming = async () => {
        if (!token || !openSessionId || !config?.isActive) return;
        const set = getDjSet();
        // No DJ set in the player yet: the next pick and the continuation read the new filters.
        if (!set || set.sessionId !== openSessionId) return;
        const preferences = buildNextPickPreferences();
        const sequence = ++replanSeqRef.current;
        const isCurrent = () => sequence === replanSeqRef.current;
        setIsReplanning(true);
        try {
            const result = await getAgentNextPick(token, { sessionId: openSessionId, preferences });
            if (!isCurrent()) return;
            setPickCoverage({ coverage: result.requestCoverage ?? null, at: Date.now() });
            if (myMixPreferences) setMyMixCoverage(result.mixCoverage ?? null);
            if (result.status !== "ok" || !result.track) {
                const live = getDjSet();
                if (live?.sessionId === openSessionId) {
                    setDjSet({ ...live, preferences });
                }
                addToast({
                    type: "info",
                    title: "No new picks for those filters",
                    message: result.reason ?? "The DJ kept your upcoming tracks.",
                });
                return;
            }
            const ids = Array.from(
                new Set([result.track.id, ...(result.tracks ?? []).map((pick) => pick.trackId)]),
            );
            const resolved = await resolveDjQueue(ids, token);
            if (!isCurrent()) return;
            if (resolved.length === 0) {
                addToast({
                    type: "info",
                    title: "No new picks for those filters",
                    message: "The DJ kept your upcoming tracks.",
                });
                return;
            }
            await saveTracksMetadata(resolved, "remote");
            const live = getDjSet();
            const current = latestRef.current?.player;
            if (!isCurrent() || !live || live.sessionId !== openSessionId || !current) return;
            // Swap synchronously so the continuation never sees a half-emptied queue.
            const indices = upcomingDjIndices(current.queue, current.currentIndex, live.trackIds);
            const removedIds = trackIdsAt(current.queue, indices);
            for (const index of indices) current.removeFromQueue(index);
            const batch = current.addTracksToQueue(resolved);
            const addedIds = (batch?.added ?? resolved).map((track) => track.catalogTrackId || track.id);
            setDjSet({
                sessionId: openSessionId,
                preferences,
                trackIds: [...live.trackIds.filter((id) => !removedIds.has(id)), ...addedIds],
            });
            addToast({
                type: "success",
                title: "DJ updated",
                message: "Your upcoming picks now follow these filters.",
            });
        } catch (error) {
            if (!isCurrent()) return;
            addToast({
                type: "error",
                title: "Couldn't update the DJ",
                message: error instanceof Error ? error.message : "Unable to re-plan the upcoming picks.",
            });
        } finally {
            if (isCurrent()) setIsReplanning(false);
        }
    };

    // Timers fire after later renders: keep the newest closure and player reachable.
    useEffect(() => {
        latestRef.current = { replan: replanUpcoming, player };
    });

    // Drop pending timers on unmount.
    useEffect(() => {
        return () => {
            if (parseTimerRef.current) clearTimeout(parseTimerRef.current);
            if (replanTimerRef.current) clearTimeout(replanTimerRef.current);
            parseSeqRef.current += 1;
            replanSeqRef.current += 1;
        };
    }, []);

    /** Re-plan once the listener stops editing; a no-op unless a DJ set is live. */
    const scheduleReplan = () => {
        if (replanTimerRef.current) clearTimeout(replanTimerRef.current);
        replanTimerRef.current = setTimeout(() => {
            replanTimerRef.current = null;
            void latestRef.current?.replan();
        }, REPLAN_DEBOUNCE_MS);
    };

    /** Stop reading the sentence: drop the pending timer and ignore any response still in flight. */
    const cancelParse = () => {
        if (parseTimerRef.current) clearTimeout(parseTimerRef.current);
        parseTimerRef.current = null;
        parseSeqRef.current += 1;
        setIsParsing(false);
    };

    const runParse = async (sentence: string, sequence: number) => {
        parseTimerRef.current = null;
        if (!token) {
            if (sequence === parseSeqRef.current) setIsParsing(false);
            return;
        }
        try {
            const parsed = await parseAgentSessionRequest(token, sentence);
            if (sequence !== parseSeqRef.current) return;
            setRequest(parsed.request);
            setUnparsed(parsed.unparsed ?? []);
            setIgnored(parsed.ignored ?? []);
            setParseError(null);
        } catch {
            if (sequence !== parseSeqRef.current) return;
            // Keep the previous chips; the sentence itself is never echoed into the message.
            setParseError("Couldn't read that just now. Your filters are unchanged.");
        } finally {
            if (sequence === parseSeqRef.current) setIsParsing(false);
        }
    };

    const handleTextChange = (value: string) => {
        setText(value);
        setActivePreset(null);
        if (myMixPreferences) {
            setMyMixPreferences(null);
            myMixWasSelectedRef.current = true;
            invalidateMyMixCoverage();
            setMyMixSaveMessage(null);
        }
        if (parseTimerRef.current) clearTimeout(parseTimerRef.current);
        parseTimerRef.current = null;
        const sequence = ++parseSeqRef.current;
        if (!value.trim()) {
            // Empty, not null: a live session's next picks then drop the old filters.
            setRequest(emptyRequest());
            setUnparsed([]);
            setIgnored([]);
            setParseError(null);
            setIsParsing(false);
            setPickCoverage(null);
            scheduleReplan();
            return;
        }
        setIsParsing(true);
        parseTimerRef.current = setTimeout(() => {
            void runParse(value, sequence);
        }, PARSE_DEBOUNCE_MS);
    };

    /** A chip edit makes the filters the listener's own: the preset no longer describes them. */
    const applyRequestEdit = (next: AgentSessionRequest) => {
        cancelParse();
        setRequest(next);
        setActivePreset(null);
        if (myMixPreferences) {
            setMyMixPreferences(null);
            myMixWasSelectedRef.current = true;
            invalidateMyMixCoverage();
            setMyMixSaveMessage(null);
        }
        setParseError(null);
        scheduleReplan();
    };

    const handleRemoveChip = (chipKey: string) => {
        if (request) applyRequestEdit(removeChip(request, chipKey));
    };

    const handleEnergyChange = (band: AgentSessionEnergy) => {
        if (request) applyRequestEdit(setEnergy(request, band));
    };

    const handleSelectMyMix = () => {
        cancelParse();
        setText("");
        setRequest(null);
        setUnparsed([]);
        setIgnored([]);
        setParseError(null);
        setActivePreset(null);
        myMixWasSelectedRef.current = true;
        setMyMixPreferences(createMyMixPreferences());
        invalidateMyMixCoverage();
        setMyMixSaveMessage(null);
        scheduleReplan();
    };

    const handleMyMixChange = (next: AgentMyMixPreferences) => {
        setMyMixPreferences(next);
        invalidateMyMixCoverage();
        setMyMixSaveMessage(null);
        scheduleReplan();
    };

    const visibleMyMixLanes = useMemo(
        () => myMixLanes.filter((lane) => !lane.hidden),
        [myMixLanes],
    );
    const myMixTasteEdits = useMemo(
        () => myMixPreferences ? buildMyMixTasteEdits(myMixPreferences, visibleMyMixLanes) : [],
        [myMixPreferences, visibleMyMixLanes],
    );

    const handleSaveMyMix = async () => {
        if (!token || isSavingMyMix || myMixTasteEdits.length === 0) return;
        setIsSavingMyMix(true);
        setMyMixSaveMessage(null);
        try {
            const result = await applyTasteEdits(token, myMixTasteEdits);
            const { appliedCount, ignoredCount } = result.edits;
            const message = ignoredCount > 0
                ? `Saved ${appliedCount} preferences; ${ignoredCount} were not accepted.`
                : `Saved ${appliedCount} preferences for future recommendations.`;
            setMyMixSaveMessage(message);
            addToast({
                type: ignoredCount > 0 ? "info" : "success",
                title: ignoredCount > 0 ? "Some preferences were not saved" : "Taste Memory updated",
                message,
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : "Unable to save these preferences.";
            setMyMixSaveMessage(`Couldn't save these preferences. ${message}`);
            addToast({ type: "error", title: "Couldn't save to Taste Memory", message });
        } finally {
            setIsSavingMyMix(false);
        }
    };

    const handleExplicitChange = async (next: boolean) => {
        if (explicitPending !== null) return;
        setExplicitError(null);
        setExplicitPending(next);
        try {
            // The server resolves this setting on every pick, so it applies from the next one.
            await updateConfig({ allowExplicit: next });
        } catch (error) {
            const message = error instanceof Error ? error.message : "Unable to save this setting.";
            setExplicitError(`Couldn't save this setting. ${message}`);
        } finally {
            setExplicitPending(null);
        }
    };

    // A session was started elsewhere on the page: pick it up without a reload.
    useEffect(() => {
        if (!refreshKey) return;
        void refetchConfig();
        void refetchHistory();
    }, [refreshKey, refetchConfig, refetchHistory]);

    // Poll history while a just-started session's picks are still being chosen.
    useEffect(() => {
        if (!awaitingAutoplayId) return;
        const startVersion = initialMixCoverageVersionRef.current;
        const refreshInitialCoverage = () => {
            if (
                startVersion !== null &&
                startVersion === myMixEditVersionRef.current &&
                myMixPreferencesRef.current
            ) {
                void refreshMyMixCoverage(awaitingAutoplayId);
            }
        };
        const interval = setInterval(() => {
            void refetchHistory();
            refreshInitialCoverage();
        }, AUTOPLAY_POLL_INTERVAL_MS);
        refreshInitialCoverage();
        const giveUp = setTimeout(() => {
            if (awaitingAutoplayRef.current !== awaitingAutoplayId) return;
            clearAwaitingAutoplay();
            addToast({
                type: "info",
                title: "The DJ found nothing to play yet",
                message: "Try Next AI Pick, or start a session with another intent.",
            });
        }, AUTOPLAY_MAX_WAIT_MS);
        return () => {
            clearInterval(interval);
            clearTimeout(giveUp);
        };
    }, [awaitingAutoplayId, refetchHistory, clearAwaitingAutoplay, addToast, refreshMyMixCoverage]);

    // Play the started session's first picks, once.
    useEffect(() => {
        const sessionId = awaitingAutoplayRef.current;
        if (!sessionId) return;
        const session = sessions.find((candidate) => candidate.id === sessionId);
        if (!session || session.licenses.length === 0) return;
        clearAwaitingAutoplay();
        void playDjTracks(sessionId, session.mixTrackIds ?? session.licenses.map((license) => license.trackId));
    }, [sessions, playDjTracks, clearAwaitingAutoplay]);

    useEffect(() => {
        void recordProductAnalytics(token, "agent.intent_viewed", {
            source: "agent_session_intent_panel",
            subjectType: "agent_config",
            subjectId: config?.id,
            payload: {
                surface: ANALYTICS_SURFACE,
                presetCount: SESSION_PRESETS.length,
                intents: SESSION_PRESETS.map((preset) => preset.intent),
            },
        });
    }, [config?.id, token]);

    const handleWizardComplete = async (data: {
        name: string;
        vibes: string[];
        monthlyCapUsd: number;
    }) => {
        await createConfig(data);
        setWizardOpen(false);
        void recordProductAnalytics(token, "onboarding.completed", {
            source: "agent_setup",
            subjectType: "agent_config",
            payload: {
                flow: "agent",
                vibeCount: data.vibes.length,
                walletEnabled: false,
                monthlyCapUsd: data.monthlyCapUsd,
            },
        });
        addToast({
            type: "success",
            title: "DJ Activated",
            message: `${data.name} is ready to curate!`,
        });
    };

    const handleToggle = async () => {
        if (config?.isActive) {
            const stoppedSessionId = openSessionId;
            const stoppedSession = stoppedSessionId ? sessions.find((session) => session.id === stoppedSessionId) : null;
            await stopSession();
            // Stopping the session stops the DJ adding picks to the player.
            setDjSet(null);
            clearAwaitingAutoplay();
            if (replanTimerRef.current) clearTimeout(replanTimerRef.current);
            replanTimerRef.current = null;
            replanSeqRef.current += 1;
            setIsReplanning(false);
            setPickCoverage(null);
            invalidateMyMixCoverage();
            setActiveSessionId(null);
            setNextPick(null);
            void recordProductAnalytics(token, "agent.session_stopped", {
                source: "agent_command_bar",
                subjectType: "agent_session",
                subjectId: stoppedSessionId ?? undefined,
                payload: {
                    surface: ANALYTICS_SURFACE,
                    intent: activePreset?.intent,
                    intentName: activePreset?.name,
                    sessionDurationMs: stoppedSession
                        ? Math.max(0, Date.now() - new Date(stoppedSession.startedAt).getTime())
                        : undefined,
                },
            });
            addToast({
                type: "info",
                title: "Session Stopped",
                message: "Your DJ has paused.",
            });
            // Refetch history to show the completed session
            setTimeout(() => refetchHistory(), 500);
        } else {
            // The sentence is still being read: starting now would ignore it.
            if (isParsing) return;
            const preset = activePreset;
            const startedFrom: SessionStartedFrom = myMixPreferences
                ? "my_mix"
                : preset ? "preset" : hasFilters(request) ? "prompt" : "plain";
            // A preset or a typed request steers this session only: it travels as
            // session preferences and never overwrites the vibes saved in Settings.
            const preferences = myMixPreferences
                ? { myMix: { ...myMixPreferences, context: getMyMixLocalContext() } }
                : buildSessionPreferences({ activePreset: preset, request });
            try {
                setIsStarting(true);
                const result = await startSession(preferences ? { preferences } : undefined);
                if (result?.sessionId) {
                    setActiveSessionId(result.sessionId);
                    initialMixCoverageVersionRef.current = myMixPreferences
                        ? myMixEditVersionRef.current
                        : null;
                    beginAwaitingAutoplay(result.sessionId);
                    if (!myMixPreferences) myMixWasSelectedRef.current = false;
                }
                // Filter kinds and counts only: never the typed sentence or the filter values.
                void recordProductAnalytics(token, "agent.session_started", {
                    source:
                        startedFrom === "preset"
                            ? "agent_session_intent_panel"
                            : startedFrom === "prompt" || startedFrom === "my_mix"
                              ? "agent_session_prompt"
                              : "agent_command_bar",
                    subjectType: "agent_session",
                    subjectId: result?.sessionId,
                    payload: {
                        surface: ANALYTICS_SURFACE,
                        startedFrom,
                        intent: preset?.intent,
                        intentName: preset?.name,
                        energy: preset?.preferences.energy,
                        mood: preset?.preferences.mood,
                        queueStyle: preset?.queueStyle,
                        requestFilterKeys: requestFilterKeys(request),
                        unparsedCount: unparsed.length,
                        ignoredKeys: ignored,
                    },
                });
                addToast({
                    type: "info",
                    title: "Session Started",
                    message: preset
                        ? `${preset.name} is now guiding the queue.`
                        : startedFrom === "my_mix"
                          ? "My Mix is now guiding the queue."
                        : startedFrom === "prompt"
                          ? "Your DJ is following your filters and will start playing shortly."
                          : "Your DJ is picking tracks and will start playing shortly.",
                });
                // History is polled by the autoplay effect until the first picks arrive.
            } finally {
                setIsStarting(false);
            }
        }
    };

    const handleSelectPreset = (preset: SessionPreset) => {
        // A preset stands for known filters: show them as chips without reading any text.
        cancelParse();
        setText(`${preset.name}: ${preset.input}`);
        setRequest(requestFromPreset(preset));
        setUnparsed([]);
        setIgnored([]);
        setParseError(null);
        setActivePreset(preset);
        if (myMixPreferences) {
            setMyMixPreferences(null);
            myMixWasSelectedRef.current = true;
            invalidateMyMixCoverage();
            setMyMixSaveMessage(null);
        }
        scheduleReplan();
        void recordProductAnalytics(token, "agent.intent_selected", {
            source: "agent_session_intent_panel",
            subjectType: "agent_config",
            subjectId: config?.id,
            payload: {
                surface: ANALYTICS_SURFACE,
                intent: preset.intent,
                intentName: preset.name,
                energy: preset.preferences.energy,
                mood: preset.preferences.mood,
                queueStyle: preset.queueStyle,
            },
        });
    };

    /** The prompt's main action: start a session, or update the live one right now. */
    const handleSubmit = async () => {
        if (!config?.isActive) {
            await handleToggle();
            return;
        }
        if (isParsing) return;
        if (replanTimerRef.current) clearTimeout(replanTimerRef.current);
        replanTimerRef.current = null;
        const set = getDjSet();
        if (set && set.sessionId === openSessionId) {
            await replanUpcoming();
        } else {
            addToast({
                type: "info",
                title: "Filters updated",
                message: "The DJ's next picks will follow them.",
            });
        }
    };

    const handleNextPick = async () => {
        if (!token || !openSessionId || !config) return;
        const requestedSessionId = openSessionId;
        const requestedMixVersion = myMixPreferences ? myMixEditVersionRef.current : null;
        const requestIsCurrent = () =>
            requestedMixVersion === null ||
            (requestedMixVersion === myMixEditVersionRef.current &&
                myMixPreferencesRef.current !== null &&
                openSessionIdRef.current === requestedSessionId);
        setIsPickingNext(true);
        try {
            const result = await getAgentNextPick(token, {
                sessionId: requestedSessionId,
                preferences: buildNextPickPreferences(),
            });
            if (!requestIsCurrent()) return;
            void recordProductAnalytics(token, "agent.next_pick_requested", {
                source: "agent_next_pick_card",
                subjectType: "agent_session",
                subjectId: requestedSessionId,
                payload: {
                    surface: ANALYTICS_SURFACE,
                    intent: activePreset?.intent,
                    intentName: activePreset?.name,
                    status: result.status,
                    trackId: result.track?.id,
                    runtimeStatus: result.runtimeStatus,
                    score: result.score,
                    // #2005: variant labels so DJ picks are counted per ranker variant.
                    ...(result.rankerVariant ? { rankerVariant: result.rankerVariant } : {}),
                    ...(result.experimentKey ? { experimentKey: result.experimentKey } : {}),
                },
            });
            setNextPick(result);
            setPickCoverage({ coverage: result.requestCoverage ?? null, at: Date.now() });
            if (myMixPreferences) setMyMixCoverage(result.mixCoverage ?? null);
            if (result.status === "ok" && result.track) {
                // A rule-based fallback is not an AI pick; say so (#2075).
                addToast({
                    type: "success",
                    title: result.runtimeFallback ? "Pick Ready" : "AI Pick Ready",
                    message: result.runtimeFallback
                        ? `Playing ${result.track.title} · rule-based pick, the AI curator is unavailable`
                        : `Playing ${result.track.title}`,
                });
                void playDjTracks(requestedSessionId, [result.track.id, ...(result.tracks ?? []).map((pick) => pick.trackId)]);
            } else {
                addToast({
                    type: "info",
                    title: "No new pick",
                    message: humanPickReason(result.status, result.reason),
                });
            }
            void refetchHistory();
        } catch (error) {
            if (!requestIsCurrent()) return;
            const message = error instanceof Error ? error.message : "Unable to request next pick.";
            addToast({
                type: "error",
                title: "Runtime Pick Failed",
                message,
            });
        } finally {
            setIsPickingNext(false);
        }
    };

    // A refetch must not blank the panel: only show the loaders on first load.
    const showConfigLoader = isLoading && !config;
    const showHistoryLoader = historyLoading && sessions.length === 0;

    return (
        <div className="aid-page" data-testid="agent-session-panel" style={EMBEDDED_STYLE}>
            {showConfigLoader ? (
                <div className="aid-loader-wrap">
                    <span className="aid-spinner" />
                    <span>Loading your DJ…</span>
                </div>
            ) : !config ? (
                <div className="aid-empty">
                    <div className="aid-empty-icon">🤖</div>
                    <h2>Set up your DJ</h2>
                    <p>Name your DJ and it will build listening sessions around your mood, explaining why each pick fits.</p>
                    <button className="aid-primary-btn" onClick={() => setWizardOpen(true)}>
                        Set up your DJ
                    </button>
                </div>
            ) : (
                <>
                    {/* Command bar */}
                    <div className="aid-command">
                        <div className="aid-orb">
                            <span className="aid-orb-badge">{config.name.slice(0, 2).toUpperCase()}</span>
                        </div>
                        <div className="aid-command-info">
                            <span className="aid-command-name">{config.name}</span>
                            <span className={`aid-command-status ${config.isActive ? "active" : ""}`}>
                                {config.isActive ? "● Live" : "○ Inactive"}
                            </span>
                        </div>
                        <div className="aid-command-actions">
                            <button
                                className={`aid-toggle-btn ${config.isActive ? "stop" : "start"}`}
                                onClick={() => handleToggle()}
                            >
                                {config.isActive ? "Stop Session" : "Start Session"}
                            </button>
                        </div>
                    </div>

                    {/* What's this session for? */}
                    <AgentSessionPrompt
                        text={text}
                        onTextChange={handleTextChange}
                        activePresetIntent={activePreset?.intent ?? null}
                        onSelectPreset={handleSelectPreset}
                        request={request}
                        onRemoveChip={handleRemoveChip}
                        onEnergyChange={handleEnergyChange}
                        unparsed={unparsed}
                        ignored={ignored}
                        coverage={config.isActive ? coverage : null}
                        isParsing={isParsing}
                        parseError={parseError}
                        isLive={config.isActive}
                        isBusy={isStarting || isReplanning}
                        explicit={{
                            enabled: explicitPending ?? config.allowExplicit ?? false,
                            isSaving: explicitPending !== null,
                            error: explicitError,
                            onChange: handleExplicitChange,
                        }}
                        myMix={{
                            lanes: myMixLanes,
                            vocabulary: myMixVocabulary,
                            preferences: myMixPreferences,
                            coverage: myMixCoverage,
                            isSaving: isSavingMyMix,
                            saveMessage: myMixSaveMessage,
                            canSave: myMixTasteEdits.length > 0,
                            onSelect: handleSelectMyMix,
                            onChange: handleMyMixChange,
                            onSave: handleSaveMyMix,
                        }}
                        onSubmit={handleSubmit}
                    />

                    {/* Middle row: Status | Activity | Next Pick */}
                    <div className="aid-middle-row">
                        <AgentStatusCard
                            config={config}
                            onToggle={() => handleToggle()}
                            sessionCount={lifetime.sessionCount}
                            trackCount={lifetime.trackCount}
                        />
                        <AgentActivityFeed isActive={config.isActive} events={events} />
                        <AgentNextPickCard
                            config={config}
                            activeSessionId={openSessionId}
                            pick={nextPick}
                            isLoading={isPickingNext}
                            mixCoverage={myMixPreferences ? myMixCoverage : null}
                            onPick={handleNextPick}
                        />
                    </div>

                    {/* Discovery banner: numbers come from the Sonic Radar journal itself. */}
                    {!journalLoading && journal && (
                        <div className="aid-discovery-banner">
                            {radarBanner.kind === "resonant" ? (
                                <>
                                    <span>
                                        <strong>{radarBanner.count}</strong> {radarBanner.count === 1 ? "track" : "tracks"} resonated with you in the last {radarBanner.windowDays} days
                                        {radarBanner.newArtistsThisWeek > 0 && (
                                            <>
                                                {" · "}
                                                <strong>{radarBanner.newArtistsThisWeek}</strong> new {radarBanner.newArtistsThisWeek === 1 ? "artist" : "artists"} this week
                                            </>
                                        )}
                                    </span>
                                    <Link href="/sonic-radar" className="aid-ghost-btn">View on Sonic Radar →</Link>
                                </>
                            ) : radarBanner.kind === "pending" ? (
                                <>
                                    <span>
                                        <strong>{radarBanner.count}</strong> {radarBanner.count === 1 ? "track" : "tracks"} you played through this week {radarBanner.count === 1 ? "is" : "are"} one save away from your Sonic Radar
                                    </span>
                                    <Link href="/sonic-radar" className="aid-ghost-btn">Review them →</Link>
                                </>
                            ) : (
                                <>
                                    <span>Play a track all the way through, then save or replay it, and it lands in your Sonic Radar.</span>
                                    <Link href="/sonic-radar" className="aid-ghost-btn">Open Sonic Radar →</Link>
                                </>
                            )}
                        </div>
                    )}

                    {/* History */}
                    <AgentHistoryCard sessions={sessions} totalCount={lifetime.sessionCount} isLoading={showHistoryLoader} />

                    <p className="aid-taste-hint">
                        Rename your DJ or change its vibes in{" "}
                        <Link href="/settings?section=dj">Settings → AI DJ</Link>.
                    </p>
                </>
            )}

            {wizardOpen && (
                <AgentSetupWizard
                    onComplete={handleWizardComplete}
                    onClose={() => setWizardOpen(false)}
                />
            )}
        </div>
    );
}

export type SessionStartedFrom = "preset" | "prompt" | "plain" | "my_mix";

export function toIntentPreferences(preset: SessionPreset): AgentNextPreferences {
    return {
        ...preset.preferences,
        genres: preset.searchVibes,
        sessionIntent: preset.intent,
        sessionIntentName: preset.name,
        queueStyle: preset.queueStyle,
        source: "agent_session_intent",
    };
}

/**
 * The preferences a session start (or a pick request) carries for the current
 * filters, or undefined when there is nothing to steer: a plain start.
 *
 * An untouched preset keeps its exact preferences and adds its request. Typed or
 * edited filters travel as the request plus the session genres, mood and energy
 * derived from it. The typed sentence is never part of the preferences.
 */
export function buildSessionPreferences({
    activePreset,
    request,
    fallbackGenres,
}: {
    activePreset: SessionPreset | null;
    request: AgentSessionRequest | null;
    /** Saved vibes to use when the filters name no genre (pick requests only). */
    fallbackGenres?: string[];
}): AgentNextPreferences | undefined {
    if (activePreset) {
        return request
            ? { ...toIntentPreferences(activePreset), request }
            : toIntentPreferences(activePreset);
    }
    if (!request || !hasFilters(request)) return undefined;
    return {
        request,
        genres: request.genres.length > 0 ? request.genres : fallbackGenres ?? request.genres,
        mood: request.moods[0],
        energy: request.energy ?? undefined,
        source: "agent_session_prompt",
    };
}
