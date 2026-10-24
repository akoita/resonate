"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";
import type {
    AgentDiscoveryLevel,
    AgentMixCoverage,
    AgentMixVocabulary,
    AgentMyMixPreferences,
    AgentRequestCoverage,
    AgentRightNow,
    AgentSessionEnergy,
    AgentSessionRequest,
    AgentSessionRequestIgnoredKey,
    ListeningLane,
} from "../../lib/api";
import {
    SESSION_REQUEST_MAX_TEXT_LENGTH,
    artistChips,
    chipsFromRequest,
    newArtistsChips,
    seedChips,
    coverageLine,
    ignoredKeyLabels,
    readTempoDraft,
    SESSION_TEMPO_MAX_BPM,
    SESSION_TEMPO_MIN_BPM,
} from "../../lib/agentSessionRequest";
import { SESSION_PRESETS, SESSION_PROMPT_EXAMPLES, soundCountLabel, type SessionPreset } from "./sessionPresetData";
import AgentMyMixEditor from "./AgentMyMixEditor";
import { selectedMyMixLanes } from "../../lib/agentMyMix";
import { rightNowPhrase, rightNowReason } from "../../lib/agentRightNow";

/** Where the DJ's saved vibes are edited. */
export const DJ_SETTINGS_HREF = "/settings?section=dj";
const STARTING_TASTE_VISIBLE_VIBES = 3;

/** "Chill, Deep House…" for a few saved vibes; the ellipsis marks that there are more. */
export function startingTasteSummary(vibes: readonly string[]): string {
    const shown = vibes.slice(0, STARTING_TASTE_VISIBLE_VIBES).join(", ");
    return vibes.length > STARTING_TASTE_VISIBLE_VIBES ? `${shown}…` : shown;
}

const MORE_LIKE_TITLE_MAX = 28;

/** A long track title shortened for a button; the full title stays in the tooltip and the seed chip. */
function truncateTitle(title: string): string {
    const clean = title.trim();
    return clean.length > MORE_LIKE_TITLE_MAX ? `${clean.slice(0, MORE_LIKE_TITLE_MAX - 1).trimEnd()}…` : clean;
}

/** The first real example; the placeholder then cycles through all of them (#2249). */
export const SESSION_PROMPT_PLACEHOLDER = SESSION_PROMPT_EXAMPLES[0];
const PLACEHOLDER_ROTATE_MS = 5000;

/**
 * The starter rows (#2249): Moments set a feel (mood, energy, tempo) across all
 * genres; Sounds set everyday genre families. A "For you" row sits above them
 * and shows only what works today: "Right now" (#2245, with its reason) and My Mix.
 */
const PRESET_ROWS: Array<{ key: SessionPreset["group"]; label: string }> = [
    { key: "mood", label: "Moments" },
    { key: "genre", label: "Sounds" },
];

const ENERGY_OPTIONS: AgentSessionEnergy[] = ["low", "medium", "high"];

/**
 * The Discovery control's three steps (#2327), with what each one does in plain words. Mixed is
 * today's behaviour and the default; the hint under the control follows the chosen step.
 */
const DISCOVERY_STEPS: Array<{ level: AgentDiscoveryLevel; label: string; hint: string }> = [
    {
        level: "familiar",
        label: "Familiar",
        hint: "Familiar: the DJ plays what fits your taste and your request. No picks are kept for artists you haven't played.",
    },
    {
        level: "mixed",
        label: "Mixed",
        hint: "Mixed (the default): a few picks are verified artists you haven't played yet, ranked by how well they fit.",
    },
    {
        level: "new",
        label: "New",
        hint: "New: about two in five picks are verified artists you haven't played yet. They still have to match your request.",
    },
];

/** Plain-words summary of a preset, for screen readers and the visible note. */
function presetSummary(preset: SessionPreset): string {
    return `${preset.description} You'll hear: ${preset.output}.`;
}

