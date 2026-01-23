"use client";

import { useState } from "react";
import { useAuth } from "./AuthProvider";

export default function ConnectButton() {
  const { status, address, connectPrivy, disconnect, error } = useAuth();
  const privyEnabled = Boolean(process.env.NEXT_PUBLIC_PRIVY_APP_ID) || process.env.NEXT_PUBLIC_MOCK_AUTH === "true";
  const [copied, setCopied] = useState(false);

  const copyAddress = () => {
    if (address) {
      navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (status === "authenticated" && address) {
    return (
      <div className="wallet-connected">
        <div className="wallet-connected-info">
          <div className="wallet-avatar">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2z" />
              <path d="M16 11.37a4 4 0 1 1-4.73-4.73 4 4 0 0 1 4.73 4.73z" />
            </svg>
          </div>
          <button className="wallet-address" onClick={copyAddress} title="Click to copy">
            <span className="wallet-address-text">
              {address.slice(0, 6)}…{address.slice(-4)}
            </span>
            <span className="wallet-copy-icon">
              {copied ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
              )}
            </span>
          </button>
        </div>
        <button className="wallet-disconnect" onClick={disconnect}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
        </button>
      </div>
    );
  }

  return (
    <div className="wallet-connect">
      <div className="wallet-connect-label">Connect</div>
      {privyEnabled ? (
        <button
          className="wallet-connect-btn"
          onClick={connectPrivy}
          disabled={status === "loading"}
        >
          <span className="wallet-connect-btn-glow" />
          <span className="wallet-connect-btn-content">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="2" y="6" width="20" height="12" rx="2" />
              <path d="M22 10H18a2 2 0 0 0 0 4h4" />
            </svg>
            {status === "loading" ? "Connecting..." : "Connect Wallet"}
          </span>
        </button>
      ) : null}
      {status === "error" && error ? (
        <div className="wallet-error">{error}</div>
      ) : null}
    </div>
  );
}
