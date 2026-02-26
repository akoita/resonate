"use client";

import { useState } from "react";
import { WalletRecord } from "../../lib/api";
import { useOnChainBalance } from "../../hooks/useOnChainBalance";
import { useIsDeployed } from "../../hooks/useIsDeployed";

type VaultHeroProps = {
    wallet: WalletRecord | null;
    status: string;
    address: string | null;
    onRefresh: () => void;
};

const EXPLORER_URL = "https://sepolia.etherscan.io";
const ETH_PRICE_APPROX = 3000; // Approximate USD/ETH for display

export default function VaultHero({ wallet, status, address, onRefresh }: VaultHeroProps) {
    const { isDeployed } = useIsDeployed(address);
    const isSmartAccount = wallet?.accountType === "erc4337" || wallet?.accountType === "kernel";
    const { balanceEth, loading: balanceLoading } = useOnChainBalance(address);
    const [copied, setCopied] = useState(false);

    const ethValue = balanceEth ? Number(balanceEth) : 0;
    const usdValue = (ethValue * ETH_PRICE_APPROX).toFixed(2);
    const shortAddress = address ? `${address.slice(0, 6)}…${address.slice(-4)}` : null;

    const copyAddress = async () => {
        if (!address) return;
        await navigator.clipboard.writeText(address);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className="vault-hero">
            {/* Animated mesh background */}
            <div className="vault-hero-mesh" />

            <div className="vault-hero-content">
                {/* Network Badge */}
                <div className="vault-hero-top-row">
                    <div className="vault-network-badge">
                        <span className="vault-network-dot" />
                        Sepolia Testnet
                    </div>
                    <button className="vault-btn vault-btn--ghost vault-btn--sm" onClick={onRefresh}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polyline points="23 4 23 10 17 10" />
                            <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" />
                        </svg>
                        Refresh
                    </button>
                </div>

                {/* Balance Display */}
                <div className="vault-balance-group">
                    <div className="vault-balance-label">Smart Account Balance</div>
                    <div className="vault-balance">
                        {balanceLoading ? (
                            <span className="vault-balance-skeleton">Loading…</span>
                        ) : (
                            <>
                                {ethValue.toFixed(6)}
                                <span className="vault-balance-currency"> ETH</span>
                            </>
                        )}
                    </div>
                    <div className="vault-balance-usd">
                        ≈ ${usdValue} USD
                    </div>
                </div>

                {/* Address Pill */}
                {shortAddress && (
                    <div className="vault-hero-footer">
                        <button className="vault-address-pill" onClick={copyAddress} title="Copy address">
                            <span className="vault-address-pill-text">{shortAddress}</span>
                            {copied ? (
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <polyline points="20 6 9 17 4 12" />
                                </svg>
                            ) : (
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                                    <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                                </svg>
                            )}
                        </button>
                        <a
                            href={`${EXPLORER_URL}/address/${address}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="vault-explorer-btn"
                            title="View on Etherscan"
                        >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
                                <polyline points="15 3 21 3 21 9" />
                                <line x1="10" y1="14" x2="21" y2="3" />
                            </svg>
                        </a>

                        {/* Status Badges */}
                        <span
                            className={`vault-status-badge ${status === "authenticated"
                                ? "vault-status-badge--active"
                                : status === "loading"
                                    ? "vault-status-badge--inactive"
                                    : "vault-status-badge--locked"
                                }`}
                        >
                            <span className="vault-status-dot" />
                            {status === "authenticated" ? "Connected" : status === "loading" ? "Connecting…" : "Disconnected"}
                        </span>

                        {isSmartAccount && (
                            <span
                                className={`vault-status-badge ${isDeployed ? "vault-status-badge--active" : "vault-status-badge--inactive"}`}
                            >
                                <span className="vault-status-dot" />
                                {isDeployed ? "Deployed" : "Pending"}
                            </span>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