type Props = {
    text: string;
    onTextChange: (value: string) => void;
    presets?: SessionPreset[];
    /**
     * Playable tracks per Sounds starter intent, from the catalog. A starter with
     * a count shows it lightly ("World Music · 40+"); one without shows none (#2249).
     */
    soundCounts?: Readonly<Record<string, number>>;
    /** Intent of the preset that stands for the current filters, if untouched. */
    activePresetIntent?: string | null;
    onSelectPreset: (preset: SessionPreset) => void;
    request: AgentSessionRequest | null;
    /** Catalog artists the sentence named (#2241), shown as removable "Like: <Artist>" chips. */
    artists?: readonly string[];
    /** What the session starts from (#2244), shown as a removable "From: <label>" chip. */
    seed?: { label: string } | null;
    onRemoveChip: (chipKey: string) => void;
    /** Sets the Energy filter; null clears it back to "the DJ decides". */
    onEnergyChange: (band: AgentSessionEnergy | null) => void;
    /**
     * Sets the Tempo filter (a BPM range, #2327); null clears it. The control is offered only
     * when this is given, so it is never a dead one.
     */
    onTempoChange?: (bpm: NonNullable<AgentSessionRequest["bpm"]> | null) => void;
    /**
     * The Discovery control (#2327): Familiar, Mixed or New. Mixed is the default and today's
     * behaviour. Absent while it does not apply (My Mix), which hides it.
     */
    discovery?: {
        value: AgentDiscoveryLevel;
        onChange: (next: AgentDiscoveryLevel) => void;
    };
    /**
     * The one-time hint after the first finished session (#2327): an example sentence the
     * listener can try, and a way to dismiss it for good. Absent when it should not show.
     */
    tip?: {
        example: string;
        onTry: () => void;
        onDismiss: () => void;
    };
    /** Phrases the DJ could not turn into a filter. */
    unparsed?: string[];
    /** Filters the sentence set that a listening session does not use. */
    ignored?: AgentSessionRequestIgnoredKey[];
    coverage?: AgentRequestCoverage | null;
    /** The sentence is being read (debounce or request in flight). */
    isParsing?: boolean;
    parseError?: string | null;
    /**
     * The DJ's saved vibes: where a session starts when it has no filters.
     * Undefined while the DJ is not loaded, which hides the line.
     */
    savedVibes?: readonly string[];
    /** A session is live: the main action updates it instead of starting one. */
    isLive?: boolean;
    isBusy?: boolean;
    /** The saved "include explicit tracks" choice; applies from the next pick. */
    explicit?: {
        enabled: boolean;
        isSaving?: boolean;
        error?: string | null;
        onChange: (next: boolean) => void;
    };
    /**
     * "Fill with similar sounds" (#2316). Off by default: the DJ plays only what matches
     * the request and says so when the catalog has fewer matches than the set needs. On,
     * it adds similar tracks and marks them. Offered only while the request names a
     * genre, an artist or a seed, because it changes nothing otherwise.
     */
    fillSimilar?: {
        enabled: boolean;
        onChange: (next: boolean) => void;
    };
    /**
     * "Right now" (#2245): the first For you starter. It sets no filters; the session goes by the
     * listener's habits for this time of day, and the reason is always visible. Absent while the
     * summary has not loaded, which hides the starter.
     */
    rightNow?: {
        summary: AgentRightNow;
        selected: boolean;
        onSelect: () => void;
    };
    /**
     * "More like <the track that last resonated>" (#2249): a session seeded from it. Absent when
     * the listener has no resonant track, which hides the starter.
     */
    moreLike?: {
        title: string;
        selected: boolean;
        onSelect: () => void;
    };
    /**
     * "New artists in <your top family>" (#2249): that family's starter, limited to artists the
     * listener has never played. Absent without a top family the catalog can fill.
     */
    newArtists?: {
        familyName: string;
        selected: boolean;
        onSelect: () => void;
    };
    /** The session is limited to artists the listener has never played; shown as a removable chip. */
    newArtistsOnly?: boolean;
    myMix?: {
        lanes: readonly ListeningLane[];
        vocabulary: AgentMixVocabulary;
        preferences: AgentMyMixPreferences | null;
        coverage?: AgentMixCoverage | null;
        isSaving?: boolean;
        saveMessage?: string | null;
        canSave?: boolean;
        onSelect: () => void;
        onChange: (next: AgentMyMixPreferences) => void;
        onSave: () => void;
    };
    onSubmit: () => void;
};

