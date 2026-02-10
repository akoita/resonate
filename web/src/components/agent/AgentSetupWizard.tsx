"use client";

import { useState, type KeyboardEvent } from "react";

const PRESET_VIBES = [
    "Deep House", "Lo-fi", "Focus", "Ambient", "Jazz", "Electronic",
    "Hip Hop", "Classical", "R&B", "Soul", "Trap", "Drill",
    "Afrobeats", "Reggaeton", "Techno", "Indie", "Pop", "Rock",
];

type WizardProps = {
    onComplete: (data: { name: string; vibes: string[]; monthlyCapUsd: number }) => Promise<void>;
    onClose: () => void;
};

export default function AgentSetupWizard({ onComplete, onClose }: WizardProps) {
    const [step, setStep] = useState(0);
    const [name, setName] = useState("");
    const [selectedVibes, setSelectedVibes] = useState<string[]>(["Focus"]);
    const [budget, setBudget] = useState(10);
    const [submitting, setSubmitting] = useState(false);
    const [customInput, setCustomInput] = useState("");

    const toggleVibe = (vibe: string) => {
        setSelectedVibes((prev) =>
            prev.includes(vibe) ? prev.filter((v) => v !== vibe) : [...prev, vibe]
        );
    };

    const addCustomGenre = () => {
        const genre = customInput.trim();
        if (genre && !selectedVibes.includes(genre)) {
            setSelectedVibes((prev) => [...prev, genre]);
        }
        setCustomInput("");
    };

    const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter") {
            e.preventDefault();
            addCustomGenre();
        }
    };

    const handleFinish = async () => {
        setSubmitting(true);
        try {
            await onComplete({
                name: name || "My DJ",
                vibes: selectedVibes.length > 0 ? selectedVibes : ["Focus"],
                monthlyCapUsd: budget,
            });
        } finally {
            setSubmitting(false);
        }
    };

    const canAdvance = step === 0 ? true : step === 1 ? selectedVibes.length > 0 : true;
    const customVibes = selectedVibes.filter((v) => !PRESET_VIBES.includes(v));

    return (
        <div className="agent-wizard-overlay" onClick={onClose}>
            <div className="agent-wizard" onClick={(e) => e.stopPropagation()}>
                {/* Progress dots */}
                <div className="agent-wizard-dots">
                    {[0, 1, 2].map((i) => (
                        <div key={i} className={`agent-wizard-dot ${i === step ? "active" : ""} ${i < step ? "done" : ""}`} />
                    ))}
                </div>

                {step === 0 && (
                    <div className="agent-wizard-step fade-in-up">
                        <div className="agent-wizard-emoji">🤖</div>
                        <h2 className="agent-wizard-title">Name Your DJ</h2>
                        <p className="agent-wizard-desc">
                            Your AI DJ agent will curate, negotiate, and remix tracks for you in real-time.
                        </p>
                        <input
                            className="agent-wizard-input"
                            type="text"
                            placeholder="My DJ"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            autoFocus
                        />
                    </div>
                )}

                {step === 1 && (
                    <div className="agent-wizard-step fade-in-up">
                        <div className="agent-wizard-emoji">🎵</div>
                        <h2 className="agent-wizard-title">Choose Your Vibe</h2>
                        <p className="agent-wizard-desc">
                            Tell your DJ what kind of music to look for. Pick one or more, or add your own.
                        </p>
                        <div className="agent-wizard-vibes">
                            {PRESET_VIBES.map((vibe) => (
                                <button
                                    key={vibe}
                                    className={`vibe-chip ${selectedVibes.includes(vibe) ? "selected" : ""}`}
                                    onClick={() => toggleVibe(vibe)}
                                >
                                    {vibe}
                                </button>
                            ))}
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
                        <div className="agent-custom-genre-row" style={{ marginTop: "12px", maxWidth: "360px", width: "100%" }}>
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
                    </div>
                )}

                {step === 2 && (
                    <div className="agent-wizard-step fade-in-up">
                        <div className="agent-wizard-emoji">💰</div>
                        <h2 className="agent-wizard-title">Set Monthly Budget</h2>
                        <p className="agent-wizard-desc">
                            How much should your DJ spend per month on licensing tracks?
                        </p>
                        <div className="agent-wizard-budget">
                            <input
                                type="range"
                                min={1}
                                max={50}
                                value={budget}
                                onChange={(e) => setBudget(Number(e.target.value))}
                                className="agent-budget-slider"
                            />
                            <div className="agent-budget-value">${budget}/mo</div>
                        </div>
                    </div>
                )}

                <div className="agent-wizard-actions">
                    {step > 0 && (
                        <button className="ui-btn ui-btn-ghost" onClick={() => setStep(step - 1)}>
                            Back
                        </button>
                    )}
                    {step < 2 ? (
                        <button
                            className="ui-btn ui-btn-primary"
                            onClick={() => setStep(step + 1)}
                            disabled={!canAdvance}
                        >
                            Next
                        </button>
                    ) : (
                        <button
                            className="ui-btn ui-btn-primary"
                            onClick={handleFinish}
                            disabled={submitting}
                        >
                            {submitting ? "Creating..." : "Activate DJ"}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
