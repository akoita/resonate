"use client";

import { useState } from "react";

const VIBES = ["Deep House", "Lo-fi", "Focus", "Ambient", "Jazz", "Electronic", "Hip Hop", "Classical"];

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

    const toggleVibe = (vibe: string) => {
        setSelectedVibes((prev) =>
            prev.includes(vibe) ? prev.filter((v) => v !== vibe) : [...prev, vibe]
        );
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
                            Tell your DJ what kind of music to look for. Pick one or more.
                        </p>
                        <div className="agent-wizard-vibes">
                            {VIBES.map((vibe) => (
                                <button
                                    key={vibe}
                                    className={`vibe-chip ${selectedVibes.includes(vibe) ? "selected" : ""}`}
                                    onClick={() => toggleVibe(vibe)}
                                >
                                    {vibe}
                                </button>
                            ))}
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
