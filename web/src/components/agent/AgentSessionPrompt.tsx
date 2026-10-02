"use client";

import { useId } from "react";
import type {
    AgentRequestCoverage,
    AgentSessionEnergy,
    AgentSessionRequest,
    AgentSessionRequestIgnoredKey,
} from "../../lib/api";
import {
    SESSION_ENERGY_BANDS,
    SESSION_REQUEST_MAX_TEXT_LENGTH,
    chipsFromRequest,
    coverageNotes,
    ignoredKeyLabels,
} from "../../lib/agentSessionRequest";
import { SESSION_PRESETS, type SessionPreset } from "./AgentSessionPresets";

export const SESSION_PROMPT_PLACEHOLDER = "Warm deep house around 122 BPM for cooking";

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
    onSubmit,
}: Props) {
    const id = useId();
    const textId = `${id}-text`;
    const chips = chipsFromRequest(request);
    const ignoredLabels = ignoredKeyLabels(ignored);
    const notes = coverageNotes(coverage, request);
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

            <div className="aid-prompt-presets" role="group" aria-label="Quick starts">
                {presets.map((preset) => (
                    <button
                        key={preset.name}
                        type="button"
                        className={`aid-prompt-preset ${activePresetIntent === preset.intent ? "active" : ""}`}
                        aria-pressed={activePresetIntent === preset.intent}
                        title={preset.description}
                        onClick={() => onSelectPreset(preset)}
                    >
                        {preset.name}
                    </button>
                ))}
            </div>

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
                ) : (
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
