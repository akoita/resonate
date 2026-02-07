"use client";

import type { AgentConfig } from "../../lib/api";

type Props = {
    config: AgentConfig;
};

export default function AgentTasteCard({ config }: Props) {
    return (
        <div className="agent-card agent-taste-card">
            <h3 className="agent-card-title">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
                </svg>
                Taste Profile
            </h3>

            <div className="agent-taste-section">
                <span className="agent-taste-label">Selected Vibes</span>
                <div className="agent-vibes-row">
                    {config.vibes.map((vibe) => (
                        <span key={vibe} className="vibe-chip selected small">{vibe}</span>
                    ))}
                </div>
            </div>

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
    );
}
