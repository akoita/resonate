"use client";

import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import WalletCard from "../../components/auth/WalletCard";
import { useAuth } from "../../components/auth/AuthProvider";

export default function WalletPage() {
  const { status, refreshWallet } = useAuth();

  return (
    <main style={{ display: "grid", gap: "24px" }}>
      <Card title="Wallet Overview">
        <div className="wallet-header">
          <div>
            <div className="queue-meta">Status</div>
            <div>{status}</div>
          </div>
          <Button variant="ghost" onClick={refreshWallet}>
            Refresh
          </Button>
        </div>
      </Card>
      <WalletCard />
    </main>
  );
}
