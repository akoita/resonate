"use client";

import { useAuth } from "../../components/auth/AuthProvider";
import VaultHero from "../../components/wallet/VaultHero";
import VaultBalanceCard from "../../components/wallet/VaultBalanceCard";
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
        onRefresh={refreshWallet}
      />

      {/* Cards Grid */}
      <div className="vault-grid">
        <VaultBalanceCard wallet={wallet} />
        <VaultSmartAccountCard />
        <VaultSecurityCard />
      </div>
    </main>
  );
}
