"use client";

import { useState, useEffect } from "react";
import { useAuth } from "../../components/auth/AuthProvider";
import VaultHero from "../../components/wallet/VaultHero";
import VaultSmartAccountCard from "../../components/wallet/VaultSmartAccountCard";
import VaultSecurityCard from "../../components/wallet/VaultSecurityCard";
import MyStakesCard from "../../components/wallet/MyStakesCard";
import { useIsDeployed } from "../../hooks/useIsDeployed";
import { SurfaceGate } from "../../components/system/SurfaceGate";
import Link from "next/link";

export default function WalletPage() {
  return (
    <SurfaceGate surface="wallet" fallback={<WalletUnavailable />}>
      <WalletContent />
    </SurfaceGate>
  );
}

/** Shown when the deployment switches the wallet off (#2658). */
function WalletUnavailable() {
  return (
    <main className="vault-stage fade-in-up">
      <section className="vault-hero" role="status">
        <h1>The wallet is not available here</h1>
        <p>
          This version of Resonate does not offer payments, so there is nothing to fund or spend.
          Your account and your library work as usual.
        </p>
        <p>
          <Link href="/settings">Open settings</Link>
        </p>
      </section>
    </main>
  );
}

function WalletContent() {
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

      {/* Content Protection Stakes */}
      <MyStakesCard />
    </main>
  );
}
