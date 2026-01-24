"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { fetchNonce, fetchWallet, verifySignature, type WalletRecord } from "../../lib/api";
import { clearEmbeddedAccount } from "../../lib/embedded_wallet";
import { useZeroDev } from "./ZeroDevProviderClient";
import {
  createKernelAccount,
  constants
} from "@zerodev/sdk";
import {
  signerToEcdsaValidator
} from "@zerodev/ecdsa-validator";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

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

export default function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthState["status"]>("idle");
  const [address, setAddress] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [wallet, setWallet] = useState<WalletRecord | null>(null);
  const [error, setError] = useState<string | undefined>(undefined);
  const { projectId, publicClient } = useZeroDev();

  const resolveRole = useCallback((jwt: string | null) => {
    if (!jwt) return null;
    try {
      const payload = jwt.split(".")[1];
      if (!payload) return null;
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
    if (!token || !address) return;
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

  const connectPrivy = useCallback(async () => {
    setStatus("loading");
    setError(undefined);
    try {
      // In development, if no Project ID, use a mock signer
      if (!projectId && process.env.NODE_ENV === "development") {
        console.warn("No ZeroDev Project ID, using mock signer");
        const privateKey = generatePrivateKey();
        const signer = privateKeyToAccount(privateKey);

        const entryPoint = constants.getEntryPoint("0.7");
        const kernelVersion = constants.KERNEL_V3_1;

        const ecdsaValidator = await signerToEcdsaValidator(publicClient, {
          signer,
          entryPoint,
          kernelVersion,
        });

        const account = await createKernelAccount(publicClient, {
          plugins: {
            sudo: ecdsaValidator,
          },
          entryPoint,
          kernelVersion,
        });

        const saAddress = account.address;
        const { nonce } = await fetchNonce(saAddress);
        const message = `Resonate Sign-In\nAddress: ${saAddress}\nNonce: ${nonce}\nIssued At: ${new Date().toISOString()}`;
        const signature = await account.signMessage({ message });

        const result = await verifySignature({
          address: saAddress,
          message,
          signature,
        });

        if (!("accessToken" in result)) {
          throw new Error(result.status);
        }

        localStorage.setItem(TOKEN_KEY, result.accessToken);
        localStorage.setItem(ADDRESS_KEY, saAddress.toLowerCase());
        setToken(result.accessToken);
        setAddress(saAddress.toLowerCase());
        setRole(resolveRole(result.accessToken));
        setStatus("authenticated");
        return;
      }

      if (!projectId) {
        throw new Error("ZeroDev Project ID is not configured.");
      }

      // Real login logic would go here
      console.log("Triggering ZeroDev Auth UI...");

    } catch (err) {
      console.error(err);
      setError((err as Error).message);
      setStatus("error");
    }
  }, [projectId, publicClient, resolveRole]);

  const connect = useCallback(async () => {
    await connectPrivy();
  }, [connectPrivy]);

  const connectEmbedded = useCallback(async () => {
    await connectPrivy();
  }, [connectPrivy]);

  const disconnect = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(ADDRESS_KEY);
    localStorage.removeItem(PRIVY_USER_KEY);
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
      connectPrivy,
      connectEmbedded,
      disconnect,
      refreshWallet,
    }),
    [status, address, token, role, wallet, error, connect, connectPrivy, connectEmbedded, disconnect, refreshWallet]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider.");
  return ctx;
}