/**
 * "What's this session for?": a sentence box, preset quick starts, and the
 * parsed filters as editable chips. Presentational; the panel owns the state.
 */
export default function AgentSessionPrompt({
    text,
    onTextChange,
    presets = SESSION_PRESETS,
    soundCounts,
    activePresetIntent = null,
    onSelectPreset,
    request,
    artists = [],
    seed = null,
    onRemoveChip,
    onEnergyChange,
    onTempoChange,
    discovery,
    tip,
    unparsed = [],
    ignored = [],
    coverage = null,
    isParsing = false,
    parseError = null,
    savedVibes,
    isLive = false,
    isBusy = false,
    explicit,
    fillSimilar,
    rightNow,
    moreLike,
    newArtists,
    newArtistsOnly = false,
    myMix,
    onSubmit,
}: Props) {
    const id = useId();
    const textId = `${id}-text`;
    const explicitId = `${id}-explicit`;
    const fillSimilarId = `${id}-fill-similar`;
    const energyId = `${id}-energy`;
    const discoveryId = `${id}-discovery`;
    // The selected starter's description is always visible: nothing relies on hover (touch).
    const describedPreset = presets.find((preset) => preset.intent === activePresetIntent) ?? null;
    // The placeholder cycles through real examples while the box is empty.
    const [exampleIndex, setExampleIndex] = useState(0);
    const boxIsEmpty = text.length === 0;
    useEffect(() => {
        if (!boxIsEmpty) return;
        const timer = setInterval(
            () => setExampleIndex((index) => (index + 1) % SESSION_PROMPT_EXAMPLES.length),
            PLACEHOLDER_ROTATE_MS,
        );
        return () => clearInterval(timer);
    }, [boxIsEmpty]);
    const presetDescriptionId = (preset: SessionPreset) =>
        `${id}-preset-${preset.intent.replace(/[^a-zA-Z0-9_-]/g, "")}`;
    const chips = [
        ...seedChips(seed),
        ...newArtistsChips(newArtistsOnly),
        ...artistChips(artists),
        ...chipsFromRequest(request),
    ];
    const ignoredLabels = ignoredKeyLabels(ignored);
    const coverageSummary = coverageLine(coverage, request);
    const myMixHasInputs = myMix?.preferences
        ? selectedMyMixLanes(myMix.preferences, myMix.lanes).length > 0 || (myMix.preferences.additions?.length ?? 0) > 0
        : false;
    const hasMyMixLanes = Boolean(myMix && myMix.lanes.some((lane) => !lane.hidden));
    const submitDisabled = isParsing || isBusy;
    const submitLabel = isBusy
        ? isLive ? "Updating…" : "Starting…"
        : isParsing
            ? "Reading…"
            : isLive ? "Update session" : "Start session";

    return (
        <section className="aid-prompt" aria-labelledby={`${id}-label`} data-testid="agent-session-prompt">
            <label id={`${id}-label`} htmlFor={textId} className="aid-prompt-label">
                What&apos;s this session for?
            </label>
            <textarea
                id={textId}
                className="aid-prompt-input"
                value={text}
                rows={2}
                maxLength={SESSION_REQUEST_MAX_TEXT_LENGTH}
                placeholder={SESSION_PROMPT_EXAMPLES[exampleIndex]}
                onChange={(event) => onTextChange(event.target.value)}
            />
            <p className="aid-prompt-hint">
                Your sentence sets the filters below and helps the DJ find music for this session. It is not saved.
            </p>

            {tip ? (
                <p className="aid-prompt-tip" data-testid="agent-first-session-tip">
                    <span>
                        Tip: you can combine. Try{" "}
                        <button type="button" className="aid-prompt-tip-try" onClick={tip.onTry}>
                            {tip.example}
                        </button>
                    </span>
                    <button
                        type="button"
                        className="aid-prompt-chip-remove"
                        aria-label="Dismiss this tip"
                        onClick={tip.onDismiss}
                    >
                        <span aria-hidden="true">×</span>
                    </button>
                </p>
            ) : null}

            <div className="aid-prompt-preset-groups">
                {/* For you: only what works today (Right now, and My Mix once there are lanes to blend). */}
                {rightNow || moreLike || newArtists || hasMyMixLanes ? (
                    <div className="aid-prompt-preset-group aid-my-mix-choice">
                        <span id={`${id}-presets-for-you`} className="aid-prompt-preset-group-label">
                            For you
                        </span>
                        <div className="aid-prompt-presets" role="group" aria-labelledby={`${id}-presets-for-you`}>
                            {rightNow ? (
                                <button
                                    type="button"
                                    className={`aid-prompt-preset ${rightNow.selected ? "active" : ""}`}
                                    aria-pressed={rightNow.selected}
                                    aria-describedby={`${id}-right-now-reason`}
                                    onClick={rightNow.onSelect}
                                >
                                    Right now
                                </button>
                            ) : null}
                            {moreLike ? (
                                <button
                                    type="button"
                                    className={`aid-prompt-preset ${moreLike.selected ? "active" : ""}`}
                                    aria-pressed={moreLike.selected}
                                    title={`More like ${moreLike.title}`}
                                    aria-label={`More like ${moreLike.title}`}
                                    onClick={moreLike.onSelect}
                                >
                                    More like {truncateTitle(moreLike.title)}
                                </button>
                            ) : null}
                            {newArtists ? (
                                <button
                                    type="button"
                                    className={`aid-prompt-preset ${newArtists.selected ? "active" : ""}`}
                                    aria-pressed={newArtists.selected}
                                    onClick={newArtists.onSelect}
                                >
                                    New artists in {newArtists.familyName}
                                </button>
                            ) : null}
                            {hasMyMixLanes && myMix ? (
                                <button
                                    type="button"
                                    className={`aid-prompt-preset ${myMix.preferences ? "active" : ""}`}
                                    aria-pressed={Boolean(myMix.preferences)}
                                    onClick={myMix.onSelect}
                                >
                                    My Mix
                                </button>
                            ) : null}
                        </div>
                        {/* The reason is always visible (touch has no hover) and says so on a cold start. */}
                        {rightNow ? (
                            <p
                                id={`${id}-right-now-reason`}
                                className="aid-prompt-hint"
                                data-testid="agent-right-now-reason"
                            >
                                {rightNowReason(rightNow.summary)}
                            </p>
                        ) : null}
                        {hasMyMixLanes && myMix?.preferences ? (
                            <AgentMyMixEditor
                                lanes={myMix.lanes}
                                vocabulary={myMix.vocabulary}
                                preferences={myMix.preferences}
                                coverage={myMix.coverage}
                                isSaving={myMix.isSaving}
                                saveMessage={myMix.saveMessage}
                                canSave={myMix.canSave}
                                onChange={myMix.onChange}
                                onSave={myMix.onSave}
                            />
                        ) : null}
                    </div>
                ) : null}

                {PRESET_ROWS.map((row) => {
                    const rowPresets = presets.filter((preset) => preset.group === row.key);
                    if (rowPresets.length === 0) return null;
                    const rowLabelId = `${id}-presets-${row.key}`;
                    return (
                        <div key={row.key} className="aid-prompt-preset-group">
                            <span id={rowLabelId} className="aid-prompt-preset-group-label">
                                {row.label}
                            </span>
                            <div className="aid-prompt-presets" role="group" aria-labelledby={rowLabelId}>
                                {rowPresets.map((preset) => (
                                    <button
                                        key={preset.name}
                                        type="button"
                                        className={`aid-prompt-preset ${activePresetIntent === preset.intent ? "active" : ""}`}
                                        aria-pressed={activePresetIntent === preset.intent}
                                        aria-describedby={presetDescriptionId(preset)}
                                        onClick={() => onSelectPreset(preset)}
                                    >
                                        {preset.name}
                                        {preset.group === "genre" && soundCounts?.[preset.intent] !== undefined ? (
                                            <span className="aid-prompt-preset-count" data-testid="agent-sound-count">
                                                {"· "}
                                                {soundCountLabel(soundCounts[preset.intent])}
                                                <span className="visually-hidden"> tracks</span>
                                            </span>
                                        ) : null}
                                    </button>
                                ))}
                            </div>
                            {/* Descriptions live outside the buttons so they never join the button's name. */}
                            <div className="visually-hidden">
                                {rowPresets.map((preset) => (
                                    <span key={preset.name} id={presetDescriptionId(preset)}>
                                        {presetSummary(preset)}
                                    </span>
                                ))}
                            </div>
                        </div>
                    );
                })}
            </div>
            {describedPreset ? (
                <p className="aid-prompt-preset-about" data-testid="agent-session-preset-about">
                    <strong>{describedPreset.name}.</strong> {describedPreset.description}{" "}
                    <span className="aid-prompt-preset-expect">You&apos;ll hear: {describedPreset.output}.</span>
                </p>
            ) : rightNow?.selected ? (
                <p className="aid-prompt-hint" data-testid="agent-right-now-about">
                    Right now sets no filters. Pick a starter or type a sentence to ask for something specific.
                </p>
            ) : myMix?.preferences ? (
                <p className="aid-prompt-hint">
                    {myMixHasInputs
                        ? "My Mix will blend your selected listening lanes."
                        : "No lanes selected; the DJ will use your usual taste."}
                </p>
            ) : (
                <p className="aid-prompt-hint">Pick a starter to see what it sounds like. It writes a sentence above that you can edit.</p>
            )}

            <div className="aid-prompt-filters" aria-live="polite">
                {chips.length > 0 ? (
                    <ul className="aid-prompt-chips" aria-label="Session filters">
                        {chips.map((chip) => (
                            <li key={chip.key} className={`aid-prompt-chip aid-prompt-chip--${chip.kind}`}>
                                <span>{chip.label}</span>
                                <button
                                    type="button"
                                    className="aid-prompt-chip-remove"
                                    aria-label={`Remove filter ${chip.label}`}
                                    onClick={() => onRemoveChip(chip.key)}
                                >
                                    <span aria-hidden="true">×</span>
                                </button>
                            </li>
                        ))}
                    </ul>
                ) : myMix?.preferences ? null : (
                    <p className="aid-prompt-hint" data-testid="agent-dj-starting-taste">
                        {isParsing ? (
                            "Reading what you wrote…"
                        ) : savedVibes === undefined ? null : savedVibes.length > 0 ? (
                            <>
                                {rightNow?.summary.status === "ready"
                                    ? `With no filters, your DJ follows your usual ${rightNowPhrase(rightNow.summary.context)} mix. Your saved vibes are the fallback: `
                                    : "With no filters, your DJ starts from: "}
                                <strong>{startingTasteSummary(savedVibes)}</strong>
                                {" · "}
                                <Link href={DJ_SETTINGS_HREF}>Edit</Link>
                            </>
                        ) : (
                            <>
                                No saved vibes · <Link href={DJ_SETTINGS_HREF}>Set them</Link>
                            </>
                        )}
                    </p>
                )}
                {coverageSummary ? (
                    <p
                        className={`aid-prompt-note aid-prompt-note--coverage aid-prompt-note--coverage-${coverageSummary.kind}`}
                        data-testid="agent-session-coverage"
                    >
                        {coverageSummary.text}
                    </p>
                ) : null}
                {parseError ? (
                    <p className="aid-prompt-note aid-prompt-note--error" role="status">
                        {parseError}
                    </p>
                ) : null}
                {unparsed.length > 0 ? (
                    <p className="aid-prompt-note">
                        Didn&apos;t catch: {unparsed.map((phrase) => `“${phrase}”`).join(", ")}
                    </p>
                ) : null}
                {ignoredLabels.length > 0 ? (
                    <p className="aid-prompt-note">Not used for listening: {ignoredLabels.join(", ")}</p>
                ) : null}
            </div>

            {/* Adjust: optional filters that combine with any starter or sentence. */}
            <div className="aid-prompt-preset-group" data-testid="agent-session-adjust">
                <span id={`${id}-adjust`} className="aid-prompt-preset-group-label">
                    Adjust
                </span>
                <div className="aid-prompt-adjust-row" role="group" aria-labelledby={`${id}-adjust`}>
                    {myMix?.preferences ? null : (
                        <div className="aid-prompt-adjust-energy">
                            <label className="aid-prompt-chip-label" htmlFor={energyId}>
                                Energy
                            </label>
                            <select
                                id={energyId}
                                className="aid-prompt-chip-select"
                                value={request?.energy ?? ""}
                                onChange={(event) =>
                                    onEnergyChange(event.target.value === "" ? null : (event.target.value as AgentSessionEnergy))
                                }
                            >
                                <option value="">Any (the DJ decides)</option>
                                {ENERGY_OPTIONS.map((band) => (
                                    <option key={band} value={band}>
                                        {band[0].toUpperCase() + band.slice(1)}
                                    </option>
                                ))}
                            </select>
                        </div>
                    )}
                    {onTempoChange && !myMix?.preferences ? (
                        <TempoFilter bpm={request?.bpm ?? null} onChange={onTempoChange} />
                    ) : null}
                    {explicit ? (
                        <div className="aid-prompt-explicit">
                            <label className="aid-prompt-explicit-label" htmlFor={explicitId}>
                                <input
                                    id={explicitId}
                                    type="checkbox"
                                    checked={explicit.enabled}
                                    disabled={explicit.isSaving}
                                    aria-describedby={`${explicitId}-hint`}
                                    onChange={(event) => explicit.onChange(event.target.checked)}
                                />
                                <span>Include explicit tracks</span>
                            </label>
                            <p id={`${explicitId}-hint`} className="aid-prompt-hint">
                                Applies from the next pick.
                            </p>
                            {explicit.error ? (
                                <p className="aid-prompt-note aid-prompt-note--error" role="status">
                                    {explicit.error}
                                </p>
                            ) : null}
                        </div>
                    ) : null}
                    {fillSimilar && !myMix?.preferences ? (
                        <div className="aid-prompt-explicit" data-testid="agent-session-fill-similar">
                            <label className="aid-prompt-explicit-label" htmlFor={fillSimilarId}>
                                <input
                                    id={fillSimilarId}
                                    type="checkbox"
                                    role="switch"
                                    checked={fillSimilar.enabled}
                                    aria-describedby={`${fillSimilarId}-hint`}
                                    onChange={(event) => fillSimilar.onChange(event.target.checked)}
                                />
                                <span>Fill with similar sounds</span>
                            </label>
                            <p id={`${fillSimilarId}-hint`} className="aid-prompt-hint">
                                {fillSimilar.enabled
                                    ? "When the catalog runs short, the DJ adds similar tracks and marks them as outside your request."
                                    : "Off: the DJ plays only what matches your request, even if that means a shorter set."}
                            </p>
                        </div>
                    ) : null}
                </div>
                {discovery ? (
                    <div className="aid-prompt-discovery" data-testid="agent-session-discovery">
                        <span id={discoveryId} className="aid-prompt-chip-label">
                            Discovery
                        </span>
                        <div className="aid-prompt-presets" role="group" aria-labelledby={discoveryId}>
                            {DISCOVERY_STEPS.map((step) => (
                                <button
                                    key={step.level}
                                    type="button"
                                    className={`aid-prompt-preset ${discovery.value === step.level ? "active" : ""}`}
                                    aria-pressed={discovery.value === step.level}
                                    aria-describedby={`${discoveryId}-hint`}
                                    onClick={() => discovery.onChange(step.level)}
                                >
                                    {step.label}
                                </button>
                            ))}
                        </div>
                        <p id={`${discoveryId}-hint`} className="aid-prompt-hint">
                            {DISCOVERY_STEPS.find((step) => step.level === discovery.value)?.hint}
                        </p>
                    </div>
                ) : null}
            </div>

            <div className="aid-prompt-actions">
                <button type="button" className="aid-prompt-submit" disabled={submitDisabled} onClick={onSubmit}>
                    {submitLabel}
                </button>
            </div>
        </section>
    );
}

