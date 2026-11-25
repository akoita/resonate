"use client";

import { useSyncExternalStore } from "react";
import { useAuth } from "./AuthProvider";
import { AUTH_COPY } from "../../lib/authCopy";

/**
 * Shows its children to a signed-in person, and a sign-in prompt otherwise.
 * Wording comes from `authCopy` (#2663): sign-in is a passkey, not a wallet.
 */
export default function AuthGate({
  children,
  title = AUTH_COPY.gateDefault,
}: {
  children: React.ReactNode;
  title?: string;
}) {
  const { status, connectPrivy, error } = useAuth();
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  const icon = (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
      <polyline points="10 17 15 12 10 7" />
      <line x1="15" y1="12" x2="3" y2="12" />
    </svg>
  );

  // Before hydration completes, render a consistent loading state
  // to avoid server/client mismatch
  if (!mounted || status === "loading") {
    return (
      <div className="auth-panel">
        <div className="auth-title">{title}</div>
        <div className="wallet-connect">
          <div className="wallet-connect-label">{AUTH_COPY.gateLabel}</div>
          <button className="wallet-connect-btn" disabled>
            <span className="wallet-connect-btn-glow" />
            <span className="wallet-connect-btn-content">
              {icon}
              {AUTH_COPY.signingIn}
            </span>
          </button>
        </div>
      </div>
    );
  }

  if (status === "authenticated") {
    return <>{children}</>;
  }

  return (
    <div className="auth-panel">
      <div className="auth-title">{title}</div>
      <div className="wallet-connect">
        <div className="wallet-connect-label">{AUTH_COPY.gateLabel}</div>
        <button
          className="wallet-connect-btn"
          onClick={connectPrivy}
        >
          <span className="wallet-connect-btn-glow" />
          <span className="wallet-connect-btn-content">
            {icon}
            {AUTH_COPY.signIn}
          </span>
        </button>
        <p className="auth-new-here">{AUTH_COPY.gateNewHere}</p>
      </div>
      {status === "error" && error ? (
        <div className="wallet-error">{error}</div>
      ) : null}
    </div>
  );
}
