"use client";

import { useState } from "react";
import { getEmbeddedPrivateKey } from "../../lib/embedded_wallet";

export default function VaultSecurityCard() {
    const [status, setStatus] = useState<string | null>(null);
    const embeddedEnabled = process.env.NEXT_PUBLIC_EMBEDDED_WALLET === "true";
    const privyEnabled = Boolean(process.env.NEXT_PUBLIC_PRIVY_APP_ID);

    const revealKey = async () => {
        const key = getEmbeddedPrivateKey();
        if (!key) {
            setStatus("No embedded key found.");
            return;
        }
        try {
            await navigator.clipboard.writeText(key);
            setStatus("✓ Embedded private key copied to clipboard.");
        } catch {
            setStatus("Copy failed. Please use a secure browser.");
        }
    };

    return (
        <div className="vault-card">
            <div className="vault-card-header">
                <span className="vault-card-title">
                    <svg className="vault-card-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                        <path d="M7 11V7a5 5 0 0110 0v4" />
                    </svg>
                    Security & Recovery
                </span>
            </div>

            <div className="vault-security-grid">
                {/* Embedded Wallet Status */}
                <div className="vault-security-item">
                    <div className="vault-security-icon">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.778 7.778 5.5 5.5 0 017.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
                        </svg>
                    </div>
                    <div className="vault-security-info">
                        <div className="vault-security-title">Embedded Wallet</div>
                        <div className="vault-security-desc">
                            {embeddedEnabled ? "Enabled (development only)" : "Disabled"}
                        </div>
                    </div>
                    <span className={`vault-status-badge ${embeddedEnabled ? "vault-status-badge--active" : "vault-status-badge--locked"}`}>
                        <span className="vault-status-dot" />
                        {embeddedEnabled ? "Active" : "Off"}
                    </span>
                </div>

                {/* Passkey/Email Recovery */}
                <div className="vault-security-item">
                    <div className="vault-security-icon">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                            <polyline points="22,6 12,13 2,6" />
                        </svg>
                    </div>
                    <div className="vault-security-info">
                        <div className="vault-security-title">Email / Passkey Recovery</div>
                        <div className="vault-security-desc">
                            {privyEnabled ? "Privy managed recovery" : "Not enabled"}
                        </div>
                    </div>
                    <span className={`vault-status-badge ${privyEnabled ? "vault-status-badge--active" : "vault-status-badge--inactive"}`}>
                        <span className="vault-status-dot" />
                        {privyEnabled ? "Privy" : "N/A"}
                    </span>
                </div>
            </div>

            {/* Actions */}
            {embeddedEnabled && (
                <div className="vault-actions">
                    <button className="vault-btn vault-btn--ghost" onClick={revealKey}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                            <circle cx="12" cy="12" r="3" />
                        </svg>
                        Reveal Embedded Key (Dev)
                    </button>
                </div>
            )}

            {/* Info Alert */}
            <div className="vault-alert vault-alert--info" style={{ marginTop: "var(--space-4)" }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="16" x2="12" y2="12" />
                    <line x1="12" y1="8" x2="12.01" y2="8" />
                </svg>
                Recovery is provider-managed. For production, use passkeys or social recovery flows.
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