const TEMPO_MESSAGE_NOTE =
    "Only tracks with a measured tempo can match. A track without one never counts as a match; it comes after the matches.";

/**
 * The Tempo filter (#2327): a BPM range in the Adjust row. It edits the request's own tempo, the
 * same one a sentence like "around 122 BPM" sets, so it combines with any starter or sentence and
 * the BPM chip removes it. A half-typed or out-of-range number is not applied.
 */
function TempoFilter({
    bpm,
    onChange,
}: {
    bpm: NonNullable<AgentSessionRequest["bpm"]> | null;
    onChange: (next: NonNullable<AgentSessionRequest["bpm"]> | null) => void;
}) {
    const id = useId();
    const propMin = bpm?.min ?? null;
    const propMax = bpm?.max ?? null;
    const [draft, setDraft] = useState({
        min: propMin === null ? "" : String(propMin),
        max: propMax === null ? "" : String(propMax),
    });
    const reading = readTempoDraft(draft.min, draft.max);

    // A change made elsewhere (the BPM chip, a new sentence, a starter) replaces what is typed here.
    // Adjusted during render, from the props last seen, so no effect or ref is needed.
    const [seen, setSeen] = useState({ min: propMin, max: propMax });
    if (seen.min !== propMin || seen.max !== propMax) {
        setSeen({ min: propMin, max: propMax });
        const typed = reading.kind === "range" ? reading.bpm : reading.kind === "clear" ? { min: null, max: null } : null;
        if (!typed || typed.min !== propMin || typed.max !== propMax) {
            setDraft({
                min: propMin === null ? "" : String(propMin),
                max: propMax === null ? "" : String(propMax),
            });
        }
    }

    const edit = (next: { min: string; max: string }) => {
        setDraft(next);
        const read = readTempoDraft(next.min, next.max);
        if (read.kind === "range") onChange(read.bpm);
        else if (read.kind === "clear") onChange(null);
    };
    const hasValue = draft.min !== "" || draft.max !== "";

    return (
        <div className="aid-prompt-adjust-tempo" data-testid="agent-session-tempo" role="group" aria-labelledby={`${id}-label`}>
            <div className="aid-prompt-adjust-tempo-fields">
                <span id={`${id}-label`} className="aid-prompt-chip-label">
                    Tempo (BPM)
                </span>
                <input
                    type="text"
                    inputMode="numeric"
                    className="aid-prompt-tempo-input"
                    aria-label="Lowest tempo in BPM"
                    aria-describedby={`${id}-note`}
                    placeholder={`${SESSION_TEMPO_MIN_BPM}+`}
                    maxLength={6}
                    value={draft.min}
                    onChange={(event) => edit({ ...draft, min: event.target.value })}
                />
                <span aria-hidden="true">to</span>
                <input
                    type="text"
                    inputMode="numeric"
                    className="aid-prompt-tempo-input"
                    aria-label="Highest tempo in BPM"
                    aria-describedby={`${id}-note`}
                    placeholder={`up to ${SESSION_TEMPO_MAX_BPM}`}
                    maxLength={6}
                    value={draft.max}
                    onChange={(event) => edit({ ...draft, max: event.target.value })}
                />
                {hasValue ? (
                    <button
                        type="button"
                        className="aid-prompt-tempo-clear"
                        onClick={() => {
                            setDraft({ min: "", max: "" });
                            onChange(null);
                        }}
                    >
                        Clear tempo
                    </button>
                ) : null}
            </div>
            {reading.kind === "invalid" ? (
                <p className="aid-prompt-note aid-prompt-note--error" role="status">
                    {reading.message}
                </p>
            ) : null}
            <p id={`${id}-note`} className="aid-prompt-hint">
                {TEMPO_MESSAGE_NOTE}
            </p>
        </div>
    );
}
