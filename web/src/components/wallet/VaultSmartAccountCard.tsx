"use client";

import { useState, useCallback } from "react";
import { useAuth } from "../auth/AuthProvider";
import {
    enableSmartAccount,
    refreshSmartAccount,
} from "../../lib/api";
import { WalletRecord } from "../../lib/api";
import { getKernelAccountConfig } from "../../lib/accountAbstraction";
import { useZeroDev } from "../auth/ZeroDevProviderClient";
import { getBrowserSafeRpcUrl, isLocalRpcUrl } from "../../lib/rpc";

type Props = {
    wallet: WalletRecord | null;
    address: string | null;
    isDeployed: boolean;
    recheck: () => void;
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

/** Detect if the RPC is a local Anvil instance */
function isLocalRpc(): boolean {
    return isLocalRpcUrl();
}

export default function VaultSmartAccountCard({ wallet, address, isDeployed, recheck }: Props) {
    const { token, refreshWallet, webAuthnKey } = useAuth();
    const { publicClient } = useZeroDev();
    const [status, setStatus] = useState<string | null>(null);
    const [pending, setPending] = useState(false);

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
            recheck(); // re-check on-chain deployment status
            setStatus("✓ Updated");
        } catch (err) {
            setStatus((err as Error).message);
        } finally {
            setPending(false);
        }
    };

    /**
     * Fund account via Anvil's anvil_setBalance.
     * Same effect as a faucet, but instant and offline.
     * In production, the user gets ETH from a real faucet or bridge.
     */
    const fundFromAnvil = useCallback(async () => {
        if (!address) return;
        const rpcUrl = getBrowserSafeRpcUrl();
        const res = await fetch(rpcUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                jsonrpc: "2.0",
                method: "anvil_setBalance",
                params: [address, "0x8AC7230489E80000"], // 10 ETH in hex
                id: 1,
            }),
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error.message);
    }, [address]);

    /**
     * Deploy the smart account by sending a 0-value self-send UserOp.
     * Uses the webAuthnKey stored during signup/login — no re-authentication needed.
     * The SDK auto-includes initCode on the first UserOp — same as production.
     */
    const deployFromFrontend = useCallback(async () => {
        if (!address || !publicClient) {
            throw new Error("No account or public client available. Please sign in first.");
        }

        if (!webAuthnKey) {
            throw new Error(
                "No Passkey key available. This happens after a page refresh. " +
                "Please sign out and sign back in, then try Deploy again."
            );
        }

        // Check if already deployed
        const code = await publicClient.getCode({ address: address as `0x${string}` });
        if (code && code !== "0x") {
            return; // Already deployed
        }

        // Build the Kernel account from the STORED webAuthnKey (same key used at signup)
        const { toPasskeyValidator, PasskeyValidatorContractVersion } = await import("@zerodev/passkey-validator");
        const { createKernelAccount, createKernelAccountClient } = await import("@zerodev/sdk");
        const { http, parseGwei } = await import("viem");
        const { sepolia } = await import("viem/chains");
        const { KERNEL_V3_1 } = await import("@zerodev/sdk/constants");
        const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID || 11155111);
        const { entryPoint, factoryAddress } = getKernelAccountConfig(chainId);

        const bundlerUrl = process.env.NEXT_PUBLIC_BUNDLER_URL || "/api/bundler";

        // Build the Passkey validator from the stored webAuthnKey
        const validator = await toPasskeyValidator(publicClient, {
            webAuthnKey,
            kernelVersion: KERNEL_V3_1,
            validatorContractVersion: PasskeyValidatorContractVersion.V0_0_1_UNPATCHED,
            entryPoint,
        });

        const account = await createKernelAccount(publicClient, {
            plugins: { sudo: validator },
            kernelVersion: KERNEL_V3_1,
            entryPoint,
            factoryAddress,
        });

        // Validate: the rebuilt account must match the UI's expected address
        const rebuiltAddress = account.address.toLowerCase();
        const expectedAddress = address.toLowerCase();
        if (rebuiltAddress !== expectedAddress) {
            console.warn(`[Deploy] Address mismatch! Rebuilt: ${account.address}, Expected: ${address}`);
            throw new Error(
                `Account address mismatch (${account.address.slice(0, 10)}… vs ${address.slice(0, 10)}…). ` +
                `Please sign out and register again.`
            );
        }

        // Create a Kernel client with local-compatible gas estimation
        const kernelClient = createKernelAccountClient({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            account: account as any,
            chain: sepolia,
            bundlerTransport: http(bundlerUrl),
            // Override gas estimation to avoid ZeroDev-specific RPC calls
            userOperation: {
                estimateFeesPerGas: async () => ({
                    maxFeePerGas: parseGwei("2"),
                    maxPriorityFeePerGas: parseGwei("1"),
                }),
            },
        });

        // Send 0-value self-send to trigger deployment via initCode
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const txHash = await (kernelClient as any).sendTransaction({
            to: account.address as `0x${string}`,
            data: "0x" as `0x${string}`,
            value: BigInt(0),
        });

        console.log(`[Deploy] Smart account deployed at ${account.address}, tx: ${txHash}`);
    }, [address, publicClient, webAuthnKey]);

    const isLocal = isLocalRpc();

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
                    <span className="vault-detail-value">
                        {wallet?.paymaster ? (
                            <a href="https://dashboard.pimlico.io" target="_blank" rel="noopener noreferrer" style={{ color: "inherit", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: "6px" }}>
                                Pimlico
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ opacity: 0.5 }}>
                                    <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
                                    <polyline points="15 3 21 3 21 9" />
                                    <line x1="10" y1="14" x2="21" y2="3" />
                                </svg>
                            </a>
                        ) : "Self-funded"}
                        {wallet?.paymaster && <span className="vault-detail-badge">✓</span>}
                    </span>
                </div>
                <div className="vault-detail-row">
                    <span className="vault-detail-label">Bundler</span>
                    <span className="vault-detail-value">
                        {wallet?.bundler?.includes("pimlico") ? (
                            <a href="https://dashboard.pimlico.io" target="_blank" rel="noopener noreferrer" style={{ color: "inherit", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: "6px" }}>
                                Pimlico
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ opacity: 0.5 }}>
                                    <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
                                    <polyline points="15 3 21 3 21 9" />
                                    <line x1="10" y1="14" x2="21" y2="3" />
                                </svg>
                            </a>
                        ) : (
                            <AddressValue value={wallet?.bundler} />
                        )}
                    </span>
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
                            onClick={() => run(async () => { await deployFromFrontend(); })}
                        >
                            Deploy
                        </button>
                    </>
                )}
                {isLocal ? (
                    <button
                        className="vault-btn vault-btn--ghost vault-btn--sm"
                        disabled={pending}
                        onClick={() => run(async () => { await fundFromAnvil(); })}
                    >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M12 2v20M2 12h20" />
                        </svg>
                        Fund 10 ETH
                    </button>
                ) : (
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
                )}
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
