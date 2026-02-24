"use client";

import { Button } from "../ui/Button";
import { WalletRecord } from "../../lib/api";

type VaultHeroProps = {
    wallet: WalletRecord | null;
    status: string;
    address?: string | null;
    onRefresh: () => void;
};

export default function VaultHero({ wallet, status, address, onRefresh }: VaultHeroProps) {
    const isDeployed = Boolean(wallet?.deploymentTxHash);
    const isSmartAccount = wallet?.accountType === "erc4337" || wallet?.accountType === "kernel";

    return (
        <div className="vault-hero">
            <div className="vault-hero-content">
                {/* Balance Display */}
                <div className="vault-balance-label">Total Balance</div>
                <div className="vault-balance">
                    <span className="vault-balance-currency">$</span>
                    {wallet?.balanceUsd?.toFixed(2) ?? "0.00"}
                </div>

                {/* Status Badges */}
                <div className="vault-status-row">
                    <span
                        className={`vault-status-badge ${status === "authenticated"
                            ? "vault-status-badge--active"
                            : status === "loading"
                                ? "vault-status-badge--inactive"
                                : "vault-status-badge--locked"
                            }`}
                    >
                        <span className="vault-status-dot" />
                        {status === "authenticated" ? "Connected" : status === "loading" ? "Connecting..." : "Disconnected"}
                    </span>

                    {isSmartAccount && (
                        <span
                            className={`vault-status-badge ${isDeployed ? "vault-status-badge--active" : "vault-status-badge--inactive"
                                }`}
                        >
                            <span className="vault-status-dot" />
                            {isDeployed ? "Smart Account Deployed" : "Smart Account Pending"}
                        </span>
                    )}

                    <button className="vault-btn vault-btn--ghost" onClick={onRefresh}>
                        ↻ Refresh
                    </button>
                </div>
            </div>
        </div>
    );
}
