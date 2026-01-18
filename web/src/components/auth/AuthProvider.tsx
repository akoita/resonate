"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { fetchNonce, fetchWallet, verifySignature, type WalletRecord } from "../../lib/api";
import { clearEmbeddedAccount, getOrCreateEmbeddedAccount } from "../../lib/embedded_wallet";

type AuthState = {
  status: "idle" | "loading" | "authenticated" | "error";
  address: string | null;
  token: string | null;
  role: string | null;
  wallet: WalletRecord | null;
  error?: string;
  connect: () => Promise<void>;
  connectEmbedded: () => Promise<void>;
  disconnect: () => void;
  refreshWallet: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

const TOKEN_KEY = "resonate.token";
const ADDRESS_KEY = "resonate.address";

type EthereumProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

function getEthereum(): EthereumProvider | undefined {
  return (globalThis as { ethereum?: EthereumProvider }).ethereum;
}

export default function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthState["status"]>("idle");
  const [address, setAddress] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [wallet, setWallet] = useState<WalletRecord | null>(null);
  const [error, setError] = useState<string | undefined>(undefined);
  const embeddedEnabled = process.env.NEXT_PUBLIC_EMBEDDED_WALLET === "true";

  const resolveRole = useCallback((jwt: string | null) => {
    if (!jwt) {
      return null;
    }
    try {
      const payload = jwt.split(".")[1];
      if (!payload) {
        return null;
      }
      const decoded = JSON.parse(atob(payload));
      return typeof decoded.role === "string" ? decoded.role : null;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    const storedToken = localStorage.getItem(TOKEN_KEY);
    const storedAddress = localStorage.getItem(ADDRESS_KEY);
    if (storedToken && storedAddress) {
      setToken(storedToken);
      setAddress(storedAddress);
      setRole(resolveRole(storedToken));
      setStatus("authenticated");
    }
  }, [resolveRole]);

  const refreshWallet = useCallback(async () => {
    if (!token || !address) {
      return;
    }
    try {
      const data = await fetchWallet(address, token);
      setWallet(data);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [address, token]);

  useEffect(() => {
    if (status === "authenticated") {
      refreshWallet();
    }
  }, [status, refreshWallet]);

  const connect = useCallback(async () => {
    setStatus("loading");
    setError(undefined);
    try {
      const ethereum = getEthereum();
      if (!ethereum) {
        throw new Error("Wallet extension not found.");
      }
      const accounts = (await ethereum.request({
        method: "eth_requestAccounts",
      })) as string[];
      const selected = accounts?.[0];
      if (!selected) {
        throw new Error("No account selected.");
      }
      const { nonce } = await fetchNonce(selected);
      const message = `Resonate Sign-In\nAddress: ${selected}\nNonce: ${nonce}\nIssued At: ${new Date().toISOString()}`;
      const signature = (await ethereum.request({
        method: "personal_sign",
        params: [message, selected],
      })) as `0x${string}`;
      const result = await verifySignature({
        address: selected,
        message,
        signature,
      });
      if (!("accessToken" in result)) {
        throw new Error(result.status);
      }
      localStorage.setItem(TOKEN_KEY, result.accessToken);
      localStorage.setItem(ADDRESS_KEY, selected.toLowerCase());
      setToken(result.accessToken);
      setAddress(selected.toLowerCase());
      setRole(resolveRole(result.accessToken));
      setStatus("authenticated");
    } catch (err) {
      setError((err as Error).message);
      setStatus("error");
    }
  }, []);

  const connectEmbedded = useCallback(async () => {
    setStatus("loading");
    setError(undefined);
    try {
      if (!embeddedEnabled) {
        throw new Error("Embedded wallet is not enabled.");
      }
      const account = getOrCreateEmbeddedAccount();
      const { nonce } = await fetchNonce(account.address);
      const message = `Resonate Sign-In\nAddress: ${account.address}\nNonce: ${nonce}\nIssued At: ${new Date().toISOString()}`;
      const signature = await account.signMessage({ message });
      const result = await verifySignature({
        address: account.address,
        message,
        signature,
      });
      if (!("accessToken" in result)) {
        throw new Error(result.status);
      }
      localStorage.setItem(TOKEN_KEY, result.accessToken);
      localStorage.setItem(ADDRESS_KEY, account.address.toLowerCase());
      setToken(result.accessToken);
      setAddress(account.address.toLowerCase());
      setRole(resolveRole(result.accessToken));
      setStatus("authenticated");
    } catch (err) {
      setError((err as Error).message);
      setStatus("error");
    }
  }, [embeddedEnabled, resolveRole]);

  const disconnect = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(ADDRESS_KEY);
    clearEmbeddedAccount();
    setToken(null);
    setAddress(null);
    setRole(null);
    setWallet(null);
    setStatus("idle");
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      status,
      address,
      token,
      role,
      wallet,
      error,
      connect,
      connectEmbedded,
      disconnect,
      refreshWallet,
    }),
    [
      status,
      address,
      token,
      role,
      wallet,
      error,
      connect,
      connectEmbedded,
      disconnect,
      refreshWallet,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used inside AuthProvider.");
  }
  return ctx;
}
