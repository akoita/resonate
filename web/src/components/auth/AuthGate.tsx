"use client";

import { useAuth } from "./AuthProvider";

export default function AuthGate({
  children,
  title = "Connect your wallet to continue.",
}: {
  children: React.ReactNode;
  title?: string;
}) {
  const { status, connectPrivy, error } = useAuth();
  const privyEnabled = Boolean(process.env.NEXT_PUBLIC_PRIVY_APP_ID) || process.env.NEXT_PUBLIC_MOCK_AUTH === "true";

  if (status === "authenticated") {
    return <>{children}</>;
  }

  return (
    <div className="auth-panel">
      <div className="auth-title">{title}</div>
      <div className="wallet-connect">
        <div className="wallet-connect-label">Connect</div>
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
      </div>
      {status === "error" && error ? (
        <div className="wallet-error">{error}</div>
      ) : null}
    </div>
  );
}
