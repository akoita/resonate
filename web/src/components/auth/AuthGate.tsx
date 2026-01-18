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
  const { status, connect, error } = useAuth();

  if (status === "authenticated") {
    return <>{children}</>;
  }

  return (
    <div className="auth-panel">
      <div className="auth-title">{title}</div>
      <Button onClick={connect} disabled={status === "loading"}>
        {status === "loading" ? "Connecting..." : "Connect wallet"}
      </Button>
      {status === "error" && error ? (
        <div className="auth-error">{error}</div>
      ) : null}
    </div>
  );
}
