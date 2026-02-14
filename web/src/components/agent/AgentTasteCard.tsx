"use client";

import { useState, type KeyboardEvent } from "react";
import type { AgentConfig } from "../../lib/api";

const PRESET_VIBES = [
    "Deep House", "Lo-fi", "Focus", "Ambient", "Jazz", "Electronic",
    "Hip Hop", "Classical", "R&B", "Soul", "Trap", "Drill",
    "Afrobeats", "Reggaeton", "Techno", "Indie", "Pop", "Rock",
];

const STEM_TYPES = ["vocals", "drums", "bass", "piano", "guitar", "other"];

type Props = {
    config: AgentConfig;
    onUpdateVibes?: (vibes: string[]) => Promise<void>;
    onUpdateStemTypes?: (stemTypes: string[]) => Promise<void>;
};

export default function AgentTasteCard({ config, onUpdateVibes, onUpdateStemTypes }: Props) {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState<string[]>(config.vibes);
    const [saving, setSaving] = useState(false);
    const [customInput, setCustomInput] = useState("");

    // Stem types state
    const [editingStems, setEditingStems] = useState(false);
    const [stemDraft, setStemDraft] = useState<string[]>(config.stemTypes ?? []);
    const [savingStems, setSavingStems] = useState(false);

    const toggleVibe = (vibe: string) => {
        setDraft((prev) =>
            prev.includes(vibe) ? prev.filter((v) => v !== vibe) : [...prev, vibe]
        );
    };

    const toggleStemType = (type: string) => {
        setStemDraft((prev) =>
            prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
        );
    };

    const addCustomGenre = () => {
        const genre = customInput.trim();
        if (genre && !draft.includes(genre)) {
            setDraft((prev) => [...prev, genre]);
        }
        setCustomInput("");
    };

    const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter") {
            e.preventDefault();
            addCustomGenre();
        }
    };

    const handleEdit = () => {
        setDraft([...config.vibes]);
        setCustomInput("");
        setEditing(true);
    };

    const handleCancel = () => {
        setEditing(false);
    };

    const handleSave = async () => {
        if (draft.length === 0 || !onUpdateVibes) return;
        setSaving(true);
        try {
            await onUpdateVibes(draft);
            setEditing(false);
        } finally {
            setSaving(false);
        }
    };

    const handleEditStems = () => {
        setStemDraft([...(config.stemTypes ?? [])]);
        setEditingStems(true);
    };

    const handleSaveStems = async () => {
        if (!onUpdateStemTypes) return;
        setSavingStems(true);
        try {
            await onUpdateStemTypes(stemDraft);
            setEditingStems(false);
        } finally {
            setSavingStems(false);
        }
    };

    // Custom vibes that aren't in the preset list
    const customVibes = draft.filter((v) => !PRESET_VIBES.includes(v));
    const activeStemTypes = config.stemTypes ?? [];

    return (
        <div className="agent-card agent-taste-card">
            <h3 className="agent-card-title">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
                </svg>
                Taste Profile
            </h3>

            <div className="agent-taste-content">
                <div className="agent-taste-col-main">
                    <div className="agent-taste-section">
                        <div className="agent-taste-section-header">
                            <span className="agent-taste-label">Selected Vibes</span>
                            {onUpdateVibes && !editing && (
                                <button className="agent-taste-edit-btn" onClick={handleEdit}>
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                                        <path d="m15 5 4 4" />
                                    </svg>
                                    Edit
                                </button>
                            )}
                        </div>

                        {editing ? (
                            <>
                                <div className="agent-vibes-grid">
                                    {PRESET_VIBES.map((vibe) => (
                                        <button
                                            key={vibe}
                                            className={`vibe-chip ${draft.includes(vibe) ? "selected" : ""}`}
                                            onClick={() => toggleVibe(vibe)}
                                        >
                                            {vibe}
                                        </button>
                                    ))}
                                    {/* Show custom vibes as removable chips */}
                                    {customVibes.map((vibe) => (
                                        <button
                                            key={vibe}
                                            className="vibe-chip selected custom"
                                            onClick={() => toggleVibe(vibe)}
                                            title="Click to remove"
                                        >
                                            {vibe} ×
                                        </button>
                                    ))}
                                </div>
                                <div className="agent-custom-genre-row">
                                    <input
                                        className="agent-custom-genre-input"
                                        type="text"
                                        placeholder="Add custom genre..."
                                        value={customInput}
                                        onChange={(e) => setCustomInput(e.target.value)}
                                        onKeyDown={handleKeyDown}
                                    />
                                    <button
                                        className="ui-btn ui-btn-ghost ui-btn-sm"
                                        onClick={addCustomGenre}
                                        disabled={!customInput.trim()}
                                    >
                                        + Add
                                    </button>
                                </div>
                                <div className="agent-taste-edit-actions">
                                    <button className="ui-btn ui-btn-ghost ui-btn-sm" onClick={handleCancel}>
                                        Cancel
                                    </button>
                                    <button
                                        className="ui-btn ui-btn-primary ui-btn-sm"
                                        onClick={handleSave}
                                        disabled={saving || draft.length === 0}
                                    >
                                        {saving ? "Saving..." : "Save Vibes"}
                                    </button>
                                </div>
                            </>
                        ) : (
                            <div className="agent-vibes-row">
                                {config.vibes.map((vibe) => (
                                    <span key={vibe} className="vibe-chip selected small">{vibe}</span>
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="agent-taste-section">
                        <div className="agent-taste-section-header">
                            <span className="agent-taste-label">Stem Types to Buy</span>
                            {onUpdateStemTypes && !editingStems && (
                                <button className="agent-taste-edit-btn" onClick={handleEditStems}>
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                                        <path d="m15 5 4 4" />
                                    </svg>
                                    Edit
                                </button>
                            )}
                        </div>

                        {editingStems ? (
                            <>
                                <div className="agent-vibes-grid">
                                    {STEM_TYPES.map((type) => (
                                        <button
                                            key={type}
                                            className={`vibe-chip ${stemDraft.includes(type) ? "selected" : ""}`}
                                            onClick={() => toggleStemType(type)}
                                        >
                                            {type}
                                        </button>
                                    ))}
                                </div>
                                <p className="agent-taste-hint" style={{ marginTop: 6 }}>
                                    {stemDraft.length === 0
                                        ? "No filter — agent will buy all available stems."
                                        : `Agent will only buy: ${stemDraft.join(", ")}`}
                                </p>
                                <div className="agent-taste-edit-actions">
                                    <button className="ui-btn ui-btn-ghost ui-btn-sm" onClick={() => setEditingStems(false)}>
                                        Cancel
                                    </button>
                                    <button
                                        className="ui-btn ui-btn-primary ui-btn-sm"
                                        onClick={handleSaveStems}
                                        disabled={savingStems}
                                    >
                                        {savingStems ? "Saving..." : "Save"}
                                    </button>
                                </div>
                            </>
                        ) : (
                            <>
                                <div className="agent-vibes-row">
                                    {activeStemTypes.length === 0 ? (
                                        <span className="vibe-chip selected small">All stems</span>
                                    ) : (
                                        activeStemTypes.map((type) => (
                                            <span key={type} className="vibe-chip selected small">{type}</span>
                                        ))
                                    )}
                                </div>
                                <p className="agent-taste-hint">
                                    {activeStemTypes.length === 0
                                        ? "Your DJ buys every listed stem for a track."
                                        : `Your DJ only buys ${activeStemTypes.join(", ")} stems.`}
                                </p>
                            </>
                        )}
                    </div>
                </div>

                <div className="agent-taste-col-side">
                    <div className="agent-taste-section">
                        <span className="agent-taste-label">Taste Score</span>
                        <div className="agent-taste-score">
                            <div className="agent-taste-score-bar">
                                <div className="agent-taste-score-fill" style={{ width: "15%" }} />
                            </div>
                            <span className="agent-taste-score-value">Emerging</span>
                        </div>
                        <p className="agent-taste-hint">
                            Your taste score grows as your DJ explores more tracks. Prep for ERC-8004 identity.
                        </p>
                    </div>

                    <div className="agent-taste-section">
                        <span className="agent-taste-label">Genres Explored</span>
                        <div className="agent-taste-genres">
                            <span className="agent-genre-tag">—</span>
                        </div>
                        <p className="agent-taste-hint">Start a session to explore genres.</p>
                    </div>
                </div>
            </div>
        </div>
    );
}
