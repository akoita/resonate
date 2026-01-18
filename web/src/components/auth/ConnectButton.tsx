"use client";

import { Button } from "../ui/Button";
import { useAuth } from "./AuthProvider";

export default function ConnectButton() {
  const { status, address, connectPrivy, disconnect, error } = useAuth();
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
        {privyEnabled ? (
          <Button onClick={connectPrivy} disabled={status === "loading"}>
            {status === "loading" ? "Connecting..." : "Continue with wallet"}
          </Button>
        ) : null}
      </div>
      {status === "error" && error ? (
        <div className="auth-error">{error}</div>
      ) : null}
    </div>
  );
}
