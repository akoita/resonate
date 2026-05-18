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

const BAR_GRADIENTS: Record<string, string> = {
    none: "linear-gradient(90deg, #34d399, #10b981)",
    warning: "linear-gradient(90deg, #fbbf24, #f59e0b)",
    critical: "linear-gradient(90deg, #f87171, #ef4444)",
    exhausted: "linear-gradient(90deg, #ef4444, #dc2626)",
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

    const formatAddress = (addr: string | null) => {
        if (!addr) return "\u2014";
        return `${addr.slice(0, 6)}\u2026${addr.slice(-4)}`;
    };

    // eslint-disable-next-line react-hooks/exhaustive-deps
    const now = useMemo(() => Date.now(), [walletStatus]);

    const formatExpiry = (ts: number | null) => {
        if (!ts) return "\u2014";
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
        <div className="aid-card aid-card--finance">
            <div className="aid-card-header">
                <div className="aid-card-title-row">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                    </svg>
                    <span className="aid-card-title">Finance</span>
                </div>
            </div>

            {/* ── Budget Overview: Donut + Progress ── */}
            <div className="aid-fin-donut-row">
                <div className="aid-fin-donut">
                    <svg viewBox="0 0 100 100">
                        <defs>
                            <linearGradient id="aid-donut-grad" x1="0" y1="0" x2="1" y2="1">
                                <stop offset="0%" stopColor="#34d399" />
                                <stop offset="100%" stopColor="#10b981" />
                            </linearGradient>
                        </defs>
                        <circle cx="50" cy="50" r="45" className="aid-fin-donut-bg" />
                        <circle
                            cx="50"
                            cy="50"
                            r="45"
                            className="aid-fin-donut-fill"
                            strokeDasharray={circumference}
                            strokeDashoffset={dashOffset}
                        />
                    </svg>
                    <div className="aid-fin-donut-center">
                        <span className="aid-fin-donut-amount">${spentUsd.toFixed(2)}</span>
                        <span className="aid-fin-donut-cap">of ${config.monthlyCapUsd}/mo</span>
                    </div>
                </div>
                <div className="aid-fin-budget-detail">
                    <div className="aid-fin-bar-track">
                        <div
                            className="aid-fin-bar-fill"
                            style={{
                                width: `${pct}%`,
                                ...(alertLevel !== "none" ? { background: BAR_GRADIENTS[alertLevel] } : {}),
                            }}
                        />
                    </div>
                    <div className="aid-fin-bar-meta">
                        <span>${remaining.toFixed(2)} remaining</span>
                        <span>{pct.toFixed(0)}%</span>
                    </div>
                    <button className="aid-ghost-btn" onClick={onEdit}>Edit Budget</button>
                </div>
            </div>

            {/* ── Smart Wallet Section ── */}
            {!isEnabled ? (
                <div className="aid-wallet-off">
                    <div className="aid-wallet-off-info">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.5">
                            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                        </svg>
                        <span>Smart Wallet not enabled</span>
                    </div>
                    <button
                        className="aid-enable-btn"
                        onClick={onEnable}
                        disabled={isEnabling}
                    >
                        {isEnabling ? (
                            <><span className="aid-spinner" /> Enabling&hellip;</>
                        ) : (
                            "Enable Wallet"
                        )}
                    </button>
                </div>
            ) : (
                <div className="aid-wallet-on">
                    {/* Account Details */}
                    <div className="aid-wallet-grid">
                        <div className="aid-wallet-row">
                            <span className="aid-wallet-lbl">Address</span>
                            <span className="aid-wallet-val mono">
                                {formatAddress(walletStatus?.walletAddress ?? null)}
                            </span>
                        </div>
                        <div className="aid-wallet-row">
                            <span className="aid-wallet-lbl">Account Type</span>
                            <span className={`aid-wallet-badge ${walletStatus?.accountType === "erc4337" ? "smart" : "local"}`}>
                                {walletStatus?.accountType === "erc4337" ? "Smart Account" : "Local"}
                            </span>
                        </div>
                        <div className="aid-wallet-row">
                            <span className="aid-wallet-lbl">Session Key</span>
                            <span className={`aid-wallet-val ${walletStatus?.sessionKeyValid ? "valid" : "invalid"}`}>
                                {walletStatus?.sessionKeyValid ? (
                                    <>
                                        <span className="aid-dot active" />
                                        {formatExpiry(walletStatus.sessionKeyExpiresAt)}
                                    </>
                                ) : (
                                    <>
                                        <span className="aid-dot" />
                                        Inactive
                                    </>
                                )}
                            </span>
                        </div>
                        <div className="aid-wallet-row">
                            <span className="aid-wallet-lbl">Budget Alert</span>
                            <span className="aid-wallet-val" style={{ color: alertColors[alertLevel] }}>
                                {alertLabels[alertLevel]}
                            </span>
                        </div>
                    </div>

                    {/* On-chain Session Key Info */}
                    {(sessionKeyTxHash || walletStatus?.sessionKeyTxHash) && (
                        <div className="aid-session-key-info">
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                                <span className="aid-wallet-lbl">Session Key Tx</span>
                                {(sessionKeyExplorerUrl || walletStatus?.sessionKeyExplorerUrl) ? (
                                    <a
                                        href={sessionKeyExplorerUrl || walletStatus?.sessionKeyExplorerUrl || "#"}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="aid-tx-link"
                                    >
                                        {formatAddress(sessionKeyTxHash || walletStatus?.sessionKeyTxHash || null)}
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                                            <polyline points="15 3 21 3 21 9" />
                                            <line x1="10" y1="14" x2="21" y2="3" />
                                        </svg>
                                    </a>
                                ) : (
                                    <span className="aid-tx-hash">{formatAddress(sessionKeyTxHash || walletStatus?.sessionKeyTxHash || null)}</span>
                                )}
                            </div>
                            {(sessionKeyPermissions || walletStatus?.sessionKeyPermissions) && (
                                <div className="aid-sk-tags">
                                    <span className="aid-sk-tag">
                                        fn: {(sessionKeyPermissions || walletStatus?.sessionKeyPermissions)?.function}
                                    </span>
                                    <span className="aid-sk-tag">
                                        rate: {(sessionKeyPermissions || walletStatus?.sessionKeyPermissions)?.rateLimit} tx/hr
                                    </span>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Transactions */}
                    <div className="aid-tx-section">
                        <div className="aid-tx-header">
                            <span className="aid-tx-title">Recent Transactions</span>
                            <button className="aid-icon-btn" onClick={onRefreshTransactions} title="Refresh">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M21 2v6h-6" />
                                    <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
                                    <path d="M3 22v-6h6" />
                                    <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
                                </svg>
                            </button>
                        </div>
                        {transactions.length === 0 ? (
                            <p className="aid-tx-empty">No transactions yet.</p>
                        ) : (
                            <>
                                <div className="aid-tx-list">
                                    {transactions.slice(0, txLimit).map((tx) => (
                                        <div key={tx.id} className="aid-tx-row">
                                            <span className={`aid-tx-status ${tx.status}`}>
                                                {tx.status === "confirmed" ? "\u2713" : tx.status === "pending" ? "\u23F3" : tx.status === "curated" ? "\u{1F3A7}" : "\u2717"}
                                            </span>
                                            <span className="aid-tx-price">${tx.priceUsd.toFixed(2)}</span>
                                            <span className={`aid-tx-mode ${tx.status === "curated" ? "curated" : "onchain"}`}>
                                                {tx.status === "curated" ? "curated" : "on-chain"}
                                            </span>
                                            {(tx.stemName || tx.trackTitle) && (
                                                <span className="aid-tx-stem" title={`${tx.stemName ?? "Stem"} \u00B7 ${tx.trackTitle ?? "Unknown"}`}>
                                                    {tx.stemName ?? "Stem"}
                                                    {tx.trackTitle && <span className="aid-tx-track"> &middot; {tx.trackTitle}</span>}
                                                </span>
                                            )}
                                            <span className="aid-tx-time">{formatRelativeTime(tx.createdAt)}</span>
                                            <span className={`aid-tx-hash mono ${tx.status === "failed" ? "tx-failed" : ""}`}
                                                title={tx.status === "failed" && tx.errorMessage ? tx.errorMessage : undefined}
                                            >
                                                {tx.txHash
                                                    ? `${tx.txHash.slice(0, 10)}\u2026`
                                                    : tx.status === "failed"
                                                        ? "failed"
                                                        : tx.status}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                                {transactions.length > txLimit && (
                                    <button
                                        className="aid-tx-more"
                                        onClick={() => setTxLimit((prev) => prev + 5)}
                                    >
                                        Show more ({transactions.length - txLimit} remaining)
                                    </button>
                                )}
                            </>
                        )}
                    </div>

                    {/* Actions */}
                    <div className="aid-wallet-actions">
                        <button
                            className="aid-danger-btn"
                            onClick={onDisable}
                            disabled={isDisabling}
                        >
                            {isDisabling ? "Revoking\u2026" : "Revoke Key"}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
