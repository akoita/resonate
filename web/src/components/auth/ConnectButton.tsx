"use client";

import { Button } from "../ui/Button";
import { useAuth } from "./AuthProvider";

export default function ConnectButton() {
  const { status, address, connect, disconnect, error } = useAuth();

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
    <div className="auth-actions">
      <Button onClick={connect} disabled={status === "loading"}>
        {status === "loading" ? "Connecting..." : "Connect wallet"}
      </Button>
      {status === "error" && error ? (
        <div className="auth-error">{error}</div>
      ) : null}
    </div>
  );
}
