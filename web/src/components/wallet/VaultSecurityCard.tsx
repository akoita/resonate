"use client";

import { useAuth } from "../auth/AuthProvider";
import { useIsDeployed } from "../../hooks/useIsDeployed";

export default function VaultSecurityCard() {
    const { status, wallet, address } = useAuth();
    const isAuthenticated = status === "authenticated";
    const { isDeployed } = useIsDeployed(address);
    const hasPasskey = isAuthenticated; // ZeroDev passkey is the signer

    return (
        <div className="vault-card">
            <div className="vault-card-header">
                <span className="vault-card-title">
                    <svg className="vault-card-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                        <path d="M7 11V7a5 5 0 0110 0v4" />
                    </svg>
                    Security &amp; Recovery
                </span>
            </div>

            <div className="vault-security-grid">
                {/* Passkey Status */}
                <div className="vault-security-item">
                    <div className="vault-security-icon">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                        </svg>
                    </div>
                    <div className="vault-security-info">
                        <div className="vault-security-title">Passkey Signer</div>
                        <div className="vault-security-desc">
                            {hasPasskey
                                ? "Active — WebAuthn passkey controls your Smart Account"
                                : "Connect to activate your passkey"}
                        </div>
                    </div>
                    <span className={`vault-status-badge ${hasPasskey ? "vault-status-badge--active" : "vault-status-badge--locked"}`}>
                        <span className="vault-status-dot" />
                        {hasPasskey ? "Active" : "Off"}
                    </span>
                </div>

                {/* Smart Account Status */}
                <div className="vault-security-item">
                    <div className="vault-security-icon">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M12 2L2 7l10 5 10-5-10-5z" />
                            <path d="M2 17l10 5 10-5" />
                            <path d="M2 12l10 5 10-5" />
                        </svg>
                    </div>
                    <div className="vault-security-info">
                        <div className="vault-security-title">Kernel Account (ERC-4337)</div>
                        <div className="vault-security-desc">
                            {isDeployed
                                ? "Deployed on Sepolia — transactions via EntryPoint"
                                : "Not yet deployed on-chain"}
                        </div>
                    </div>
                    <span className={`vault-status-badge ${isDeployed ? "vault-status-badge--active" : "vault-status-badge--inactive"}`}>
                        <span className="vault-status-dot" />
                        {isDeployed ? "Live" : "Pending"}
                    </span>
                </div>

                {/* Gas Sponsorship */}
                <div className="vault-security-item">
                    <div className="vault-security-icon">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
                        </svg>
                    </div>
                    <div className="vault-security-info">
                        <div className="vault-security-title">Gas Sponsorship</div>
                        <div className="vault-security-desc">
                            {wallet?.paymaster
                                ? "Pimlico Paymaster — gas fees are sponsored"
                                : "Not configured — transactions require ETH for gas"}
                        </div>
                    </div>
                    <span className={`vault-status-badge ${wallet?.paymaster ? "vault-status-badge--active" : "vault-status-badge--inactive"}`}>
                        <span className="vault-status-dot" />
                        {wallet?.paymaster ? "Sponsored" : "Self-pay"}
                    </span>
                </div>
            </div>

            {/* Recovery Info */}
            <div className="vault-alert vault-alert--info" style={{ marginTop: "var(--space-4)" }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="16" x2="12" y2="12" />
                    <line x1="12" y1="8" x2="12.01" y2="8" />
                </svg>
                Account recovery is managed through your device passkey. For production, consider adding social recovery guardians via the ZeroDev recovery module.
            </div>
        </div>
    );
}
