"use client";

import type { AgentConfig, AgentNextPickResponse } from "../../lib/api";

type Props = {
    config: AgentConfig;
    activeSessionId: string | null;
    pick: AgentNextPickResponse | null;
    isLoading: boolean;
    onPick: () => Promise<void>;
};

function formatStatus(value?: string) {
    if (!value) return "Runtime";
    return value.replace(/_/g, " ");
}

function formatMoney(value?: number) {
    if (typeof value !== "number" || !Number.isFinite(value)) return "$0.00";
    return `$${value.toFixed(2)}`;
}

function humanReason(status?: string, reason?: string) {
    if (status === "no_tracks") return "No matching tracks found for the selected taste profile.";
    if (status === "all_rejected") return "Matching tracks were found, but none passed budget or policy checks.";
    if (reason === "no_matching_taste_candidates") return "No catalog candidates matched the selected vibes.";
    return reason ? formatStatus(reason) : "No runtime pick returned.";
}

export default function AgentNextPickCard({
    config,
    activeSessionId,
    pick,
    isLoading,
    onPick,
}: Props) {
    const disabled = !config.isActive || !activeSessionId || isLoading;
    const hasTrack = pick?.status === "ok" && pick.track;
    const emptyStatus = pick && pick.status !== "ok";

    return (
        <div className="agent-card agent-next-pick-card">
            <div className="agent-card-header compact">
                <div className="agent-next-pick-icon" aria-hidden="true">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M9 18V5l12-2v13" />
                        <circle cx="6" cy="18" r="3" />
                        <circle cx="18" cy="16" r="3" />
                    </svg>
                </div>
                <div className="agent-card-info">
                    <h3 className="agent-card-name">Next AI Pick</h3>
                    <div className="agent-status-row">
                        <span className={`agent-status-label ${config.isActive ? "active" : ""}`}>
                            {config.isActive ? "Runtime Ready" : "Session Paused"}
                        </span>
                        <span className="agent-mode-badge curate">
                            {activeSessionId ? "Session Live" : "No Session"}
                        </span>
                    </div>
                </div>
            </div>

            <div className="agent-next-pick-body">
                {hasTrack ? (
                    <div className="agent-next-pick-result">
                        <span className="agent-next-pick-kicker">{formatStatus(pick.runtimeStatus)}</span>
                        <h4>{pick.track!.title}</h4>
                        <div className="agent-next-pick-meta">
                            <span>{pick.licenseType ?? "personal"}</span>
                            <span>{formatMoney(pick.priceUsd)}</span>
                            {typeof pick.score === "number" && <span>score {pick.score}</span>}
                            {pick.reason && <span>{formatStatus(pick.reason)}</span>}
                        </div>
                        {pick.explanation?.length ? (
                            <div className="agent-next-pick-reasons">
                                {pick.explanation.slice(0, 3).map((item) => (
                                    <span key={item} className="agent-identity-pill">{item}</span>
                                ))}
                            </div>
                        ) : null}
                        {pick.audioFeatures ? (
                            <p className="agent-taste-hint">
                                Audio signal: {pick.audioFeatures.energyBand ?? "unknown"} energy
                                {pick.audioFeatures.tempoBpm ? `, ${pick.audioFeatures.tempoBpm} BPM` : ""}
                                {pick.audioFeatures.source ? ` (${formatStatus(pick.audioFeatures.source)})` : ""}
                            </p>
                        ) : null}
                    </div>
                ) : emptyStatus ? (
                    <div className="agent-next-pick-empty">
                        <span className="agent-next-pick-kicker">{formatStatus(pick.status)}</span>
                        <p>{humanReason(pick.status, pick.reason)}</p>
                        {pick.generationsUsed ? (
                            <p className="agent-taste-hint">Generated fallback queued after sparse catalog search.</p>
                        ) : null}
                    </div>
                ) : (
                    <div className="agent-next-pick-empty">
                        <span className="agent-next-pick-kicker">Runtime path</span>
                        <p>{config.isActive ? "Ready to request a commerce-aware recommendation." : "Start a session to request a pick."}</p>
                    </div>
                )}
            </div>

            <button
                className="agent-next-pick-btn"
                onClick={onPick}
                disabled={disabled}
                title={!config.isActive ? "Start a session first" : !activeSessionId ? "Waiting for session id" : "Ask the runtime for the next pick"}
            >
                {isLoading ? (
                    <>
                        <span className="agent-wallet-spinner" />
                        Picking
                    </>
                ) : (
                    <>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                            <polygon points="5 4 15 12 5 20 5 4" />
                            <rect x="17" y="5" width="2" height="14" rx="1" />
                        </svg>
                        Next Pick
                    </>
                )}
            </button>
        </div>
    );
}
