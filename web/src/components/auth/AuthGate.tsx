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
  const { status, connect, connectPrivy, connectEmbedded, error } = useAuth();
  const embeddedEnabled = process.env.NEXT_PUBLIC_EMBEDDED_WALLET === "true";
  const privyEnabled = Boolean(process.env.NEXT_PUBLIC_PRIVY_APP_ID);

  if (status === "authenticated") {
    return <>{children}</>;
  }

  return (
    <div className="auth-panel">
      <div className="auth-title">{title}</div>
      <div className="auth-actions">
        <Button onClick={connect} disabled={status === "loading"}>
          {status === "loading" ? "Connecting..." : "Connect wallet"}
        </Button>
        {privyEnabled ? (
          <Button variant="ghost" onClick={connectPrivy} disabled={status === "loading"}>
            Continue with email
          </Button>
        ) : null}
        {embeddedEnabled ? (
          <Button variant="ghost" onClick={connectEmbedded} disabled={status === "loading"}>
            Use embedded wallet
          </Button>
        ) : null}
      </div>
      {status === "error" && error ? (
        <div className="auth-error">{error}</div>
      ) : null}
    </div>
  );
}
