"use client";

import { useState } from "react";
import { deploySmartAccount, refreshWallet, setWalletProvider } from "../../lib/api";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { useAuth } from "./AuthProvider";

export default function SelfCustodyPanel() {
  const { address, token, role, wallet, refreshWallet: refreshCache } = useAuth();
  const [status, setStatus] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const isAdmin = role === "admin";

  const run = async (action: () => Promise<void>) => {
    if (!address || !token) {
      setStatus("Connect wallet to continue.");
      return;
    }
    try {
      setPending(true);
      setStatus(null);
      await action();
      await refreshCache();
      setStatus("Updated.");
    } catch (err) {
      setStatus((err as Error).message);
    } finally {
      setPending(false);
    }
  };

  return (
    <Card title="Self-custody actions">
      <div className="wallet-grid">
        <div>
          <div className="queue-meta">Current provider</div>
          <div>{wallet?.provider ?? "local"}</div>
        </div>
        <div>
          <div className="queue-meta">Account type</div>
          <div>{wallet?.accountType ?? "N/A"}</div>
        </div>
        <div>
          <div className="queue-meta">Deployment</div>
          <div>{wallet?.deploymentTxHash ? "Deployed" : "Not deployed"}</div>
        </div>
      </div>
      <div className="wallet-actions">
        <Button
          variant="ghost"
          disabled={!isAdmin || pending}
          onClick={() =>
            run(async () => {
              await refreshWallet(address!, token!);
            })
          }
        >
          Refresh provider
        </Button>
        <Button
          variant="ghost"
          disabled={!isAdmin || pending}
          onClick={() =>
            run(async () => {
              await setWalletProvider(address!, "erc4337", token!);
            })
          }
        >
          Switch to smart account
        </Button>
        <Button
          disabled={!isAdmin || pending}
          onClick={() =>
            run(async () => {
              await deploySmartAccount(address!, token!);
            })
          }
        >
          Deploy smart account
        </Button>
      </div>
      {!isAdmin ? (
        <div className="auth-error">Admin rights required for these actions.</div>
      ) : null}
      {status ? <div className="queue-meta">{status}</div> : null}
    </Card>
  );
}
