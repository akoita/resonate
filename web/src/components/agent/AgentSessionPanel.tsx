"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useAuth } from "../auth/AuthProvider";
import { useAgentConfig } from "../../hooks/useAgentConfig";
import { useAgentEvents } from "../../hooks/useAgentEvents";
import { useAgentHistory } from "../../hooks/useAgentHistory";
import {
    getAgentNextPick,
    parseAgentSessionRequest,
    type AgentNextPickResponse,
    type AgentNextPreferences,
    type AgentRequestCoverage,
    type AgentSessionEnergy,
    type AgentSessionRequest,
    type AgentSessionRequestIgnoredKey,
} from "../../lib/api";
import { resolveDjQueue } from "../../lib/agentDjPlayback";
import { getDjSet, setDjSet } from "../../lib/agentDjSet";
import {
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
import { useToast } from "../ui/Toast";
import AgentActivityFeed from "./AgentActivityFeed";
import AgentHistoryCard from "./AgentHistoryCard";
import AgentNextPickCard from "./AgentNextPickCard";
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
    const { config, isLoading, createConfig, startSession, stopSession, refetch: refetchConfig } =
        useAgentConfig();
    const events = useAgentEvents();
    const { sessions, isLoading: historyLoading, refetch: refetchHistory } = useAgentHistory();
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
    // The newest render's values, for timers that fire after later renders.
    const latestRef = useRef<{ replan: () => Promise<void>; player: typeof player } | null>(null);
    // A session started from this panel whose first picks should autoplay once
    // they appear. The ref is the synchronous source of truth so the picks play
    // only once; the state drives the polling effect.
    const [awaitingAutoplayId, setAwaitingAutoplayId] = useState<string | null>(null);
    const awaitingAutoplayRef = useRef<string | null>(null);

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
        return (
            buildSessionPreferences({ activePreset, request, fallbackGenres: config?.vibes }) ?? {
                genres: config?.vibes,
            }
        );
    }, [activePreset, request, config?.vibes]);

    /** Put the DJ's picks in the player. Returns how many tracks were queued. */
    const playDjTracks = useCallback(
        async (sessionId: string, trackIds: string[]): Promise<number> => {
            try {
                const queue = await resolveDjQueue(trackIds, token);
                if (queue.length === 0) return 0;
                await saveTracksMetadata(queue, "remote");
                await playQueue(queue, 0);
                // Let the DJ keep adding picks as this queue runs out (AgentDjContinuation).
                setDjSet({
                    sessionId,
                    preferences: buildNextPickPreferences(),
                    trackIds: queue.map((track) => track.catalogTrackId || track.id),
                });
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
            if (result.status !== "ok" || !result.track) {
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
        if (parseTimerRef.current) clearTimeout(parseTimerRef.current);
        parseTimerRef.current = null;
        const sequence = ++parseSeqRef.current;
        if (!value.trim()) {
            setRequest(null);
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
        setParseError(null);
        scheduleReplan();
    };

    const handleRemoveChip = (chipKey: string) => {
        if (request) applyRequestEdit(removeChip(request, chipKey));
    };

    const handleEnergyChange = (band: AgentSessionEnergy) => {
        if (request) applyRequestEdit(setEnergy(request, band));
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
        const interval = setInterval(() => {
            void refetchHistory();
        }, AUTOPLAY_POLL_INTERVAL_MS);
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
    }, [awaitingAutoplayId, refetchHistory, clearAwaitingAutoplay, addToast]);

    // Play the started session's first picks, once.
    useEffect(() => {
        const sessionId = awaitingAutoplayRef.current;
        if (!sessionId) return;
        const session = sessions.find((candidate) => candidate.id === sessionId);
        if (!session || session.licenses.length === 0) return;
        clearAwaitingAutoplay();
        void playDjTracks(sessionId, session.licenses.map((license) => license.trackId));
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
            const startedFrom: SessionStartedFrom = preset ? "preset" : hasFilters(request) ? "prompt" : "plain";
            // A preset or a typed request steers this session only: it travels as
            // session preferences and never overwrites the vibes saved in Settings.
            const preferences = buildSessionPreferences({ activePreset: preset, request });
            try {
                setIsStarting(true);
                const result = await startSession(preferences ? { preferences } : undefined);
                if (result?.sessionId) {
                    setActiveSessionId(result.sessionId);
                    beginAwaitingAutoplay(result.sessionId);
                }
                // Filter kinds and counts only: never the typed sentence or the filter values.
                void recordProductAnalytics(token, "agent.session_started", {
                    source:
                        startedFrom === "preset"
                            ? "agent_session_intent_panel"
                            : startedFrom === "prompt"
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
        setIsPickingNext(true);
        try {
            const result = await getAgentNextPick(token, {
                sessionId: openSessionId,
                preferences: buildNextPickPreferences(),
            });
            void recordProductAnalytics(token, "agent.next_pick_requested", {
                source: "agent_next_pick_card",
                subjectType: "agent_session",
                subjectId: openSessionId,
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
            if (result.status === "ok" && result.track) {
                addToast({
                    type: "success",
                    title: "AI Pick Ready",
                    message: `Playing ${result.track.title}`,
                });
                void playDjTracks(openSessionId, [result.track.id, ...(result.tracks ?? []).map((pick) => pick.trackId)]);
            } else {
                addToast({
                    type: "info",
                    title: "No Pick Returned",
                    message: result.reason ?? result.status,
                });
            }
            void refetchHistory();
        } catch (error) {
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
                        onSubmit={handleSubmit}
                    />

                    {/* Middle row: Status | Activity | Next Pick */}
                    <div className="aid-middle-row">
                        <AgentStatusCard
                            config={config}
                            onToggle={() => handleToggle()}
                            sessionCount={sessions.length}
                            trackCount={sessions.reduce((sum, s) => sum + s.licenses.length, 0)}
                        />
                        <AgentActivityFeed isActive={config.isActive} events={events} />
                        <AgentNextPickCard
                            config={config}
                            activeSessionId={openSessionId}
                            pick={nextPick}
                            isLoading={isPickingNext}
                            onPick={handleNextPick}
                        />
                    </div>

                    {/* Discovery banner */}
                    {!historyLoading && sessions.some((s) => s.licenses.length > 0) && (
                        <div className="aid-discovery-banner">
                            <span>
                                <strong>{sessions.reduce((sum, s) => sum + s.licenses.length, 0)}</strong> tracks discovered across{" "}
                                <strong>{sessions.filter((s) => s.licenses.length > 0).length}</strong> sessions
                            </span>
                            <Link href="/sonic-radar" className="aid-ghost-btn">View on Sonic Radar →</Link>
                        </div>
                    )}

                    {/* History */}
                    <AgentHistoryCard sessions={sessions} isLoading={showHistoryLoader} />

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

export type SessionStartedFrom = "preset" | "prompt" | "plain";

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
