"use client";

import { useState } from "react";
import { useAuth } from "./AuthProvider";

export default function ConnectButton() {
  const { status, address, login, signup, disconnect, error } = useAuth();
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
      <div className="wallet-connect-label">Secure Access</div>
      <div className="wallet-connect-actions">
        <button
          className="wallet-connect-btn login"
          onClick={login}
          disabled={status === "loading"}
        >
          <span className="wallet-connect-btn-glow" />
          <span className="wallet-connect-btn-content">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
              <polyline points="10 17 15 12 10 7" />
              <line x1="15" y1="12" x2="3" y2="12" />
            </svg>
            {status === "loading" ? "..." : "Log In"}
          </span>
        </button>

        <button
          className="wallet-connect-btn signup"
          onClick={signup}
          disabled={status === "loading"}
        >
          <span className="wallet-connect-btn-glow" />
          <span className="wallet-connect-btn-content">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="8.5" cy="7" r="4" />
              <line x1="20" y1="8" x2="20" y2="14" />
              <line x1="23" y1="11" x2="17" y2="11" />
            </svg>
            {status === "loading" ? "..." : "Sign Up"}
          </span>
        </button>
      </div>

      {status === "error" && error ? (
        <div className="wallet-error">{error}</div>
      ) : null}
    </div>
  );
}
