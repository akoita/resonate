"use client";

import type { AgentConfig } from "../../lib/api";

type Props = {
    config: AgentConfig;
    onToggle: () => Promise<void>;
    sessionCount: number;
    trackCount: number;
    totalSpend: number;
};

/**
 * AgentStatusCard — stripped-down card version for contexts that render it
 * standalone (e.g. outside AgentDashboard). When used inside AgentDashboard,
 * the Command Center strip replaces the top-level toggle/mode controls.
 */
export default function AgentStatusCard({ config, onToggle, sessionCount, trackCount, totalSpend }: Props) {
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
                {/* Past spend stays visible; curate-only DJs never spend (ADR-TE-1.4). */}
                {totalSpend > 0 && (
                    <>
                        <div className="aid-sc-stat-divider" />
                        <div className="aid-sc-stat">
                            <span className="aid-sc-stat-val">${totalSpend.toFixed(2)}</span>
                            <span className="aid-sc-stat-lbl">Spent</span>
                        </div>
                    </>
                )}
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
