"use client";

import { useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import {
    deploySmartAccount,
    deploySmartAccountSelf,
    enableSmartAccount,
    refreshSmartAccount,
    setWalletProvider,
} from "../../lib/api";

export default function VaultSmartAccountCard() {
    const { address, token, role, wallet, refreshWallet } = useAuth();
    const [status, setStatus] = useState<string | null>(null);
    const [pending, setPending] = useState(false);
    const isAdmin = role === "admin";
    const isDeployed = Boolean(wallet?.deploymentTxHash);
    const isSmartAccount = wallet?.accountType === "erc4337" || wallet?.accountType === "kernel";

    const run = async (action: () => Promise<void>) => {
        if (!address || !token) {
            setStatus("Connect wallet to continue.");
            return;
        }
        try {
            setPending(true);
            setStatus(null);
            await action();
            await refreshWallet();
            setStatus("✓ Updated successfully");
        } catch (err) {
            setStatus((err as Error).message);
        } finally {
            setPending(false);
        }
    };

    return (
        <div className="vault-card">
            <div className="vault-card-header">
                <span className="vault-card-title">
                    <svg className="vault-card-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M12 2L2 7l10 5 10-5-10-5z" />
                        <path d="M2 17l10 5 10-5" />
                        <path d="M2 12l10 5 10-5" />
                    </svg>
                    Smart Account
                </span>
                <span
                    className={`vault-status-badge ${isDeployed
                            ? "vault-status-badge--active"
                            : isSmartAccount
                                ? "vault-status-badge--inactive"
                                : "vault-status-badge--locked"
                        }`}
                >
                    <span className="vault-status-dot" />
                    {isDeployed ? "Deployed" : isSmartAccount ? "Pending" : "EOA"}
                </span>
            </div>

            {/* Meta Info */}
            <div className="vault-meta-grid">
                <div className="vault-meta-item">
                    <span className="vault-meta-label">Provider</span>
                    <span className="vault-meta-value">{wallet?.provider ?? "local"}</span>
                </div>
                <div className="vault-meta-item">
                    <span className="vault-meta-label">Account Type</span>
                    <span className="vault-meta-value">{wallet?.accountType ?? "EOA"}</span>
                </div>
            </div>

            {/* Actions */}
            <div className="vault-actions">
                {isAdmin ? (
                    <>
                        <button
                            className="vault-btn vault-btn--ghost"
                            disabled={pending}
                            onClick={() =>
                                run(async () => {
                                    await setWalletProvider(address!, "erc4337", token!);
                                })
                            }
                        >
                            Switch to Smart Account
                        </button>
                        <button
                            className="vault-btn vault-btn--primary"
                            disabled={pending}
                            onClick={() =>
                                run(async () => {
                                    await deploySmartAccount(address!, token!);
                                })
                            }
                        >
                            Deploy Smart Account
                        </button>
                    </>
                ) : (
                    <>
                        <button
                            className="vault-btn vault-btn--ghost"
                            disabled={pending}
                            onClick={() =>
                                run(async () => {
                                    await enableSmartAccount(token!);
                                })
                            }
                        >
                            Enable Smart Account
                        </button>
                        <button
                            className="vault-btn vault-btn--ghost"
                            disabled={pending}
                            onClick={() =>
                                run(async () => {
                                    await refreshSmartAccount(token!);
                                })
                            }
                        >
                            Refresh Status
                        </button>
                        <button
                            className="vault-btn vault-btn--primary"
                            disabled={pending}
                            onClick={() =>
                                run(async () => {
                                    await deploySmartAccountSelf(token!);
                                })
                            }
                        >
                            Deploy Smart Account
                        </button>
                    </>
                )}
            </div>

            {/* Status Message */}
            {status && (
                <div className={`vault-alert ${status.startsWith("✓") ? "vault-alert--success" : "vault-alert--warning"}`} style={{ marginTop: "var(--space-4)" }}>
                    {status}
                </div>
            )}
        </div>
    );
}
