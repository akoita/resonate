"use client";

import { Button } from "../ui/Button";
import { useAuth } from "./AuthProvider";

export default function ConnectButton() {
  const { status, address, connect, connectPrivy, connectEmbedded, disconnect, error } =
    useAuth();
  const embeddedEnabled = process.env.NEXT_PUBLIC_EMBEDDED_WALLET === "true";
  const privyEnabled = Boolean(process.env.NEXT_PUBLIC_PRIVY_APP_ID);

  if (status === "authenticated" && address) {
    return (
      <div className="auth-actions">
        <div className="auth-badge">
          {address.slice(0, 6)}…{address.slice(-4)}
        </div>
        <Button variant="ghost" onClick={disconnect}>
          Disconnect
        </Button>
      </div>
    );
  }

  return (
    <div className="auth-actions auth-actions-vertical">
      <div className="auth-actions-title">Connect</div>
      <div className="auth-actions-buttons">
        <Button onClick={connect} disabled={status === "loading"}>
          {status === "loading" ? "Connecting..." : "Continue with wallet"}
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
