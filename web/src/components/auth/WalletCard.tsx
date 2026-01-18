"use client";

import { Card } from "../ui/Card";
import { useAuth } from "./AuthProvider";

export default function WalletCard() {
  const { wallet, address } = useAuth();

  if (!wallet || !address) {
    return (
      <Card title="Wallet">
        <div className="queue-meta">No wallet data yet.</div>
      </Card>
    );
  }

  return (
    <Card title="Wallet">
      <div className="wallet-grid">
        <div>
          <div className="queue-meta">Address</div>
          <div>{wallet.address}</div>
        </div>
        <div>
          <div className="queue-meta">Provider</div>
          <div>{wallet.provider ?? "local"}</div>
        </div>
        <div>
          <div className="queue-meta">Balance (USD)</div>
          <div>{wallet.balanceUsd.toFixed(2)}</div>
        </div>
        <div>
          <div className="queue-meta">Monthly cap</div>
          <div>{wallet.monthlyCapUsd.toFixed(2)}</div>
        </div>
        <div>
          <div className="queue-meta">Spent</div>
          <div>{wallet.spentUsd.toFixed(2)}</div>
        </div>
        <div>
          <div className="queue-meta">AA account</div>
          <div>{wallet.accountType ?? "N/A"}</div>
        </div>
      </div>
      <div className="wallet-meta">
        <div>
          <span className="queue-meta">Entry point</span>
          <div>{wallet.entryPoint ?? "N/A"}</div>
        </div>
        <div>
          <span className="queue-meta">Factory</span>
          <div>{wallet.factory ?? "N/A"}</div>
        </div>
        <div>
          <span className="queue-meta">Paymaster</span>
          <div>{wallet.paymaster ?? "N/A"}</div>
        </div>
        <div>
          <span className="queue-meta">Bundler</span>
          <div>{wallet.bundler ?? "N/A"}</div>
        </div>
      </div>
    </Card>
  );
}
