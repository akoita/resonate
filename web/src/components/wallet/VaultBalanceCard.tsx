"use client";

import { WalletRecord } from "../../lib/api";

type VaultBalanceCardProps = {
    wallet: WalletRecord | null;
    address: string | null;
};

/** Sepolia block explorer base URL */
const EXPLORER_URL = "https://sepolia.etherscan.io";

export default function VaultBalanceCard({ wallet, address }: VaultBalanceCardProps) {
    const shortAddr = (addr: string | null | undefined) =>
        addr ? `${addr.slice(0, 8)}...${addr.slice(-6)}` : "N/A";

    return (
        <div className="vault-card">
            <div className="vault-card-header">
                <span className="vault-card-title">
                    <svg className="vault-card-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
                        <line x1="1" y1="10" x2="23" y2="10" />
                    </svg>
                    Account Details
                </span>
            </div>

            {/* Meta Grid */}
            <div className="vault-meta-grid" style={{ marginTop: "var(--space-3)" }}>
                <div className="vault-meta-item" style={{ gridColumn: "1 / -1" }}>
                    <span className="vault-meta-label">Smart Account</span>
                    <span className="vault-meta-value">
                        {address ? (
                            <a
                                href={`${EXPLORER_URL}/address/${address}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="vault-address-link"
                                title={address}
                            >
                                {shortAddr(address)}
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginLeft: 4 }}>
                                    <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
                                    <polyline points="15 3 21 3 21 9" />
                                    <line x1="10" y1="14" x2="21" y2="3" />
                                </svg>
                            </a>
                        ) : "N/A"}
                    </span>
                </div>

                <div className="vault-meta-item">
                    <span className="vault-meta-label">Entry Point</span>
                    <span className="vault-meta-value">{shortAddr(wallet?.entryPoint)}</span>
                </div>

                <div className="vault-meta-item">
                    <span className="vault-meta-label">Factory</span>
                    <span className="vault-meta-value">{shortAddr(wallet?.factory)}</span>
                </div>

                <div className="vault-meta-item">
                    <span className="vault-meta-label">Paymaster</span>
                    <span className="vault-meta-value">
                        {wallet?.paymaster ? "Pimlico (Sponsored)" : "Self-funded"}
                    </span>
                </div>

                <div className="vault-meta-item">
                    <span className="vault-meta-label">Bundler</span>
                    <span className="vault-meta-value">
                        {wallet?.bundler?.includes("pimlico") ? "Pimlico" : shortAddr(wallet?.bundler)}
                    </span>
                </div>
            </div>
        </div>
    );
}
