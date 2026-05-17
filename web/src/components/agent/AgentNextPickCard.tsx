"use client";

import type { AgentConfig, AgentNextPickResponse } from "../../lib/api";

type Props = {
    config: AgentConfig;
    activeSessionId: string | null;
    pick: AgentNextPickResponse | null;
    isLoading: boolean;
    onPick: () => Promise<void>;
};

function fmt(v?: number) {
    return typeof v === "number" && Number.isFinite(v) ? `$${v.toFixed(2)}` : "$0.00";
}

function humanStatus(status?: string) {
    if (!status) return "Runtime";
    return status.replace(/_/g, " ");
}

function humanReason(status?: string, reason?: string) {
    if (status === "no_tracks") return "No matching tracks found for the selected taste profile.";
    if (status === "all_rejected") return "Matching tracks were found, but none passed budget or policy checks.";
    if (reason === "no_matching_taste_candidates") return "No catalog candidates matched the selected vibes.";
    return reason ? humanStatus(reason) : "No runtime pick returned.";
}

export default function AgentNextPickCard({ config, activeSessionId, pick, isLoading, onPick }: Props) {
    const disabled = !config.isActive || !activeSessionId || isLoading;
    const hasTrack = pick?.status === "ok" && pick.track;
    const emptyStatus = pick && pick.status !== "ok";

    return (
        <div className="aid-card aid-card--next-pick">
            <div className="aid-card-header">
                <div className="aid-card-title-row">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
                    </svg>
                    <span className="aid-card-title">Next AI Pick</span>
                </div>
                <span className={`aid-session-pill ${config.isActive ? "active" : ""}`}>
                    {activeSessionId ? "Session Live" : "No Session"}
                </span>
            </div>

            <div className="aid-np-body">
                {hasTrack ? (
                    <>
                        {/* Art placeholder — track type has no release/artwork field */}
                        <div className="aid-np-art">
                            <div className="aid-np-art-placeholder">
                                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg>
                            </div>
                        </div>
                        <div className="aid-np-info">
                            <p className="aid-np-kicker">{humanStatus(pick!.runtimeStatus)}</p>
                            <h4 className="aid-np-title">{pick!.track!.title}</h4>
                            <div className="aid-np-meta">
                                <span className="aid-np-tag">{pick!.licenseType ?? "personal"}</span>
                                <span className="aid-np-price">{fmt(pick!.priceUsd)}</span>
                                {typeof pick!.score === "number" && (
                                    <span className="aid-np-tag">score {pick!.score}</span>
                                )}
                            </div>
                            {pick!.audioFeatures && (
                                <p className="aid-np-hint">
                                    {pick!.audioFeatures.energyBand ?? "unknown"} energy
                                    {pick!.audioFeatures.tempoBpm ? ` · ${pick!.audioFeatures.tempoBpm} BPM` : ""}
                                </p>
                            )}
                            {pick!.explanation?.length ? (
                                <div className="aid-np-reasons">
                                    {pick!.explanation.slice(0, 2).map((item) => (
                                        <span key={item} className="aid-np-reason-pill">{item}</span>
                                    ))}
                                </div>
                            ) : null}
                        </div>
                    </>
                ) : emptyStatus ? (
                    <div className="aid-np-empty">
                        <p className="aid-np-kicker">{humanStatus(pick!.status)}</p>
                        <p className="aid-np-hint">{humanReason(pick!.status, pick!.reason)}</p>
                    </div>
                ) : (
                    <div className="aid-np-empty">
                        <div className="aid-np-empty-icon">
                            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" opacity="0.35">
                                <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
                            </svg>
                        </div>
                        <p className="aid-np-hint">
                            {config.isActive
                                ? "Ready to request a recommendation."
                                : "Start a session to request a pick."}
                        </p>
                    </div>
                )}
            </div>

            <button
                className="aid-np-btn"
                onClick={onPick}
                disabled={disabled}
                title={
                    !config.isActive
                        ? "Start a session first"
                        : !activeSessionId
                        ? "Waiting for session"
                        : "Request the next AI pick"
                }
            >
                {isLoading ? (
                    <>
                        <span className="aid-spinner" />
                        Picking…
                    </>
                ) : (
                    <>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
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
