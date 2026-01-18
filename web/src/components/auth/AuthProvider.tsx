"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { fetchNonce, fetchWallet, verifySignature, type WalletRecord } from "../../lib/api";
import { clearEmbeddedAccount, getOrCreateEmbeddedAccount } from "../../lib/embedded_wallet";
import { usePrivyBridge } from "./PrivyBridge";

type AuthState = {
  status: "idle" | "loading" | "authenticated" | "error";
  address: string | null;
  token: string | null;
  role: string | null;
  wallet: WalletRecord | null;
  error?: string;
  connect: () => Promise<void>;
  connectPrivy: () => Promise<void>;
  connectEmbedded: () => Promise<void>;
  disconnect: () => void;
  refreshWallet: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

const TOKEN_KEY = "resonate.token";
const ADDRESS_KEY = "resonate.address";
const PRIVY_USER_KEY = "resonate.privy.userId";

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
  const privy = usePrivyBridge();
  const [privySyncing, setPrivySyncing] = useState(false);

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
  }, [privy]);

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

  const connectPrivy = useCallback(async () => {
    setStatus("loading");
    setError(undefined);
    try {
      if (!privy?.enabled) {
        throw new Error("Privy is not enabled.");
      }
      await privy.login();
      // Note: Don't check privy.authenticated here - it's stale closure state.
      // The effect below will handle resetting to idle if user cancels.
    } catch (err) {
      setError((err as Error).message);
      setStatus("error");
    }
  }, [privy]);

  // Reset status to idle when user cancels Privy login modal
  // This effect watches for when Privy is ready but user is not authenticated
  // while we're still in loading state (meaning login was initiated but not completed)
  // Also ensure we're not in the middle of a sync process
  useEffect(() => {
    if (
      status === "loading" &&
      privy?.enabled &&
      privy.ready &&
      !privy.authenticated &&
      !privySyncing &&
      !token
    ) {
      setStatus("idle");
    }
  }, [status, privy?.enabled, privy?.ready, privy?.authenticated, privySyncing, token]);

  // Track if we've attempted sync for the current privy session to prevent infinite retries
  const [syncAttempted, setSyncAttempted] = useState(false);

  // Reset syncAttempted when privy user changes
  useEffect(() => {
    setSyncAttempted(false);
  }, [privy?.userId]);

  useEffect(() => {
    if (!privy?.enabled || !privy.ready || !privy.authenticated || !privy.wallet) {
      return;
    }
    if (privySyncing || syncAttempted) {
      return;
    }
    if (address?.toLowerCase() === privy.wallet.address.toLowerCase() && token) {
      return;
    }
    // Capture references to avoid stale closures, but keep wallet as object to preserve method binding
    const wallet = privy.wallet;
    const walletAddress = wallet.address;
    const userId = privy.userId;

    const sync = async () => {
      setPrivySyncing(true);
      setSyncAttempted(true);
      try {
        const { nonce } = await fetchNonce(walletAddress);
        const message = `Resonate Sign-In\nAddress: ${walletAddress}\nNonce: ${nonce}\nIssued At: ${new Date().toISOString()}`;
        const signature = (await wallet.sign(message)) as `0x${string}`;
        const result = await verifySignature({
          address: walletAddress,
          message,
          signature,
        });
        if (!("accessToken" in result)) {
          throw new Error(result.status);
        }
        localStorage.setItem(TOKEN_KEY, result.accessToken);
        localStorage.setItem(ADDRESS_KEY, walletAddress.toLowerCase());
        if (userId) {
          localStorage.setItem(PRIVY_USER_KEY, userId);
        }
        setToken(result.accessToken);
        setAddress(walletAddress.toLowerCase());
        setRole(resolveRole(result.accessToken));
        setStatus("authenticated");
      } catch (err) {
        setError((err as Error).message);
        setStatus("error");
      } finally {
        setPrivySyncing(false);
      }
    };
    void sync();
  }, [
    address,
    privy?.enabled,
    privy?.ready,
    privy?.authenticated,
    privy?.wallet,
    privy?.userId,
    privySyncing,
    syncAttempted,
    resolveRole,
    token,
  ]);

  const disconnect = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(ADDRESS_KEY);
    localStorage.removeItem(PRIVY_USER_KEY);
    clearEmbeddedAccount();
    void privy?.logout?.();
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
      connectPrivy,
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
      connectPrivy,
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
