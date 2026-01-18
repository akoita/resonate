"use client";

import { Button } from "../ui/Button";
import { useAuth } from "./AuthProvider";

export default function AuthGate({
  children,
  title = "Connect your wallet to continue.",
}: {
  children: React.ReactNode;
  title?: string;
}) {
  const { status, connectPrivy, error } = useAuth();
  const privyEnabled = Boolean(process.env.NEXT_PUBLIC_PRIVY_APP_ID);

  if (status === "authenticated") {
    return <>{children}</>;
  }

  return (
    <div className="auth-panel">
      <div className="auth-title">{title}</div>
      <div className="auth-actions auth-actions-vertical">
        <div className="auth-actions-title">Connect</div>
        <div className="auth-actions-buttons">
          {privyEnabled ? (
            <Button onClick={connectPrivy} disabled={status === "loading"}>
              {status === "loading" ? "Connecting..." : "Continue with wallet"}
            </Button>
          ) : null}
        </div>
      </div>
      {status === "error" && error ? (
        <div className="auth-error">{error}</div>
      ) : null}
    </div>
  );
}
