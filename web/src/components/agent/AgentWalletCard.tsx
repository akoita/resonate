"use client";

import { useMemo, useState } from "react";
import type { AgentWalletStatus, AgentTransaction } from "../../lib/api";

type Props = {
    walletStatus: AgentWalletStatus | null;
    transactions: AgentTransaction[];
    isEnabling: boolean;
    isDisabling: boolean;
    onEnable: () => Promise<AgentWalletStatus | undefined>;
    onDisable: () => Promise<void>;
    onRefreshTransactions: () => Promise<void>;
};

export default function AgentWalletCard({
    walletStatus,
    transactions,
    isEnabling,
    isDisabling,
    onEnable,
    onDisable,
    onRefreshTransactions,
}: Props) {
    const [txLimit, setTxLimit] = useState(5);

    const isEnabled = walletStatus?.enabled ?? false;
    const alertLevel = walletStatus?.alertLevel ?? "none";

    const budgetCapUsd = walletStatus?.budgetCapUsd ?? 0;
    const spentUsd = walletStatus?.spentUsd ?? 0;
    const remainingUsd = walletStatus?.remainingUsd ?? 0;
    const spentPct = budgetCapUsd > 0 ? Math.min((spentUsd / budgetCapUsd) * 100, 100) : 0;

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
        if (!addr) return "—";
        return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
    };

    // Snapshot current time once per render cycle
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

    const barColorClass = alertLevel === "none"
        ? "bar-healthy"
        : alertLevel === "warning"
            ? "bar-warning"
            : "bar-critical";

    return (
        <div className={`agent-card agent-wallet-card ${alertLevel !== "none" ? `alert-${alertLevel}` : ""}`}>
            <h3 className="agent-card-title">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="2" y="6" width="20" height="14" rx="2" />
                    <path d="M2 10h20" />
                    <path d="M6 14h.01" />
                </svg>
                Smart Wallet
            </h3>

            {!isEnabled ? (
                <div className="agent-wallet-empty">
                    <div className="agent-wallet-empty-icon">
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.5">
                            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                        </svg>
                    </div>
                    <p className="agent-wallet-empty-text">
                        Enable autonomous on-chain purchases for your DJ agent.
                    </p>
                    <button
                        className="agent-toggle-btn start"
                        onClick={onEnable}
                        disabled={isEnabling}
                    >
                        {isEnabling ? (
                            <>
                                <span className="agent-wallet-spinner" />
                                Enabling…
                            </>
                        ) : (
                            <>
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                                </svg>
                                Enable Smart Wallet
                            </>
                        )}
                    </button>
                </div>
            ) : (
                <div className="agent-wallet-active">
                    {/* ── Budget Progress ── */}
                    <div className="awc-budget">
                        <div className="awc-budget-header">
                            <span className="awc-budget-title">Monthly Budget</span>
                            <span className="awc-budget-nums">
                                <span className="awc-budget-spent">${spentUsd.toFixed(2)}</span>
                                <span className="awc-budget-sep">/</span>
                                <span className="awc-budget-cap">${budgetCapUsd.toFixed(2)}</span>
                            </span>
                        </div>
                        <div className="awc-budget-bar-track">
                            <div
                                className={`awc-budget-bar-fill ${barColorClass}`}
                                style={{ width: `${spentPct}%` }}
                            />
                        </div>
                        <div className="awc-budget-footer">
                            <span className="awc-budget-remaining">
                                ${remainingUsd.toFixed(2)} remaining
                            </span>
                            <span className="awc-budget-pct">{spentPct.toFixed(0)}%</span>
                        </div>
                    </div>

                    {/* ── Account Details Grid ── */}
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

                    {/* ── Transactions ── */}
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
                                                    {tx.status === "confirmed" ? "✓" : tx.status === "pending" ? "⏳" : "✗"}
                                                </span>
                                                <span className="awc-tx-price">${tx.priceUsd.toFixed(2)}</span>
                                                <span className={`awc-tx-mode ${tx.txHash?.startsWith("tx_") ? "mock" : "onchain"}`}>
                                                    {tx.txHash?.startsWith("tx_") ? "mock" : "on-chain"}
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

                    {/* ── Actions ── */}
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
