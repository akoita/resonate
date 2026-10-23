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
    getAgentSounds,
    getTasteMemory,
    parseAgentSessionRequest,
    type AgentMixCoverage,
    type AgentMixVocabulary,
    type AgentMyMixPreferences,
    type AgentNextPreferences,
    type AgentRequestCoverage,
    type AgentSessionEnergy,
    type AgentSessionRequest,
    type AgentSessionRequestIgnoredKey,
    type AgentSounds,
    type ListeningLane,
} from "../../lib/api";
import {
    buildMyMixTasteEdits,
    createMyMixPreferences,
    getMyMixLocalContext,
} from "../../lib/agentMyMix";
import { resolveDjQueue } from "../../lib/agentDjPlayback";
import { getDjSet, setDjSet, useDjSet, type DjPickNote } from "../../lib/agentDjSet";
import {
    emptyRequest,
    hasFilters,
    removeArtistChip,
    removeChip,
    requestFilterKeys,
    SEED_CHIP_KEY,
    requestFromPreset,
    setEnergy,
    trackIdsAt,
    upcomingDjIndices,
} from "../../lib/agentSessionRequest";
import { DJ_SEED_EVENT, takeDjSeed, type DjSeed } from "../../lib/djSeed";
import { saveTracksMetadata } from "../../lib/localLibrary";
import { usePlayer } from "../../lib/playerContext";
import { recordProductAnalytics } from "../../lib/productAnalytics";
import { sonicRadarSessionLine } from "../../lib/sonicRadarSummary";
import { useToast } from "../ui/Toast";
import AgentHistoryCard from "./AgentHistoryCard";
import { humanPickReason } from "../../lib/agentPickReason";
import AgentUpNextCard from "./AgentUpNextCard";
import { useDjUpNext } from "./useDjUpNext";
import { pickNotesFromLicenses, pickNotesFromResponse } from "../../lib/agentUpNext";
import AgentSessionPrompt from "./AgentSessionPrompt";
import { SESSION_PRESETS, soundPresetsForFamilies, type SessionPreset } from "./sessionPresetData";
import { buildPickPreferences, buildSessionPreferences, toIntentPreferences } from "./sessionPreferences";
import AgentSetupWizard from "./AgentSetupWizard";
import AgentCommandBar from "./AgentCommandBar";
import AgentEventsDebug from "./AgentEventsDebug";

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
    const liveDjSet = useDjSet();
    const radarLine = sonicRadarSessionLine(journal, liveDjSet?.trackIds);
    const { addToast } = useToast();
    const player = usePlayer();
    const { playQueue } = player;
    const [wizardOpen, setWizardOpen] = useState(false);
    const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
    // What this session is for. The typed sentence lives in memory here only: it is parsed into
    // `request` and, while the chips stand, travels with the session so the DJ can search by its
    // meaning (#2241). It is never stored in the browser, and the server never stores or logs it.
    const [text, setText] = useState("");
    // The sentence the current chips were read from, and the catalog artists it named. Both are
    // dropped as soon as the listener edits the chips by hand or picks a starter.
    const [parsedSentence, setParsedSentence] = useState<string | null>(null);
    const [artists, setArtists] = useState<string[]>([]);
    // What the session starts from (#2244): a track, an artist or a playlist, queued by a
    // "Start a DJ session from this" button. It stays for the whole session until removed.
    const [seed, setSeed] = useState<DjSeed | null>(null);
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
    // The catalog's Sounds for this listener (#2249); null until loaded or when the request fails,
    // which keeps the static Sounds starters.
    const [sounds, setSounds] = useState<AgentSounds | null>(null);
    const [explicitError, setExplicitError] = useState<string | null>(null);
    const [isParsing, setIsParsing] = useState(false);
    const [parseError, setParseError] = useState<string | null>(null);
    const [isStarting, setIsStarting] = useState(false);
    const [isReplanning, setIsReplanning] = useState(false);
    // Coverage from the latest pick this panel requested (the live event stream may carry a newer one).
    const [pickCoverage, setPickCoverage] = useState<{ coverage: AgentRequestCoverage | null; at: number } | null>(null);
    const parseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const parseSeqRef = useRef(0);
    const replanTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const replanSeqRef = useRef(0);
    const myMixPreferencesRef = useRef<AgentMyMixPreferences | null>(null);
    const myMixEditVersionRef = useRef(0);
    const myMixWasSelectedRef = useRef(false);
    const initialMixCoverageVersionRef = useRef<number | null>(null);
    // Where this session's filters began (#2249), for analytics: a starter's row and id,
    // and whether the listener then edited its sentence or chips. Never the text itself.
    const starterRef = useRef<{ row: StarterRow; id: string; edited: boolean } | null>(null);
    // The Energy filter was set from the Adjust row (not read from a sentence or a starter).
    const energyAdjustedRef = useRef(false);
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

    // The Sounds row follows the catalog: one cached request per explicit choice, never per render.
    const soundsExplicit = explicitPending ?? config?.allowExplicit;
    useEffect(() => {
        if (!token) {
            setSounds(null);
            return;
        }
        let current = true;
        void getAgentSounds(token, soundsExplicit)
            .then((next) => {
                if (current) setSounds(next);
            })
            .catch(() => {
                if (current) setSounds(null);
            });
        return () => { current = false; };
    }, [token, soundsExplicit]);

    const { starterPresets, soundCounts } = useMemo(() => {
        if (!sounds) return { starterPresets: SESSION_PRESETS, soundCounts: undefined };
        const available = soundPresetsForFamilies(sounds.families, sounds.minTracks);
        return {
            starterPresets: [
                ...SESSION_PRESETS.filter((preset) => preset.group === "mood"),
                ...available.presets,
            ],
            soundCounts: available.counts,
        };
    }, [sounds]);

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
        const regularPreferences = buildPickPreferences({
            activePreset,
            request,
            savedVibes: config?.vibes,
            sentence: parsedSentence,
            artists,
            seed,
        });
        return myMixWasSelectedRef.current
            ? { ...regularPreferences, myMix: null }
            : regularPreferences;
    }, [myMixPreferences, activePreset, request, config?.vibes, parsedSentence, artists, seed]);

    /** Put the DJ's picks in the player. Returns how many tracks were queued. */
    const playDjTracks = useCallback(
        async (sessionId: string, trackIds: string[], notes?: Record<string, DjPickNote>): Promise<number> => {
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
                    ...(notes && Object.keys(notes).length > 0 ? { picks: notes } : {}),
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

    // Now & Up next: the playing DJ track, the next picks, and the actions that steer them (#2243).
    const upNext = useDjUpNext({
        token,
        sessionId: config?.isActive ? openSessionId : null,
        buildPreferences: buildNextPickPreferences,
        surface: ANALYTICS_SURFACE,
        intent: activePreset?.intent,
        intentName: activePreset?.name,
        onPicks: (result) => {
            setPickCoverage({ coverage: result.requestCoverage ?? null, at: Date.now() });
            if (myMixPreferences) setMyMixCoverage(result.mixCoverage ?? null);
            void refetchHistory();
        },
    });

    // How well the latest picks matched the filters: the newest of this panel's own
    // pick response and the event stream's newest decision for the open session.
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
     *
     * With no DJ set in the player (nothing from this session is playing), an edit
     * does nothing by itself; the explicit "Update session" (`playIfIdle`) asks the
     * DJ for picks that follow the filters and starts playing them, which is also
     * the way back when the first picks could not play.
     */
    const replanUpcoming = async ({ playIfIdle = false }: { playIfIdle?: boolean } = {}) => {
        if (!token || !openSessionId || !config?.isActive) return;
        const set = getDjSet();
        const idle = !set || set.sessionId !== openSessionId;
        if (idle && !playIfIdle) return;
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
                    message: idle
                        ? humanPickReason(result.status, result.reason, myMixPreferences ? result.mixCoverage ?? null : null)
                        : result.reason ?? "The DJ kept your upcoming tracks.",
                });
                return;
            }
            const ids = Array.from(
                new Set([result.track.id, ...(result.tracks ?? []).map((pick) => pick.trackId)]),
            );
            if (idle) {
                // Nothing of this session is playing: these picks start the set.
                clearAwaitingAutoplay();
                await playDjTracks(openSessionId, ids, pickNotesFromResponse(result));
                void refetchHistory();
                return;
            }
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
                picks: { ...(live.picks ?? {}), ...pickNotesFromResponse(result) },
            });
            // The server recorded the new picks on the session; show them in Session History.
            void refetchHistory();
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

    // A "Start a DJ session from this" button queued a seed (#2244): take it on arrival and
    // whenever another one is queued while Home is already open. A live set follows it too.
    useEffect(() => {
        const adopt = () => {
            const queued = takeDjSeed();
            if (!queued) return;
            setSeed(queued);
            // A seeded session replaces My Mix, as typing a sentence does.
            if (myMixPreferencesRef.current) {
                setMyMixPreferences(null);
                myMixWasSelectedRef.current = true;
                invalidateMyMixCoverage();
                setMyMixSaveMessage(null);
            }
            scheduleReplan();
        };
        adopt();
        if (typeof window === "undefined") return;
        window.addEventListener(DJ_SEED_EVENT, adopt);
        return () => window.removeEventListener(DJ_SEED_EVENT, adopt);
    }, [config?.id]);

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
            setParsedSentence(sentence);
            setArtists(parsed.artists ?? []);
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
        // A new sentence replaces the Adjust energy; a starter whose sentence is edited is marked so.
        energyAdjustedRef.current = false;
        if (!value.trim()) starterRef.current = null;
        else if (starterRef.current) starterRef.current.edited = true;
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
            setParsedSentence(null);
            setArtists([]);
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
    const applyRequestEdit = (next: AgentSessionRequest, options: { keepSentence?: boolean } = {}) => {
        cancelParse();
        // Removing a chip is the listener's own reading of the session: stop using the sentence's wording.
        if (!options.keepSentence) {
            setParsedSentence(null);
            setArtists([]);
        }
        setRequest(next);
        setActivePreset(null);
        if (starterRef.current) starterRef.current.edited = true;
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
        if (chipKey === SEED_CHIP_KEY) {
            // Removing the chip drops the seed; the filters and the sentence stay as they are.
            setSeed(null);
            scheduleReplan();
            return;
        }
        if (chipKey === "energy") energyAdjustedRef.current = false;
        if (chipKey.startsWith("artist:")) {
            // Only this artist goes; the rest of the sentence still steers the session.
            setArtists(removeArtistChip(artists, chipKey));
            applyRequestEdit(request ?? emptyRequest(), { keepSentence: true });
            return;
        }
        if (request) applyRequestEdit(removeChip(request, chipKey));
    };

    /**
     * The Adjust row's Energy filter. It combines with whatever is already chosen:
     * a starter stays selected and a sentence keeps its other filters; only the
     * energy band changes. Null returns the choice to the DJ.
     */
    const handleEnergyChange = (band: AgentSessionEnergy | null) => {
        cancelParse();
        energyAdjustedRef.current = band !== null;
        setRequest(setEnergy(request ?? emptyRequest(), band));
        setParseError(null);
        scheduleReplan();
    };

    const handleSelectMyMix = () => {
        cancelParse();
        energyAdjustedRef.current = false;
        starterRef.current = { row: "for_you", id: "my_mix", edited: false };
        setText("");
        setRequest(null);
        setParsedSentence(null);
        setArtists([]);
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
                message: "Try other filters, or start a session with another quick start.",
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
        void playDjTracks(
            sessionId,
            session.mixTrackIds ?? session.licenses.map((license) => license.trackId),
            pickNotesFromLicenses(session.licenses),
        );
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
            const starter = myMixPreferences ? { row: "for_you", id: "my_mix", edited: false } : starterRef.current;
            // Optional filters in use: Energy set from the Adjust row, and the explicit choice.
            const optionalFilters = [
                ...(energyAdjustedRef.current && !myMixPreferences && request?.energy ? ["energy"] : []),
                ...((explicitPending ?? config?.allowExplicit ?? false) ? ["explicit"] : []),
            ];
            const startedFrom: SessionStartedFrom = myMixPreferences
                ? "my_mix"
                : preset ? "preset" : hasFilters(request) ? "prompt" : "plain";
            // A preset or a typed request steers this session only: it travels as
            // session preferences and never overwrites the vibes saved in Settings.
            const preferences = myMixPreferences
                ? { myMix: { ...myMixPreferences, context: getMyMixLocalContext() } }
                : buildSessionPreferences({ activePreset: preset, request, sentence: parsedSentence, artists, seed });
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
                    // Every start comes from the prompt's button (#2237), so the
                    // command-bar source no longer applies to starts; `startedFrom`
                    // still tells a plain start from a described one.
                    source:
                        startedFrom === "preset" ? "agent_session_intent_panel" : "agent_session_prompt",
                    subjectType: "agent_session",
                    subjectId: result?.sessionId,
                    payload: {
                        surface: ANALYTICS_SURFACE,
                        startedFrom,
                        // Seeded sessions (#2244): the kind only, never the id or the label.
                        seedKind: !myMixPreferences ? seed?.kind : undefined,
                        intent: preset?.intent,
                        intentName: preset?.name,
                        energy: preset?.preferences.energy,
                        mood: preset?.preferences.mood,
                        queueStyle: preset?.queueStyle,
                        requestFilterKeys: requestFilterKeys(request),
                        unparsedCount: unparsed.length,
                        ignoredKeys: ignored,
                        // Where the filters began (#2249); ids and flags only, never the sentence.
                        starterRow: starter?.row,
                        starterId: starter?.id,
                        starterEdited: starter?.edited,
                        optionalFilters,
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
        // A starter writes its sentence into the prompt and shows the filters that sentence
        // reads as, without waiting for the parser. The listener can edit either.
        cancelParse();
        setText(preset.sentence);
        // An Energy chosen in the Adjust row combines with the starter instead of being lost.
        const adjustedEnergy = energyAdjustedRef.current ? (request?.energy ?? null) : null;
        const starterRequest = requestFromPreset(preset);
        setRequest(adjustedEnergy ? { ...starterRequest, energy: adjustedEnergy } : starterRequest);
        // A starter's canned sentence is not sent; its filters and intent are the session.
        setParsedSentence(null);
        setArtists([]);
        setUnparsed([]);
        setIgnored([]);
        setParseError(null);
        setActivePreset(preset);
        starterRef.current = { row: starterRowOf(preset), id: preset.intent, edited: false };
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
                starterRow: starterRowOf(preset),
                starterId: preset.intent,
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
        await replanUpcoming({ playIfIdle: true });
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
                    <AgentCommandBar name={config.name} isLive={config.isActive} onStop={() => handleToggle()} />

                    {/* What's this session for? */}
                    <AgentSessionPrompt
                        text={text}
                        onTextChange={handleTextChange}
                        presets={starterPresets}
                        soundCounts={soundCounts}
                        activePresetIntent={activePreset?.intent ?? null}
                        onSelectPreset={handleSelectPreset}
                        request={request}
                        artists={artists}
                        seed={seed}
                        onRemoveChip={handleRemoveChip}
                        onEnergyChange={handleEnergyChange}
                        unparsed={unparsed}
                        ignored={ignored}
                        coverage={config.isActive ? coverage : null}
                        isParsing={isParsing}
                        parseError={parseError}
                        savedVibes={config.vibes}
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

                    {/* Now & Up next: what plays, what is queued, and how to steer it (#2243) */}
                    <AgentUpNextCard
                        sessionLive={Boolean(config.isActive && openSessionId)}
                        now={upNext.view.now}
                        upNext={upNext.view.upNext}
                        busy={upNext.busy}
                        notice={upNext.notice}
                        mixCoverage={myMixPreferences ? myMixCoverage : null}
                        onSkip={() => void upNext.skip()}
                        onNotThis={(item) => void upNext.notThis(item)}
                        onMoreLikeThis={(item) => void upNext.moreLikeThis(item)}
                    />

                    <AgentEventsDebug events={events} />

                    {/* Session Sonic Radar line (#2313): only this session's tracks; nothing when empty. */}
                    {!journalLoading && radarLine.kind !== "none" && (
                        <div className="aid-discovery-banner">
                            {radarLine.kind === "session" ? (
                                <>
                                    <span>
                                        From this session:{" "}
                                        {radarLine.saved > 0 && <><strong>{radarLine.saved}</strong> saved</>}
                                        {radarLine.saved > 0 && radarLine.replayed > 0 && ", "}
                                        {radarLine.replayed > 0 && <><strong>{radarLine.replayed}</strong> replayed</>}
                                    </span>
                                    <Link href="/sonic-radar" className="aid-ghost-btn">Sonic Radar →</Link>
                                </>
                            ) : (
                                <>
                                    <span>
                                        <strong>{radarLine.count}</strong> {radarLine.count === 1 ? "track" : "tracks"} you played through this week {radarLine.count === 1 ? "is" : "are"} one save away from your Sonic Radar
                                    </span>
                                    <Link href="/sonic-radar" className="aid-ghost-btn">Review them →</Link>
                                </>
                            )}
                        </div>
                    )}

                    {/* History */}
                    <AgentHistoryCard
                        sessions={sessions}
                        totalCount={lifetime.sessionCount}
                        totalTracks={lifetime.trackCount}
                        isLoading={showHistoryLoader}
                    />

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

export type StarterRow = "moments" | "sounds" | "for_you";

/** The analytics name of the row a starter sits in. */
function starterRowOf(preset: SessionPreset): StarterRow {
    return preset.group === "mood" ? "moments" : "sounds";
}

export type SessionStartedFrom = "preset" | "prompt" | "plain" | "my_mix";

export { buildPickPreferences, buildSessionPreferences, toIntentPreferences };
