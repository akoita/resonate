"use client";

import { createContext, useContext, useMemo } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";

type PrivyWalletLike = {
  address: string;
  sign: (message: string) => Promise<string>;
};

type PrivyState = {
  enabled: boolean;
  ready: boolean;
  authenticated: boolean;
  userId: string | null;
  wallet: PrivyWalletLike | null;
  login: () => Promise<void>;
  logout: () => Promise<void>;
};

const PrivyStateContext = createContext<PrivyState | null>(null);

export default function PrivyBridge({ children }: { children: React.ReactNode }) {
  const { ready, authenticated, user, login, logout } = usePrivy();
  const { wallets } = useWallets();

  const wallet = (wallets?.[0] ?? null) as PrivyWalletLike | null;
  const value = useMemo<PrivyState>(
    () => ({
      enabled: true,
      ready,
      authenticated,
      userId: user?.id ?? null,
      wallet,
      login,
      logout,
    }),
    [ready, authenticated, user?.id, wallet, login, logout]
  );

  return (
    <PrivyStateContext.Provider value={value}>{children}</PrivyStateContext.Provider>
  );
}

export function usePrivyBridge() {
  return useContext(PrivyStateContext);
}
