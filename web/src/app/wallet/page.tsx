"use client";

import { useState, useEffect } from "react";
import { useAuth } from "../../components/auth/AuthProvider";
import VaultHero from "../../components/wallet/VaultHero";
import VaultSmartAccountCard from "../../components/wallet/VaultSmartAccountCard";
import VaultSecurityCard from "../../components/wallet/VaultSecurityCard";
import { useIsDeployed } from "../../hooks/useIsDeployed";

export default function WalletPage() {
  const { status, wallet, address, smartAccountAddress, refreshWallet } = useAuth();
  const saAddress = smartAccountAddress || address;
  const { isDeployed, recheck } = useIsDeployed(saAddress);
  const [mounted, setMounted] = useState(false);

  // Defer rendering until client mount to avoid SSR hydration mismatch.
  // Auth state (address, wallet, status) is only available on the client.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setMounted(true); }, []);

  if (!mounted) {
    return (
      <main className="vault-stage fade-in-up">
        <div className="vault-hero" style={{ minHeight: 200 }} />
      </main>
    );
  }

  return (
    <main className="vault-stage fade-in-up">
      {/* Hero Section with Balance */}
      <VaultHero
        wallet={wallet}
        status={status}
        address={saAddress}
        isDeployed={isDeployed}
        onRefresh={refreshWallet}
      />

      {/* Cards Grid — 2 column */}
      <div className="vault-grid vault-grid--2col">
        <VaultSmartAccountCard wallet={wallet} address={saAddress} isDeployed={isDeployed} recheck={recheck} />
        <VaultSecurityCard />
      </div>
    </main>
  );
}
