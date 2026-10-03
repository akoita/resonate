"use client";

import { useId, useState } from "react";
import type {
    AgentMixCoverage,
    AgentMixVocabulary,
    AgentMyMixPreferences,
    AgentRequestCoverage,
    AgentSessionEnergy,
    AgentSessionRequest,
    AgentSessionRequestIgnoredKey,
    ListeningLane,
} from "../../lib/api";
import {
    SESSION_ENERGY_BANDS,
    SESSION_REQUEST_MAX_TEXT_LENGTH,
    chipsFromRequest,
    coverageNotes,
    ignoredKeyLabels,
} from "../../lib/agentSessionRequest";
import { SESSION_PRESETS, type SessionPreset } from "./AgentSessionPresets";
import AgentMyMixEditor from "./AgentMyMixEditor";
import { selectedMyMixLanes } from "../../lib/agentMyMix";

export const SESSION_PROMPT_PLACEHOLDER = "Warm deep house around 122 BPM for cooking";

/** Everyday genres first, then the mood presets (#2052). */
const PRESET_GROUPS: Array<{ key: SessionPreset["group"]; label: string }> = [
    { key: "genre", label: "Genres" },
    { key: "mood", label: "Moods" },
];

/** Plain-words summary of a preset, for screen readers and the visible note. */
function presetSummary(preset: SessionPreset): string {
    return `${preset.description} You'll hear: ${preset.output}.`;
}

type Props = {
    text: string;
    onTextChange: (value: string) => void;
    presets?: SessionPreset[];
    /** Intent of the preset that stands for the current filters, if untouched. */
    activePresetIntent?: string | null;
    onSelectPreset: (preset: SessionPreset) => void;
    request: AgentSessionRequest | null;
    onRemoveChip: (chipKey: string) => void;
    onEnergyChange: (band: AgentSessionEnergy) => void;
    /** Phrases the DJ could not turn into a filter. */
    unparsed?: string[];
    /** Filters the sentence set that a listening session does not use. */
    ignored?: AgentSessionRequestIgnoredKey[];
    coverage?: AgentRequestCoverage | null;
    /** The sentence is being read (debounce or request in flight). */
    isParsing?: boolean;
    parseError?: string | null;
    /** A session is live: the main action updates it instead of starting one. */
    isLive?: boolean;
    isBusy?: boolean;
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
    activePresetIntent = null,
    onSelectPreset,
    request,
    onRemoveChip,
    onEnergyChange,
    unparsed = [],
    ignored = [],
    coverage = null,
    isParsing = false,
    parseError = null,
    isLive = false,
    isBusy = false,
    myMix,
    onSubmit,
}: Props) {
    const id = useId();
    const textId = `${id}-text`;
    // The preset under the pointer or keyboard focus, else the selected one.
    const [previewIntent, setPreviewIntent] = useState<string | null>(null);
    const describedPreset =
        presets.find((preset) => preset.intent === previewIntent) ??
        presets.find((preset) => preset.intent === activePresetIntent) ??
        null;
    const presetDescriptionId = (preset: SessionPreset) =>
        `${id}-preset-${preset.intent.replace(/[^a-zA-Z0-9_-]/g, "")}`;
    const chips = chipsFromRequest(request);
    const ignoredLabels = ignoredKeyLabels(ignored);
    const notes = coverageNotes(coverage, request);
    const myMixHasInputs = myMix?.preferences
        ? selectedMyMixLanes(myMix.preferences, myMix.lanes).length > 0 || (myMix.preferences.additions?.length ?? 0) > 0
        : false;
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
                placeholder={SESSION_PROMPT_PLACEHOLDER}
                onChange={(event) => onTextChange(event.target.value)}
            />
            <p className="aid-prompt-hint">
                Your sentence is read once to set the filters below and is not saved.
            </p>

            {myMix && myMix.lanes.some((lane) => !lane.hidden) ? (
                <div className="aid-my-mix-choice">
                    <button
                        type="button"
                        className={`aid-prompt-preset ${myMix.preferences ? "active" : ""}`}
                        aria-pressed={Boolean(myMix.preferences)}
                        onClick={myMix.onSelect}
                    >
                        My Mix
                    </button>
                    {myMix.preferences ? (
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

            <div className="aid-prompt-preset-groups" onMouseLeave={() => setPreviewIntent(null)}>
                {PRESET_GROUPS.map((group) => {
                    const groupPresets = presets.filter((preset) => preset.group === group.key);
                    if (groupPresets.length === 0) return null;
                    const groupLabelId = `${id}-presets-${group.key}`;
                    return (
                        <div key={group.key} className="aid-prompt-preset-group">
                            <span id={groupLabelId} className="aid-prompt-preset-group-label">
                                {group.label}
                            </span>
                            <div className="aid-prompt-presets" role="group" aria-labelledby={groupLabelId}>
                                {groupPresets.map((preset) => (
                                    <button
                                        key={preset.name}
                                        type="button"
                                        className={`aid-prompt-preset ${activePresetIntent === preset.intent ? "active" : ""}`}
                                        aria-pressed={activePresetIntent === preset.intent}
                                        aria-describedby={presetDescriptionId(preset)}
                                        onClick={() => onSelectPreset(preset)}
                                        onMouseEnter={() => setPreviewIntent(preset.intent)}
                                        onFocus={() => setPreviewIntent(preset.intent)}
                                        onBlur={() => setPreviewIntent(null)}
                                    >
                                        {preset.name}
                                    </button>
                                ))}
                            </div>
                            {/* Descriptions live outside the buttons so they never join the button's name. */}
                            <div className="visually-hidden">
                                {groupPresets.map((preset) => (
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
            ) : myMix?.preferences ? (
                <p className="aid-prompt-hint">
                    {myMixHasInputs
                        ? "My Mix will blend your selected listening lanes."
                        : "No lanes selected; the DJ will use your usual taste."}
                </p>
            ) : (
                <p className="aid-prompt-hint">Pick a quick start to see what it sounds like, or describe the session above.</p>
            )}

            <div className="aid-prompt-filters" aria-live="polite">
                {chips.length > 0 ? (
                    <ul className="aid-prompt-chips" aria-label="Session filters">
                        {chips.map((chip) => (
                            <li key={chip.key} className={`aid-prompt-chip aid-prompt-chip--${chip.kind}`}>
                                {chip.kind === "energy" && request?.energy ? (
                                    <>
                                        <label className="aid-prompt-chip-label" htmlFor={`${id}-energy`}>
                                            Energy
                                        </label>
                                        <select
                                            id={`${id}-energy`}
                                            className="aid-prompt-chip-select"
                                            value={request.energy}
                                            onChange={(event) => onEnergyChange(event.target.value as AgentSessionEnergy)}
                                        >
                                            {SESSION_ENERGY_BANDS.map((band) => (
                                                <option key={band} value={band}>
                                                    {band}
                                                </option>
                                            ))}
                                        </select>
                                    </>
                                ) : (
                                    <span>{chip.label}</span>
                                )}
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
                    <p className="aid-prompt-hint">
                        {isParsing ? "Reading what you wrote…" : "No filters yet: the DJ will choose from your saved vibes."}
                    </p>
                )}
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
                {notes.map((note) => (
                    <p key={note} className="aid-prompt-note aid-prompt-note--coverage">
                        {note}
                    </p>
                ))}
            </div>

            <div className="aid-prompt-actions">
                <button type="button" className="aid-prompt-submit" disabled={submitDisabled} onClick={onSubmit}>
                    {submitLabel}
                </button>
            </div>
        </section>
    );
}
