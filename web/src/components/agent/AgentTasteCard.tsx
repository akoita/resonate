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
    onMintIdentity?: () => Promise<void>;
    onAttestReputation?: () => Promise<void>;
};

export default function AgentTasteCard({ config, onUpdateVibes, onUpdateStemTypes, onMintIdentity, onAttestReputation }: Props) {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState<string[]>(config.vibes);
    const [saving, setSaving] = useState(false);
    const [customInput, setCustomInput] = useState("");

    // Stem types state
    const [editingStems, setEditingStems] = useState(false);
    const [stemDraft, setStemDraft] = useState<string[]>(config.stemTypes ?? []);
    const [savingStems, setSavingStems] = useState(false);
    const [mintingIdentity, setMintingIdentity] = useState(false);
    const [attestingReputation, setAttestingReputation] = useState(false);

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
    const learnedTaste = config.learnedTasteProfile;
    const reputation = config.reputationSnapshot;
    const score = Math.max(0, Math.min(100, config.tasteScore ?? learnedTaste?.score ?? config.reputationScore ?? reputation?.score ?? 0));
    const tier = learnedTaste?.tier ?? reputation?.tier ?? "New";
    const exploredGenres = learnedTaste?.genresExplored?.length
        ? learnedTaste.genresExplored
        : (reputation?.genresExplored?.length ? reputation.genresExplored : config.vibes);
    const signalCount = learnedTaste?.signals ?? 0;
    const acceptanceRate = Math.round((learnedTaste?.acceptanceRate ?? reputation?.acceptanceRate ?? 0) * 100);
    const credentialAvailable = Boolean(config.identityCredential);

    const handleCredentialExport = async () => {
        if (!config.identityCredential) return;
        const blob = new Blob([JSON.stringify(config.identityCredential, null, 2)], {
            type: "application/json",
        });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `${config.id}-identity-credential.json`;
        link.click();
        URL.revokeObjectURL(url);
    };

    const handleMintIdentity = async () => {
        if (!onMintIdentity) return;
        setMintingIdentity(true);
        try {
            await onMintIdentity();
        } finally {
            setMintingIdentity(false);
        }
    };

    const handleAttestReputation = async () => {
        if (!onAttestReputation) return;
        setAttestingReputation(true);
        try {
            await onAttestReputation();
        } finally {
            setAttestingReputation(false);
        }
    };

    return (
        <div className="aid-card aid-card--taste">
            <div className="aid-card-header">
                <div className="aid-card-title-row">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
                    </svg>
                    <span className="aid-card-title">Taste Profile</span>
                </div>
            </div>

            <div className="aid-taste-grid" style={{ gridTemplateColumns: "1.3fr 1fr" }}>
                {/* ── Main column: Vibes + Stem Types ── */}
                <div className="aid-taste-col">
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        <div className="aid-taste-col-header">
                            <span className="aid-taste-lbl">Selected Vibes</span>
                            {onUpdateVibes && !editing && (
                                <button className="aid-ghost-btn" onClick={handleEdit}>
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
                                <div className="aid-vibes-grid">
                                    {PRESET_VIBES.map((vibe) => (
                                        <button
                                            key={vibe}
                                            className={`aid-vibe-chip ${draft.includes(vibe) ? "aid-vibe-chip--active" : ""}`}
                                            onClick={() => toggleVibe(vibe)}
                                        >
                                            {vibe}
                                        </button>
                                    ))}
                                    {/* Show custom vibes as removable chips */}
                                    {customVibes.map((vibe) => (
                                        <button
                                            key={vibe}
                                            className="aid-vibe-chip aid-vibe-chip--active aid-vibe-chip--custom"
                                            onClick={() => toggleVibe(vibe)}
                                            title="Click to remove"
                                        >
                                            {vibe} &times;
                                        </button>
                                    ))}
                                </div>
                                <div className="aid-custom-row">
                                    <input
                                        className="aid-custom-input"
                                        type="text"
                                        placeholder="Add custom genre..."
                                        value={customInput}
                                        onChange={(e) => setCustomInput(e.target.value)}
                                        onKeyDown={handleKeyDown}
                                    />
                                    <button
                                        className="aid-ghost-btn"
                                        onClick={addCustomGenre}
                                        disabled={!customInput.trim()}
                                    >
                                        + Add
                                    </button>
                                </div>
                                <div className="aid-edit-actions">
                                    <button className="aid-ghost-btn" onClick={handleCancel}>
                                        Cancel
                                    </button>
                                    <button
                                        className="aid-primary-btn"
                                        onClick={handleSave}
                                        disabled={saving || draft.length === 0}
                                    >
                                        {saving ? "Saving..." : "Save Vibes"}
                                    </button>
                                </div>
                            </>
                        ) : (
                            <div className="aid-vibes-row">
                                {config.vibes.map((vibe) => (
                                    <span key={vibe} className="aid-vibe-chip aid-vibe-chip--active">{vibe}</span>
                                ))}
                            </div>
                        )}
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        <div className="aid-taste-col-header">
                            <span className="aid-taste-lbl">Stem Types to Buy</span>
                            {onUpdateStemTypes && !editingStems && (
                                <button className="aid-ghost-btn" onClick={handleEditStems}>
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
                                <div className="aid-vibes-grid">
                                    {STEM_TYPES.map((type) => (
                                        <button
                                            key={type}
                                            className={`aid-vibe-chip ${stemDraft.includes(type) ? "aid-vibe-chip--active" : ""}`}
                                            onClick={() => toggleStemType(type)}
                                        >
                                            {type}
                                        </button>
                                    ))}
                                </div>
                                <p className="aid-taste-hint" style={{ marginTop: 6 }}>
                                    {stemDraft.length === 0
                                        ? "No filter \u2014 agent will buy all available stems."
                                        : `Agent will only buy: ${stemDraft.join(", ")}`}
                                </p>
                                <div className="aid-edit-actions">
                                    <button className="aid-ghost-btn" onClick={() => setEditingStems(false)}>
                                        Cancel
                                    </button>
                                    <button
                                        className="aid-primary-btn"
                                        onClick={handleSaveStems}
                                        disabled={savingStems}
                                    >
                                        {savingStems ? "Saving..." : "Save"}
                                    </button>
                                </div>
                            </>
                        ) : (
                            <>
                                <div className="aid-vibes-row">
                                    {activeStemTypes.length === 0 ? (
                                        <span className="aid-vibe-chip aid-vibe-chip--active">All stems</span>
                                    ) : (
                                        activeStemTypes.map((type) => (
                                            <span key={type} className="aid-vibe-chip aid-vibe-chip--active">{type}</span>
                                        ))
                                    )}
                                </div>
                                <p className="aid-taste-hint">
                                    {activeStemTypes.length === 0
                                        ? "Your DJ buys every listed stem for a track."
                                        : `Your DJ only buys ${activeStemTypes.join(", ")} stems.`}
                                </p>
                            </>
                        )}
                    </div>
                </div>

                {/* ── Side column: Score + Genres + Identity ── */}
                <div className="aid-taste-col">
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        <span className="aid-taste-lbl">Taste Score</span>
                        <div className="aid-score-bar-wrap">
                            <div className="aid-score-bar-track">
                                <div className="aid-score-bar-fill" style={{ width: `${score}%` }} />
                            </div>
                            <span className="aid-score-val">{score}</span>
                        </div>
                        <div className="aid-score-pills">
                            <span className="aid-tier-pill">{tier}</span>
                            <span className="aid-tier-pill">{config.identityStatus}</span>
                        </div>
                        <p className="aid-taste-hint">
                            {learnedTaste
                                ? `${signalCount} signals learned, ${acceptanceRate}% positive.`
                                : reputation
                                    ? `${reputation.tracksCurated} tracks curated across ${reputation.sessions} sessions.`
                                    : "Start a session to build your score."}
                        </p>
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        <span className="aid-taste-lbl">Genres Explored</span>
                        <div className="aid-genre-tags">
                            {exploredGenres.map((genre) => (
                                <span key={genre} className="aid-genre-tag">{genre}</span>
                            ))}
                        </div>
                        {learnedTaste?.favoredGenres?.length ? (
                            <p className="aid-taste-hint">
                                Favors {learnedTaste.favoredGenres.slice(0, 3).join(", ")}.
                            </p>
                        ) : null}
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        <div className="aid-taste-col-header">
                            <span className="aid-taste-lbl">Portable Identity</span>
                            <button
                                className="aid-ghost-btn"
                                onClick={handleCredentialExport}
                                disabled={!credentialAvailable}
                            >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                    <polyline points="7 10 12 15 17 10" />
                                    <line x1="12" x2="12" y1="15" y2="3" />
                                </svg>
                                VC
                            </button>
                        </div>
                        <p className="aid-taste-hint">
                            {config.identityTokenId
                                ? `ERC-8004 token ${config.identityTokenId}`
                                : "Local identity ready for ERC-8004 minting."}
                        </p>
                        <div className="aid-identity-actions">
                            <button
                                className="aid-ghost-btn"
                                onClick={handleMintIdentity}
                                disabled={!onMintIdentity || mintingIdentity || config.identityStatus === "minted" || config.identityStatus === "attested"}
                            >
                                {mintingIdentity ? "Minting..." : "Mint"}
                            </button>
                            <button
                                className="aid-ghost-btn"
                                onClick={handleAttestReputation}
                                disabled={!onAttestReputation || attestingReputation || !config.identityTokenId}
                            >
                                {attestingReputation ? "Attesting..." : "Attest"}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
