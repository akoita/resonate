"use client";

import { useState, type KeyboardEvent } from "react";

const PRESET_VIBES = [
    "Deep House", "Lo-fi", "Focus", "Ambient", "Jazz", "Electronic",
    "Hip Hop", "Classical", "R&B", "Soul", "Trap", "Drill",
    "Afrobeats", "Reggaeton", "Techno", "Indie", "Pop", "Rock",
];

type WizardProps = {
    onComplete: (data: { name: string; vibes: string[]; monthlyCapUsd: number; enableWallet: boolean }) => Promise<void>;
    onClose: () => void;
};

export default function AgentSetupWizard({ onComplete, onClose }: WizardProps) {
    const [step, setStep] = useState(0);
    const [name, setName] = useState("");
    const [selectedVibes, setSelectedVibes] = useState<string[]>(["Focus"]);
    const [budget, setBudget] = useState(10);
    const [submitting, setSubmitting] = useState(false);
    const [customInput, setCustomInput] = useState("");
    const [enableWallet, setEnableWallet] = useState(true);

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
                enableWallet,
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
                    {[0, 1, 2, 3].map((i) => (
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

                {step === 3 && (
                    <div className="agent-wizard-step fade-in-up">
                        <div className="agent-wizard-emoji">🔐</div>
                        <h2 className="agent-wizard-title">Smart Wallet</h2>
                        <p className="agent-wizard-desc">
                            Let your DJ autonomously purchase stems on-chain, within your budget. Uses account abstraction — no manual approvals needed.
                        </p>
                        <div className="agent-wallet-opt-in">
                            <button
                                className={`agent-wallet-opt-btn ${enableWallet ? "selected" : ""}`}
                                onClick={() => setEnableWallet(true)}
                            >
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                                </svg>
                                <span className="agent-wallet-opt-label">Enable</span>
                                <span className="agent-wallet-opt-desc">Auto-buy stems within budget</span>
                            </button>
                            <button
                                className={`agent-wallet-opt-btn ${!enableWallet ? "selected" : ""}`}
                                onClick={() => setEnableWallet(false)}
                            >
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                    <circle cx="12" cy="12" r="10" />
                                    <line x1="15" y1="9" x2="9" y2="15" />
                                    <line x1="9" y1="9" x2="15" y2="15" />
                                </svg>
                                <span className="agent-wallet-opt-label">Skip</span>
                                <span className="agent-wallet-opt-desc">Enable later from dashboard</span>
                            </button>
                        </div>
                    </div>
                )}

                <div className="agent-wizard-actions">
                    {step > 0 && (
                        <button className="ui-btn ui-btn-ghost" onClick={() => setStep(step - 1)}>
                            Back
                        </button>
                    )}
                    {step < 3 ? (
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
