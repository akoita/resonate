"use client";

import { useMemo, useState } from "react";
import type { AgentConfig, AgentWalletStatus, AgentTransaction } from "../../lib/api";

type Props = {
    config: AgentConfig;
    spentUsd: number;
    onEdit: () => void;
    walletStatus: AgentWalletStatus | null;
    transactions: AgentTransaction[];
    isEnabling: boolean;
    isDisabling: boolean;
    onEnable: () => Promise<AgentWalletStatus | null | undefined>;
    onDisable: () => Promise<void>;
    onRefreshTransactions: () => Promise<void>;
    // Self-custodial session key state
    sessionKeyTxHash?: string | null;
    sessionKeyExplorerUrl?: string | null;
    sessionKeyPermissions?: { target: string; function: string; totalCapWei: string; perTxCapWei: string; rateLimit: number } | null;
};

export default function AgentBudgetCard({
    config,
    spentUsd,
    onEdit,
    walletStatus,
    transactions,
    isEnabling,
    isDisabling,
    onEnable,
    onDisable,
    onRefreshTransactions,
    sessionKeyTxHash,
    sessionKeyExplorerUrl,
    sessionKeyPermissions,
}: Props) {
    const [txLimit, setTxLimit] = useState(5);

    const pct = config.monthlyCapUsd > 0 ? Math.min((spentUsd / config.monthlyCapUsd) * 100, 100) : 0;
    const remaining = Math.max(0, config.monthlyCapUsd - spentUsd);
    const circumference = 2 * Math.PI * 45;
    const dashOffset = circumference - (pct / 100) * circumference;

    const isEnabled = walletStatus?.enabled ?? false;
    const alertLevel = walletStatus?.alertLevel ?? "none";

    const alertColors: Record<string, string> = {
        none: "var(--color-success, #4ade80)",
        warning: "var(--color-warning, #facc15)",
        critical: "var(--color-error, #f87171)",
        exhausted: "var(--color-error, #ef4444)",
    };

    const alertLabels: Record<string, string> = {
        none: "Healthy",
        warning: "80% spent",
        critical: "95% spent",
        exhausted: "Budget exhausted",
    };

    const barColorClass = alertLevel === "none"
        ? "bar-healthy"
        : alertLevel === "warning"
            ? "bar-warning"
            : "bar-critical";

    const formatAddress = (addr: string | null) => {
        if (!addr) return "—";
        return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
    };

    // eslint-disable-next-line react-hooks/exhaustive-deps
    const now = useMemo(() => Date.now(), [walletStatus]);

    const formatExpiry = (ts: number | null) => {
        if (!ts) return "—";
        const diff = ts - now;
        if (diff <= 0) return "Expired";
        const hours = Math.floor(diff / 3600000);
        const mins = Math.floor((diff % 3600000) / 60000);
        return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
    };

    const formatRelativeTime = (dateStr: string) => {
        const diff = now - new Date(dateStr).getTime();
        if (diff < 60000) return "just now";
        if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
        if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
        return `${Math.floor(diff / 86400000)}d ago`;
    };

    return (
        <div className={`agent-card agent-finance-card ${alertLevel !== "none" ? `alert-${alertLevel}` : ""}`}>
            <h3 className="agent-card-title">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                </svg>
                Finance
            </h3>

            {/* ── Budget Overview: Ring + Progress ── */}
            <div className="afc-budget-row">
                <div className="afc-ring-wrap">
                    <svg viewBox="0 0 100 100" className="afc-ring">
                        <circle cx="50" cy="50" r="45" className="afc-ring-bg" />
                        <circle
                            cx="50"
                            cy="50"
                            r="45"
                            className="afc-ring-fill"
                            strokeDasharray={circumference}
                            strokeDashoffset={dashOffset}
                            transform="rotate(-90 50 50)"
                        />
                    </svg>
                    <div className="afc-ring-center">
                        <span className="afc-ring-amount">${spentUsd.toFixed(2)}</span>
                        <span className="afc-ring-cap">of ${config.monthlyCapUsd}/mo</span>
                    </div>
                </div>
                <div className="afc-budget-details">
                    <div className="afc-budget-bar-section">
                        <div className="awc-budget-bar-track">
                            <div
                                className={`awc-budget-bar-fill ${barColorClass}`}
                                style={{ width: `${pct}%` }}
                            />
                        </div>
                        <div className="afc-budget-meta">
                            <span className="afc-budget-remaining">${remaining.toFixed(2)} remaining</span>
                            <span className="afc-budget-pct">{pct.toFixed(0)}%</span>
                        </div>
                    </div>
                    <button className="afc-edit-btn" onClick={onEdit}>Edit Budget</button>
                </div>
            </div>

            {/* ── Smart Wallet Section ── */}
            {!isEnabled ? (
                <div className="afc-wallet-disabled">
                    <div className="afc-wallet-disabled-info">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.5">
                            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                        </svg>
                        <span>Smart Wallet not enabled</span>
                    </div>
                    <button
                        className="afc-enable-btn"
                        onClick={onEnable}
                        disabled={isEnabling}
                    >
                        {isEnabling ? (
                            <><span className="agent-wallet-spinner" /> Enabling…</>
                        ) : (
                            "Enable Wallet"
                        )}
                    </button>
                </div>
            ) : (
                <div className="afc-wallet-active">
                    {/* Account Details */}
                    <div className="awc-details-grid">
                        <div className="awc-detail">
                            <span className="awc-detail-label">Address</span>
                            <span className="awc-detail-value mono">
                                {formatAddress(walletStatus?.walletAddress ?? null)}
                            </span>
                        </div>
                        <div className="awc-detail">
                            <span className="awc-detail-label">Account Type</span>
                            <span className={`awc-detail-badge ${walletStatus?.accountType === "erc4337" ? "badge-smart" : "badge-local"}`}>
                                {walletStatus?.accountType === "erc4337" ? "Smart Account" : "Local"}
                            </span>
                        </div>
                        <div className="awc-detail">
                            <span className="awc-detail-label">Session Key</span>
                            <span className={`awc-detail-value ${walletStatus?.sessionKeyValid ? "valid" : "invalid"}`}>
                                {walletStatus?.sessionKeyValid ? (
                                    <>
                                        <span className="awc-dot active" />
                                        {formatExpiry(walletStatus.sessionKeyExpiresAt)}
                                    </>
                                ) : (
                                    <>
                                        <span className="awc-dot" />
                                        Inactive
                                    </>
                                )}
                            </span>
                        </div>
                        <div className="awc-detail">
                            <span className="awc-detail-label">Budget Alert</span>
                            <span className="awc-detail-value" style={{ color: alertColors[alertLevel] }}>
                                {alertLabels[alertLevel]}
                            </span>
                        </div>
                    </div>

                    {/* On-chain Session Key Info */}
                    {(sessionKeyTxHash || walletStatus?.sessionKeyTxHash) && (
                        <div className="afc-session-key-info" style={{ marginTop: 12, padding: "8px 12px", background: "rgba(255,255,255,0.03)", borderRadius: 8, fontSize: "0.8rem" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                                <span className="awc-detail-label">Session Key Tx</span>
                                {(sessionKeyExplorerUrl || walletStatus?.sessionKeyExplorerUrl) ? (
                                    <a
                                        href={sessionKeyExplorerUrl || walletStatus?.sessionKeyExplorerUrl || "#"}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        style={{ color: "var(--accent)", display: "inline-flex", alignItems: "center", gap: 4, textDecoration: "none" }}
                                    >
                                        {formatAddress(sessionKeyTxHash || walletStatus?.sessionKeyTxHash || null)}
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                                            <polyline points="15 3 21 3 21 9" />
                                            <line x1="10" y1="14" x2="21" y2="3" />
                                        </svg>
                                    </a>
                                ) : (
                                    <span className="mono" style={{ opacity: 0.6 }}>{formatAddress(sessionKeyTxHash || walletStatus?.sessionKeyTxHash || null)}</span>
                                )}
                            </div>
                            {(sessionKeyPermissions || walletStatus?.sessionKeyPermissions) && (
                                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
                                    <span style={{ padding: "2px 6px", background: "rgba(99,102,241,0.15)", borderRadius: 4, fontSize: "0.7rem" }}>
                                        fn: {(sessionKeyPermissions || walletStatus?.sessionKeyPermissions)?.function}
                                    </span>
                                    <span style={{ padding: "2px 6px", background: "rgba(99,102,241,0.15)", borderRadius: 4, fontSize: "0.7rem" }}>
                                        rate: {(sessionKeyPermissions || walletStatus?.sessionKeyPermissions)?.rateLimit} tx/hr
                                    </span>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Transactions */}
                    <div className="awc-tx-section">
                        <div className="awc-tx-header">
                            <span className="awc-tx-title">Recent Transactions</span>
                            <button className="awc-tx-refresh" onClick={onRefreshTransactions} title="Refresh">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M21 2v6h-6" />
                                    <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
                                    <path d="M3 22v-6h6" />
                                    <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
                                </svg>
                            </button>
                        </div>
                        {transactions.length === 0 ? (
                            <p className="awc-tx-empty">No transactions yet.</p>
                        ) : (
                            <>
                                <div className="awc-tx-list">
                                    {transactions.slice(0, txLimit).map((tx) => (
                                        <div key={tx.id} className="awc-tx-row">
                                            <div className="awc-tx-left">
                                                <span className={`awc-tx-status ${tx.status}`}>
                                                    {tx.status === "confirmed" ? "✓" : tx.status === "pending" ? "⏳" : tx.status === "curated" ? "🎧" : "✗"}
                                                </span>
                                                <span className="awc-tx-price">${tx.priceUsd.toFixed(2)}</span>
                                                <span className={`awc-tx-mode ${tx.status === "curated" ? "curated" : "onchain"}`}>
                                                    {tx.status === "curated" ? "curated" : "on-chain"}
                                                </span>
                                                {(tx.stemName || tx.trackTitle) && (
                                                    <span className="awc-tx-stem" title={`${tx.stemName ?? "Stem"} · ${tx.trackTitle ?? "Unknown"}`}>
                                                        {tx.stemName ?? "Stem"}
                                                        {tx.trackTitle && <span className="awc-tx-track"> · {tx.trackTitle}</span>}
                                                    </span>
                                                )}
                                            </div>
                                            <div className="awc-tx-right">
                                                <span className="awc-tx-time">{formatRelativeTime(tx.createdAt)}</span>
                                                <span className="awc-tx-hash mono">
                                                    {tx.txHash ? `${tx.txHash.slice(0, 10)}…` : "pending"}
                                                </span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                                {transactions.length > txLimit && (
                                    <button
                                        className="awc-tx-more"
                                        onClick={() => setTxLimit((prev) => prev + 5)}
                                    >
                                        Show more ({transactions.length - txLimit} remaining)
                                    </button>
                                )}
                            </>
                        )}
                    </div>

                    {/* Actions */}
                    <div className="awc-actions">
                        <button
                            className="awc-revoke-btn"
                            onClick={onDisable}
                            disabled={isDisabling}
                        >
                            {isDisabling ? "Revoking…" : "Revoke Key"}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
