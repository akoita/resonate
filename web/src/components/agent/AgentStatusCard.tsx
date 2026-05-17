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

/**
 * AgentStatusCard — stripped-down card version for contexts that render it
 * standalone (e.g. outside AgentDashboard). When used inside AgentDashboard,
 * the Command Center strip replaces the top-level toggle/mode controls.
 */
export default function AgentStatusCard({ config, onToggle, onModeChange, sessionCount, trackCount, totalSpend }: Props) {
    return (
        <div className="aid-card aid-card--status">
            {/* Avatar orb */}
            <div className="aid-sc-header">
                <div className="aid-orb-wrap aid-orb-wrap--sm">
                    <div className="aid-orb" />
                    <span className={`aid-orb-badge ${config.isActive ? "active" : ""}`}>
                        {config.isActive ? "LIVE" : "IDLE"}
                    </span>
                </div>
                <div>
                    <p className="aid-sc-name">{config.name}</p>
                    <span className={`aid-status-pill ${config.isActive ? "active" : ""}`}>
                        {config.isActive ? "● Active" : "○ Inactive"}
                    </span>
                </div>
            </div>

            {/* Vibes */}
            <div className="aid-sc-vibes">
                {config.vibes.slice(0, 6).map((v) => (
                    <span key={v} className="aid-vibe-chip aid-vibe-chip--active">{v}</span>
                ))}
            </div>

            {/* Session mode toggle */}
            <div className="aid-sc-mode">
                <span className="aid-mode-label">Mode</span>
                <div className="aid-mode-seg">
                    <button
                        className={`aid-mode-btn ${config.sessionMode === "curate" ? "active" : ""}`}
                        onClick={() => onModeChange("curate")}
                    >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
                        Curate Only
                    </button>
                    <button
                        className={`aid-mode-btn ${config.sessionMode === "buy" ? "active" : ""}`}
                        onClick={() => onModeChange("buy")}
                    >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>
                        Buy Stems
                    </button>
                </div>
            </div>

            {/* Stats */}
            <div className="aid-sc-stats">
                <div className="aid-sc-stat">
                    <span className="aid-sc-stat-val">{sessionCount}</span>
                    <span className="aid-sc-stat-lbl">Sessions</span>
                </div>
                <div className="aid-sc-stat-divider" />
                <div className="aid-sc-stat">
                    <span className="aid-sc-stat-val">{trackCount}</span>
                    <span className="aid-sc-stat-lbl">Tracks</span>
                </div>
                <div className="aid-sc-stat-divider" />
                <div className="aid-sc-stat">
                    <span className="aid-sc-stat-val">${totalSpend.toFixed(2)}</span>
                    <span className="aid-sc-stat-lbl">Spent</span>
                </div>
            </div>

            {/* Toggle CTA */}
            <button
                className={`aid-toggle-btn ${config.isActive ? "stop" : "start"}`}
                onClick={onToggle}
            >
                {config.isActive ? (
                    <>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></svg>
                        Stop Session
                    </>
                ) : (
                    <>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3" /></svg>
                        Start Session
                    </>
                )}
            </button>
        </div>
    );
}
