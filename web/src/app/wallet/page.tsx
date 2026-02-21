"use client";

import { useAuth } from "../../components/auth/AuthProvider";
import VaultHero from "../../components/wallet/VaultHero";
import VaultSmartAccountCard from "../../components/wallet/VaultSmartAccountCard";
import VaultSecurityCard from "../../components/wallet/VaultSecurityCard";

export default function WalletPage() {
  const { status, wallet, address, refreshWallet } = useAuth();

  return (
    <main className="vault-stage fade-in-up">
      {/* Hero Section with Balance */}
      <VaultHero
        wallet={wallet}
        status={status}
        address={address}
        onRefresh={refreshWallet}
      />

      {/* Cards Grid — 2 column */}
      <div className="vault-grid vault-grid--2col">
        <VaultSmartAccountCard wallet={wallet} address={address} />
        <VaultSecurityCard />
      </div>
    </main>
  );
}
