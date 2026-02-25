"use client";

import { useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import {
    deploySmartAccountSelf,
    enableSmartAccount,
    refreshSmartAccount,
} from "../../lib/api";
import { WalletRecord } from "../../lib/api";

type Props = {
    wallet: WalletRecord | null;
    address: string | null;
};

const EXPLORER_URL = "https://sepolia.etherscan.io";
const FAUCET_URL = "https://www.alchemy.com/faucets/ethereum-sepolia";

function AddressValue({ value, href, badge }: {
    value: string | null | undefined;
    href?: string;
    badge?: string;
}) {
    const [expanded, setExpanded] = useState(false);
    const [copied, setCopied] = useState(false);

    if (!value) return <span className="vault-detail-value">—</span>;

    const isHex = value.startsWith("0x");
    const short = isHex ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;

    const copy = async (e: React.MouseEvent) => {
        e.stopPropagation();
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <span className="vault-detail-value">
            {isHex ? (
                <span className="vault-addr-container">
                    <button
                        className="vault-addr-toggle"
                        onClick={() => setExpanded(!expanded)}
                        title={expanded ? "Collapse" : "Show full address"}
                    >
                        <span className={expanded ? "vault-addr-full" : "vault-addr-short"}>
                            {expanded ? value : short}
                        </span>
                    </button>

                    <button className="vault-addr-action" onClick={copy} title="Copy to clipboard">
                        {copied ? (
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#2ec486" strokeWidth="2.5">
                                <polyline points="20 6 9 17 4 12" />
                            </svg>
                        ) : (
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                                <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                            </svg>
                        )}
                    </button>

                    {href && (
                        <a
                            href={href}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="vault-addr-action"
                            title="View on Etherscan"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
                                <polyline points="15 3 21 3 21 9" />
                                <line x1="10" y1="14" x2="21" y2="3" />
                            </svg>
                        </a>
                    )}
                </span>
            ) : (
                value
            )}
            {badge && <span className="vault-detail-badge">{badge}</span>}
        </span>
    );
}

export default function VaultSmartAccountCard({ wallet, address }: Props) {
    const { token, refreshWallet } = useAuth();
    const [status, setStatus] = useState<string | null>(null);
    const [pending, setPending] = useState(false);
    const isDeployed = Boolean(wallet?.deploymentTxHash);

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
            setStatus("✓ Updated");
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
                <span className={`vault-status-badge ${isDeployed ? "vault-status-badge--active" : "vault-status-badge--inactive"}`}>
                    <span className="vault-status-dot" />
                    {isDeployed ? "Deployed" : "Pending"}
                </span>
            </div>

            {/* Account Details */}
            <div className="vault-detail-list">
                <div className="vault-detail-row">
                    <span className="vault-detail-label">Address</span>
                    <AddressValue value={address} href={address ? `${EXPLORER_URL}/address/${address}` : undefined} />
                </div>
                <div className="vault-detail-row">
                    <span className="vault-detail-label">Entry Point</span>
                    <AddressValue value={wallet?.entryPoint} href={wallet?.entryPoint ? `${EXPLORER_URL}/address/${wallet.entryPoint}` : undefined} />
                </div>
                <div className="vault-detail-row">
                    <span className="vault-detail-label">Factory</span>
                    <AddressValue value={wallet?.factory} href={wallet?.factory ? `${EXPLORER_URL}/address/${wallet.factory}` : undefined} />
                </div>
                <div className="vault-detail-row">
                    <span className="vault-detail-label">Paymaster</span>
                    <AddressValue
                        value={wallet?.paymaster ? "Pimlico" : "Self-funded"}
                        badge={wallet?.paymaster ? "✓" : undefined}
                    />
                </div>
                <div className="vault-detail-row">
                    <span className="vault-detail-label">Bundler</span>
                    <AddressValue
                        value={wallet?.bundler?.includes("pimlico") ? "Pimlico" : wallet?.bundler}
                    />
                </div>
                {wallet?.deploymentTxHash && (
                    <div className="vault-detail-row">
                        <span className="vault-detail-label">Deploy TX</span>
                        <AddressValue
                            value={wallet.deploymentTxHash}
                            href={`${EXPLORER_URL}/tx/${wallet.deploymentTxHash}`}
                        />
                    </div>
                )}
            </div>

            {/* Actions */}
            <div className="vault-actions">
                <button
                    className="vault-btn vault-btn--ghost vault-btn--sm"
                    disabled={pending}
                    onClick={() => run(async () => { await refreshSmartAccount(token!); })}
                >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="23 4 23 10 17 10" />
                        <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" />
                    </svg>
                    Refresh
                </button>
                {!isDeployed && (
                    <>
                        <button
                            className="vault-btn vault-btn--ghost vault-btn--sm"
                            disabled={pending}
                            onClick={() => run(async () => { await enableSmartAccount(token!); })}
                        >
                            Enable
                        </button>
                        <button
                            className="vault-btn vault-btn--primary vault-btn--sm"
                            disabled={pending}
                            onClick={() => run(async () => { await deploySmartAccountSelf(token!); })}
                        >
                            Deploy
                        </button>
                    </>
                )}
                <a
                    href={FAUCET_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="vault-btn vault-btn--ghost vault-btn--sm"
                    style={{ textDecoration: "none" }}
                >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M12 2v20M2 12h20" />
                    </svg>
                    Get Test ETH
                </a>
            </div>

            {/* Status Message */}
            {status && (
                <div className={`vault-alert ${status.startsWith("✓") ? "vault-alert--success" : "vault-alert--warning"}`} style={{ marginTop: "var(--space-3)" }}>
                    {status}
                </div>
            )}
        </div>
    );
}
