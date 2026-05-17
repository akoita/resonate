"use client";

import type { ReactNode } from "react";
import type { AgentConfig, AgentSession } from "../../lib/api";

type Props = {
    config: AgentConfig;
    sessions: AgentSession[];
    onToggle: () => Promise<void>;
    onModeChange: (mode: "curate" | "buy") => Promise<void>;
    /** Slot: 3-col middle row — ActivityFeed, NextPick, Finance */
    middleRow: ReactNode;
    /** Slot: full-width taste profile */
    tastePanel: ReactNode;
    /** Slot: full-width session history */
    historyPanel: ReactNode;
    /** Slot: session presets strip */
    presetsStrip?: ReactNode;
};

export default function AgentDashboard({
    config,
    sessions,
    onToggle,
    onModeChange,
    middleRow,
    tastePanel,
    historyPanel,
    presetsStrip,
}: Props) {
    const sessionCount = sessions.length;
    const trackCount = sessions.reduce((s, x) => s + x.licenses.length, 0);
    const totalSpend = sessions.reduce((s, x) => s + x.spentUsd, 0);

    return (
        <div className="aid-page">
            {/* ── Page header ─────────────────────────────────────── */}
            <div className="aid-page-header">
                <h1 className="aid-page-title">
                    <span className="text-gradient">AI DJ</span>
                </h1>
                <p className="aid-page-subtitle">
                    Your autonomous music curator
                </p>
            </div>

            {/* ── Command Center ──────────────────────────────────── */}
            <div className="aid-command">
                {/* Identity */}
                <div className="aid-command-identity">
                    <div className="aid-orb-wrap">
                        <div className="aid-orb" />
                        <span className={`aid-orb-badge ${config.isActive ? "active" : ""}`}>
                            {config.isActive ? "LIVE" : "IDLE"}
                        </span>
                    </div>
                    <div className="aid-identity-text">
                        <span className="aid-agent-name">{config.name}</span>
                        <div className="aid-identity-meta">
                            <span className={`aid-status-pill ${config.isActive ? "active" : ""}`}>
                                {config.isActive ? "● Active" : "○ Inactive"}
                            </span>
                        </div>
                    </div>
                </div>

                {/* Stats */}
                <div className="aid-command-stats">
                    <div className="aid-stat-pill">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
                        <span className="aid-stat-value">{sessionCount}</span>
                        <span className="aid-stat-label">Sessions</span>
                    </div>
                    <div className="aid-stat-pill">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg>
                        <span className="aid-stat-value">{trackCount}</span>
                        <span className="aid-stat-label">Tracks</span>
                    </div>
                    <div className="aid-stat-pill">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>
                        <span className="aid-stat-value">${totalSpend.toFixed(2)}</span>
                        <span className="aid-stat-label">Spent</span>
                    </div>
                </div>

                {/* Mode toggle */}
                <div className="aid-command-mode">
                    <span className="aid-mode-label">Mode</span>
                    <div className="aid-mode-seg">
                        <button
                            className={`aid-mode-btn ${config.sessionMode === "curate" ? "active" : ""}`}
                            onClick={() => onModeChange("curate")}
                        >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
                            Curate Only
                        </button>
                        <button
                            className={`aid-mode-btn ${config.sessionMode === "buy" ? "active" : ""}`}
                            onClick={() => onModeChange("buy")}
                        >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>
                            Buy Stems
                        </button>
                    </div>
                </div>

                {/* CTA */}
                <div className="aid-command-cta">
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
            </div>

            {/* ── Session presets ─────────────────────────────────── */}
            {presetsStrip && (
                <div className="aid-presets-strip">{presetsStrip}</div>
            )}

            {/* ── Middle 3-col row ─────────────────────────────────── */}
            <div className="aid-middle-row">{middleRow}</div>

            {/* ── Taste Profile ────────────────────────────────────── */}
            <div className="aid-bottom-panel">{tastePanel}</div>

            {/* ── Session History ───────────────────────────────────── */}
            <div className="aid-bottom-panel">{historyPanel}</div>
        </div>
    );
}
