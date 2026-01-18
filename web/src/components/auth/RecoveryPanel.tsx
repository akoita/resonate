"use client";

import { useState } from "react";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { getEmbeddedPrivateKey } from "../../lib/embedded_wallet";

export default function RecoveryPanel() {
  const [status, setStatus] = useState<string | null>(null);
  const embeddedEnabled = process.env.NEXT_PUBLIC_EMBEDDED_WALLET === "true";
  const privyEnabled = Boolean(process.env.NEXT_PUBLIC_PRIVY_APP_ID);

  const revealKey = async () => {
    const key = getEmbeddedPrivateKey();
    if (!key) {
      setStatus("No embedded key found.");
      return;
    }
    try {
      await navigator.clipboard.writeText(key);
      setStatus("Embedded private key copied to clipboard.");
    } catch {
      setStatus("Copy failed. Please use a secure browser.");
    }
  };

  return (
    <Card title="Recovery & export">
      <div className="wallet-grid">
        <div>
          <div className="queue-meta">Embedded wallet</div>
          <div>{embeddedEnabled ? "Enabled (dev only)" : "Disabled"}</div>
        </div>
        <div>
          <div className="queue-meta">Email/passkey recovery</div>
          <div>{privyEnabled ? "Privy managed" : "Not enabled"}</div>
        </div>
      </div>
      <div className="wallet-actions">
        {embeddedEnabled ? (
          <Button variant="ghost" onClick={revealKey}>
            Copy embedded key (dev)
          </Button>
        ) : null}
      </div>
      <div className="queue-meta">
        Recovery is provider‑managed. For production, use passkeys/social recovery and
        export flows provided by the embedded wallet SDK.
      </div>
      {status ? <div className="auth-error">{status}</div> : null}
    </Card>
  );
}
