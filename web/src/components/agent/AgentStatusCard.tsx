"use client";

import type { AgentConfig } from "../../lib/api";

type Props = {
    config: AgentConfig;
    onToggle: () => Promise<void>;
    onModeChange: (mode: "curate" | "buy") => void;
    sessionCount: number;
    trackCount: number;
    totalSpend: number;
};

export default function AgentStatusCard({ config, onToggle, onModeChange, sessionCount, trackCount, totalSpend }: Props) {
    return (
        <div className="agent-card agent-status-card">
            <div className="agent-card-header">
                <div className="agent-avatar">
                    <span className="agent-avatar-emoji">🤖</span>
                    <div className={`agent-status-dot ${config.isActive ? "active" : ""}`} />
                </div>
                <div className="agent-card-info">
                    <h3 className="agent-card-name">{config.name}</h3>
                    <div className="agent-status-row">
                        <span className={`agent-status-label ${config.isActive ? "active" : ""}`}>
                            {config.isActive ? "Active" : "Inactive"}
                        </span>
                        <span className={`agent-mode-badge ${config.sessionMode}`}>
                            {config.sessionMode === "buy" ? "💰 Buy" : "🔍 Curate"}
                        </span>
                    </div>
                </div>
            </div>

            <div className="agent-card-body">
                <div className="agent-vibes-row">
                    {config.vibes.map((vibe) => (
                        <span key={vibe} className="vibe-chip selected small">{vibe}</span>
                    ))}
                </div>
            </div>

            {/* Session Mode Toggle */}
            <div className="agent-mode-toggle">
                <span className="agent-mode-label">Session Mode</span>
                <div className="agent-mode-options">
                    <button
                        className={`agent-mode-chip ${config.sessionMode === "curate" ? "active" : ""}`}
                        onClick={() => onModeChange("curate")}
                    >
                        🔍 Curate Only
                    </button>
                    <button
                        className={`agent-mode-chip ${config.sessionMode === "buy" ? "active" : ""}`}
                        onClick={() => onModeChange("buy")}
                    >
                        💰 Buy Stems
                    </button>
                </div>
                <span className="agent-mode-hint">
                    {config.sessionMode === "curate"
                        ? "Discover tracks without purchasing"
                        : "Discover and purchase stems on-chain"}
                </span>
            </div>

            {/* Summary stats */}
            <div className="agent-stats-row">
                <div className="agent-stat">
                    <span className="agent-stat-value">{sessionCount}</span>
                    <span className="agent-stat-label">Sessions</span>
                </div>
                <div className="agent-stat-divider" />
                <div className="agent-stat">
                    <span className="agent-stat-value">{trackCount}</span>
                    <span className="agent-stat-label">Tracks</span>
                </div>
                <div className="agent-stat-divider" />
                <div className="agent-stat">
                    <span className="agent-stat-value">${totalSpend.toFixed(2)}</span>
                    <span className="agent-stat-label">Spent</span>
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

