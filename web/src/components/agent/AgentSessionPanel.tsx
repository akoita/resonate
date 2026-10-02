"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useAuth } from "../auth/AuthProvider";
import { useAgentConfig } from "../../hooks/useAgentConfig";
import { useAgentEvents } from "../../hooks/useAgentEvents";
import { useAgentHistory } from "../../hooks/useAgentHistory";
import {
    getAgentNextPick,
    type AgentNextPickResponse,
    type AgentNextPreferences,
} from "../../lib/api";
import { resolveDjQueue } from "../../lib/agentDjPlayback";
import { setDjSet } from "../../lib/agentDjSet";
import { saveTracksMetadata } from "../../lib/localLibrary";
import { usePlayer } from "../../lib/playerContext";
import { recordProductAnalytics } from "../../lib/productAnalytics";
import { useToast } from "../ui/Toast";
import AgentActivityFeed from "./AgentActivityFeed";
import AgentHistoryCard from "./AgentHistoryCard";
import AgentNextPickCard from "./AgentNextPickCard";
import AgentSessionPresets, { SESSION_PRESETS, type SessionPreset } from "./AgentSessionPresets";
import AgentSetupWizard from "./AgentSetupWizard";
import AgentStatusCard from "./AgentStatusCard";

/** Analytics surface for the DJ session panel (it lives in the Home `#ai-dj` section). */
const ANALYTICS_SURFACE = "home";

/** How often to refetch history while waiting for a started session's first picks. */
const AUTOPLAY_POLL_INTERVAL_MS = 3000;
/** Give up waiting for a started session's first picks after this long (LLM search can take ~30s). */
const AUTOPLAY_MAX_WAIT_MS = 45000;

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
    const { playQueue } = usePlayer();
    const [wizardOpen, setWizardOpen] = useState(false);
    const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
    const [nextPick, setNextPick] = useState<AgentNextPickResponse | null>(null);
    const [isPickingNext, setIsPickingNext] = useState(false);
    const [selectedPreset, setSelectedPreset] = useState<SessionPreset | null>(SESSION_PRESETS[0] ?? null);
    const [isStartingPreset, setIsStartingPreset] = useState(false);
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

    const selectedIntentPreferences = useMemo(() => {
        return selectedPreset ? toIntentPreferences(selectedPreset) : null;
    }, [selectedPreset]);

    /** The preferences a next-pick request carries; also what the continuation reuses to keep the set going. */
    const buildNextPickPreferences = useCallback((): AgentNextPreferences => {
        return {
            ...(selectedIntentPreferences ?? {}),
            genres: selectedIntentPreferences?.genres ?? config?.vibes,
        };
    }, [selectedIntentPreferences, config?.vibes]);

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

    const handleToggle = async (preset: SessionPreset | null = null) => {
        if (config?.isActive) {
            const stoppedSessionId = openSessionId;
            const stoppedSession = stoppedSessionId ? sessions.find((session) => session.id === stoppedSessionId) : null;
            await stopSession();
            // Stopping the session stops the DJ adding picks to the player.
            setDjSet(null);
            clearAwaitingAutoplay();
            setActiveSessionId(null);
            setNextPick(null);
            void recordProductAnalytics(token, "agent.session_stopped", {
                source: "agent_command_bar",
                subjectType: "agent_session",
                subjectId: stoppedSessionId ?? undefined,
                payload: {
                    surface: ANALYTICS_SURFACE,
                    intent: selectedPreset?.intent,
                    intentName: selectedPreset?.name,
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
            const preferences = preset ? toIntentPreferences(preset) : undefined;
            try {
                // A preset steers this session only: it travels as session
                // preferences and never overwrites the vibes saved in Settings.
                if (preset) setIsStartingPreset(true);
                const result = await startSession(preferences ? { preferences } : undefined);
                if (result?.sessionId) {
                    setActiveSessionId(result.sessionId);
                    beginAwaitingAutoplay(result.sessionId);
                }
                void recordProductAnalytics(token, "agent.session_started", {
                    source: preset ? "agent_session_intent_panel" : "agent_command_bar",
                    subjectType: "agent_session",
                    subjectId: result?.sessionId,
                    payload: {
                        surface: ANALYTICS_SURFACE,
                        intent: preset?.intent,
                        intentName: preset?.name,
                        energy: preset?.preferences.energy,
                        mood: preset?.preferences.mood,
                        queueStyle: preset?.queueStyle,
                    },
                });
                addToast({
                    type: "info",
                    title: "Session Started",
                    message: preset
                        ? `${preset.name} is now guiding the queue.`
                        : "Your DJ is picking tracks and will start playing shortly.",
                });
                // History is polled by the autoplay effect until the first picks arrive.
            } finally {
                setIsStartingPreset(false);
            }
        }
    };

    const handleSelectPreset = (preset: SessionPreset) => {
        setSelectedPreset(preset);
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

    const handleStartPreset = async (preset: SessionPreset) => {
        handleSelectPreset(preset);
        await handleToggle(preset);
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
                    intent: selectedPreset?.intent,
                    intentName: selectedPreset?.name,
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

                    {/* Preset strip */}
                    <AgentSessionPresets
                        selectedIntent={selectedPreset?.intent}
                        isStarting={isStartingPreset}
                        showOpenLink={false}
                        onSelect={handleSelectPreset}
                        onStart={handleStartPreset}
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

function toIntentPreferences(preset: SessionPreset): AgentNextPreferences {
    return {
        ...preset.preferences,
        genres: preset.searchVibes,
        sessionIntent: preset.intent,
        sessionIntentName: preset.name,
        queueStyle: preset.queueStyle,
        source: "agent_session_intent",
    };
}
