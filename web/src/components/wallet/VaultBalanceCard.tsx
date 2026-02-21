"use client";

import { WalletRecord } from "../../lib/api";

type VaultBalanceCardProps = {
    wallet: WalletRecord | null;
};

export default function VaultBalanceCard({ wallet }: VaultBalanceCardProps) {
    if (!wallet) {
        return (
            <div className="vault-card">
                <div className="vault-card-header">
                    <span className="vault-card-title">
                        <svg className="vault-card-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <rect x="2" y="4" width="20" height="16" rx="2" />
                            <path d="M6 8h.01M6 12h.01M6 16h.01" />
                        </svg>
                        Balance & Limits
                    </span>
                </div>
                <div className="vault-alert vault-alert--info">
                    Connect your wallet to view balance information.
                </div>
            </div>
        );
    }

    const remaining = Math.max(0, wallet.monthlyCapUsd - wallet.spentUsd);
    const usagePercent = wallet.monthlyCapUsd > 0
        ? Math.min(100, (wallet.spentUsd / wallet.monthlyCapUsd) * 100)
        : 0;

    return (
        <div className="vault-card">
            <div className="vault-card-header">
                <span className="vault-card-title">
                    <svg className="vault-card-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="2" y="4" width="20" height="16" rx="2" />
                        <path d="M6 8h.01M6 12h.01M6 16h.01" />
                    </svg>
                    Balance & Limits
                </span>
            </div>

            {/* Gas Tank */}
            <div className="vault-gas-tank">
                <div className="vault-gas-labels">
                    <span>Monthly Usage</span>
                    <span>
                        <span className="vault-gas-value">${wallet.spentUsd.toFixed(2)}</span>
                        {" / $"}{wallet.monthlyCapUsd.toFixed(2)}
                    </span>
                </div>
                <div className="vault-gas-bar">
                    <div
                        className="vault-gas-fill"
                        style={{ width: `${usagePercent}%` }}
                    />
                </div>
                <div className="vault-gas-labels">
                    <span>Remaining</span>
                    <span className="vault-gas-value">${remaining.toFixed(2)}</span>
                </div>
            </div>

            {/* AA Infrastructure Meta */}
            <div className="vault-meta-grid" style={{ marginTop: "var(--space-5)" }}>
                <div className="vault-meta-item">
                    <span className="vault-meta-label">Account Address</span>
                    <span className="vault-meta-value">
                        {wallet.address ? `${wallet.address.slice(0, 8)}...${wallet.address.slice(-6)}` : "N/A"}
                    </span>
                </div>
                <div className="vault-meta-item">
                    <span className="vault-meta-label">Entry Point</span>
                    <span className="vault-meta-value">
                        {wallet.entryPoint ? `${wallet.entryPoint.slice(0, 8)}...${wallet.entryPoint.slice(-6)}` : "N/A"}
                    </span>
                </div>
                <div className="vault-meta-item">
                    <span className="vault-meta-label">Factory</span>
                    <span className="vault-meta-value">
                        {wallet.factory ? `${wallet.factory.slice(0, 8)}...${wallet.factory.slice(-6)}` : "N/A"}
                    </span>
                </div>
                <div className="vault-meta-item">
                    <span className="vault-meta-label">Paymaster</span>
                    <span className="vault-meta-value">
                        {wallet.paymaster ? `${wallet.paymaster.slice(0, 8)}...${wallet.paymaster.slice(-6)}` : "N/A"}
                    </span>
                </div>
                <div className="vault-meta-item">
                    <span className="vault-meta-label">Bundler</span>
                    <span className="vault-meta-value">
                        {wallet.bundler ? `${wallet.bundler.slice(0, 8)}...${wallet.bundler.slice(-6)}` : "N/A"}
                    </span>
                </div>
            </div>
        </div>
    );
}
