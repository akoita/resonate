"use client";

import type { AgentConfig } from "../../lib/api";

type Props = {
    config: AgentConfig;
    onToggle: () => Promise<void>;
};

export default function AgentStatusCard({ config, onToggle }: Props) {
    return (
        <div className="agent-card agent-status-card">
            <div className="agent-card-header">
                <div className="agent-avatar">
                    <span className="agent-avatar-emoji">🤖</span>
                    <div className={`agent-status-dot ${config.isActive ? "active" : ""}`} />
                </div>
                <div className="agent-card-info">
                    <h3 className="agent-card-name">{config.name}</h3>
                    <span className={`agent-status-label ${config.isActive ? "active" : ""}`}>
                        {config.isActive ? "Active" : "Inactive"}
                    </span>
                </div>
            </div>

            <div className="agent-card-body">
                <div className="agent-vibes-row">
                    {config.vibes.map((vibe) => (
                        <span key={vibe} className="vibe-chip selected small">{vibe}</span>
                    ))}
                </div>
            </div>

            <button
                className={`agent-toggle-btn ${config.isActive ? "stop" : "start"}`}
                onClick={onToggle}
            >
                {config.isActive ? (
                    <>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></svg>
                        Stop Session
                    </>
                ) : (
                    <>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3" /></svg>
                        Start Session
                    </>
                )}
            </button>
        </div>
    );
}
