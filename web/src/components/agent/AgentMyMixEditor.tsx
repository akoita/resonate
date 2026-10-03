"use client";

import { useState } from "react";
import type {
    AgentMixCoverage,
    AgentMixVocabulary,
    AgentMyMixAddition,
    AgentMyMixPreferences,
    ListeningLane,
} from "../../lib/api";
import {
    MAX_MY_MIX_ADDITIONS,
    addMyMixAddition,
    myMixAdditionOptions,
    myMixContextLabel,
    myMixCoverageNotes,
    removeMyMixAddition,
    selectedMyMixLanes,
    setMyMixLaneBoost,
    setMyMixLaneIncluded,
} from "../../lib/agentMyMix";

type Props = {
    lanes: readonly ListeningLane[];
    vocabulary: AgentMixVocabulary;
    preferences: AgentMyMixPreferences;
    coverage?: AgentMixCoverage | null;
    isSaving?: boolean;
    saveMessage?: string | null;
    canSave?: boolean;
    onChange: (next: AgentMyMixPreferences) => void;
    onSave: () => void;
};

function additionLabel(addition: AgentMyMixAddition): string {
    return addition.genre ? `Genre · ${addition.genre}` : `Mood · ${addition.mood}`;
}

export default function AgentMyMixEditor({
    lanes,
    vocabulary,
    preferences,
    coverage,
    isSaving = false,
    saveMessage,
    canSave = false,
    onChange,
    onSave,
}: Props) {
    const [additionSelection, setAdditionSelection] = useState("");
    const visibleLanes = lanes.filter((lane) => !lane.hidden);
    const selected = selectedMyMixLanes(preferences, visibleLanes);
    const selectedIds = new Set(selected.map((lane) => lane.id));
    const boostedIds = new Set(selected.filter((lane) => lane.boost).map((lane) => lane.id));
    const options = myMixAdditionOptions(vocabulary);
    const notes = myMixCoverageNotes(coverage);
    const contextLabel = myMixContextLabel(preferences.context);

    const addSelectedFilter = () => {
        const separator = additionSelection.indexOf(":");
        if (separator < 0) return;
        const kind = additionSelection.slice(0, separator);
        const value = additionSelection.slice(separator + 1);
        const addition = kind === "genre" ? { genre: value } : { mood: value };
        const next = addMyMixAddition(preferences, vocabulary, addition);
        if (next !== preferences) {
            onChange(next);
            setAdditionSelection("");
        }
    };

    return (
        <section className="aid-my-mix" aria-label="My Mix session controls">
            <div className="aid-my-mix-intro">
                <p>Shape this session with your listening lanes. Changes stay here unless you save them.</p>
                {contextLabel ? <p className="aid-my-mix-context">Tuned for {contextLabel}</p> : null}
            </div>

            <ul className="aid-my-mix-lanes" aria-label="Listening lanes">
                {visibleLanes.map((lane) => {
                    const included = selectedIds.has(lane.id);
                    const boosted = boostedIds.has(lane.id);
                    return (
                        <li className="aid-my-mix-lane" key={lane.id}>
                            <label className="aid-my-mix-lane-name">
                                <input
                                    type="checkbox"
                                    checked={included}
                                    aria-label={`Include lane ${lane.label}`}
                                    onChange={(event) =>
                                        onChange(setMyMixLaneIncluded(preferences, visibleLanes, lane.id, event.target.checked))
                                    }
                                />
                                <span>{lane.label}</span>
                            </label>
                            <button
                                className={`aid-my-mix-boost ${boosted ? "active" : ""}`}
                                type="button"
                                aria-pressed={boosted}
                                aria-label={`${boosted ? "Unboost" : "Boost"} lane ${lane.label}`}
                                disabled={!included}
                                onClick={() => onChange(setMyMixLaneBoost(preferences, visibleLanes, lane.id, !boosted))}
                            >
                                {boosted ? "Boosted" : "Boost"}
                            </button>
                        </li>
                    );
                })}
            </ul>

            <div className="aid-my-mix-additions">
                <label htmlFor="aid-my-mix-addition">Add a catalog genre or mood</label>
                <div className="aid-my-mix-add-row">
                    <select
                        id="aid-my-mix-addition"
                        aria-label="Add a genre or mood"
                        value={additionSelection}
                        onChange={(event) => setAdditionSelection(event.target.value)}
                    >
                        <option value="">Choose a genre or mood</option>
                        {options.genres.map((genre) => (
                            <option key={`genre:${genre}`} value={`genre:${genre}`}>Genre · {genre}</option>
                        ))}
                        {options.moods.map((mood) => (
                            <option key={`mood:${mood}`} value={`mood:${mood}`}>Mood · {mood}</option>
                        ))}
                    </select>
                    <button
                        type="button"
                        className="aid-my-mix-add-button"
                        disabled={!additionSelection || (preferences.additions?.length ?? 0) >= MAX_MY_MIX_ADDITIONS}
                        onClick={addSelectedFilter}
                    >
                        Add filter
                    </button>
                </div>
                <p className="aid-my-mix-hint">Up to {MAX_MY_MIX_ADDITIONS} extra filters for this session.</p>
                {(preferences.additions?.length ?? 0) > 0 ? (
                    <ul className="aid-my-mix-added" aria-label="Added session filters">
                        {preferences.additions?.map((addition) => (
                            <li key={addition.genre ? `genre:${addition.genre}` : `mood:${addition.mood}`}>
                                <span>{additionLabel(addition)}</span>
                                <button
                                    type="button"
                                    aria-label={`Remove added filter ${additionLabel(addition)}`}
                                    onClick={() => onChange(removeMyMixAddition(preferences, addition))}
                                >
                                    Remove
                                </button>
                            </li>
                        ))}
                    </ul>
                ) : null}
            </div>

            {notes.length > 0 ? (
                <div className="aid-my-mix-coverage" role="status" aria-label="My Mix availability">
                    {notes.map((note) => <p key={note}>{note}</p>)}
                </div>
            ) : null}

            <div className="aid-my-mix-save">
                <p>Save boosted and added preferences for future recommendations.</p>
                <button type="button" disabled={!canSave || isSaving} onClick={onSave}>
                    {isSaving ? "Saving…" : "Save to Taste Memory"}
                </button>
                {saveMessage ? <p role="status">{saveMessage}</p> : null}
            </div>
        </section>
    );
}
