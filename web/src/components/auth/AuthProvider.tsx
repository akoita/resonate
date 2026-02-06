"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, useRef } from "react";
import { fetchNonce, fetchWallet, verifySignature, type WalletRecord } from "../../lib/api";
import { clearEmbeddedAccount } from "../../lib/embedded_wallet";
import { syncPlaylists } from "../../lib/playlistStore";
import { useZeroDev } from "./ZeroDevProviderClient";
import type { WebAuthnMode } from "@zerodev/passkey-validator";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

// Local AA contacts for Anvil (deployed by DeployLocalAA.s.sol)
const LOCAL_ENTRY_POINT = "0x5FbDB2315678afecb367f032d93F642f64180aa3" as const;
const LOCAL_KERNEL_FACTORY = "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9" as const;
const LOCAL_ECDSA_VALIDATOR = "0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9" as const;

/**
 * Get the correct EntryPoint based on chain ID
 * - Local (31337): Use locally deployed EntryPoint
 * - Other chains: Use canonical v0.7 EntryPoint
 */
async function getLocalEntryPoint(chainId: number) {
  const { constants } = await import("@zerodev/sdk");
  if (chainId === 31337) {
    return {
      address: LOCAL_ENTRY_POINT,
      version: "0.7" as const,
    };
  }
  return constants.getEntryPoint("0.7");
}

type AuthState = {
  status: "idle" | "loading" | "authenticated" | "error";
  address: string | null;
  token: string | null;
  role: string | null;
  userId: string | null;
  wallet: WalletRecord | null;
  error?: string;
  connect: () => Promise<void>;
  login: () => Promise<void>;
  signup: () => Promise<void>;
  connectPrivy: () => Promise<void>;
  connectEmbedded: () => Promise<void>;
  disconnect: () => void;
  refreshWallet: () => Promise<void>;
  signMessage: (message: string) => Promise<string>;
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
  const [userId, setUserId] = useState<string | null>(null);
  const [wallet, setWallet] = useState<WalletRecord | null>(null);
  const [error, setError] = useState<string | undefined>(undefined);
  const { projectId, publicClient, chainId } = useZeroDev();

  // Keep track of the active account in memory if possible (for mock mode especially)
  // In a real app with persistent mock keys, we'd store the private key in local storage.
  // For now, if we are in mock mode and refresh, signMessage will fail or generate a new address (which mismatches).
  // We'll address the happy path (Passkeys) primarily.
  const [activeAccount, setActiveAccount] = useState<unknown>(null);

  const resolveAuth = useCallback((jwt: string | null) => {
    if (!jwt) return { role: null, userId: null };
    try {
      const payload = jwt.split(".")[1];
      if (!payload) return { role: null, userId: null };
      const decoded = JSON.parse(atob(payload));
      return {
        role: typeof decoded.role === "string" ? decoded.role : null,
        userId: typeof decoded.sub === "string" ? decoded.sub : null,
      };
    } catch {
      return { role: null, userId: null };
    }
  }, []);

  useEffect(() => {
    const storedToken = localStorage.getItem(TOKEN_KEY);
    const storedAddress = localStorage.getItem(ADDRESS_KEY);
    if (storedToken && storedAddress) {
      const { role: r, userId: u } = resolveAuth(storedToken);
      setToken(storedToken);
      setAddress(storedAddress);
      setRole(r);
      setUserId(u);
      setStatus("authenticated");
    }
  }, [resolveAuth]);

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
      void syncPlaylists();
    }
  }, [status, refreshWallet]);



  const getOrConnectAccount = useCallback(async (mode: WebAuthnMode) => {
    // If we have an active account in memory, check if it matches the stored address
    // (Simple check: if we have one, use it. In mock mode this is vital.)
    if (activeAccount) return activeAccount;

    const sdk = await import("@zerodev/sdk");
    const ecdsa = await import("@zerodev/ecdsa-validator");
    const passkey = await import("@zerodev/passkey-validator");

    const { createKernelAccount, constants } = sdk;
    const { signerToEcdsaValidator } = ecdsa;
    const { toPasskeyValidator, toWebAuthnKey, PasskeyValidatorContractVersion } = passkey;

    if (process.env.NODE_ENV === "development" && (!projectId || chainId === 31337)) {
      console.warn("Local development or missing Project ID - using mock ECDSA signer (Kernel v3)");

      let privateKey = localStorage.getItem("mock_pk") as `0x${string}`;
      if (!privateKey) {
        privateKey = generatePrivateKey();
        localStorage.setItem("mock_pk", privateKey);
      }
      const signer = privateKeyToAccount(privateKey);


      // In Local Dev Mode, we MUST use the EOA (Signer) directly for Identity and Signing.
      // Why? Because Lit Protocol (running on public internet) CANNOT verify EIP-1271 signatures
      // from a Smart Account deployed on Localhost (unreachable).
      // By using the EOA, we return a standard ECDSA signature which Lit verifies off-chain (math).
      const mockAccount = {
        ...signer,
        address: signer.address,
        signMessage: async ({ message }: { message: string }) => {
          return signer.signMessage({ message });
        }
      };

      setActiveAccount(mockAccount);
      setAddress(mockAccount.address);
      setRole("user"); // Default role for dev
      setUserId("dev-user"); // Default ID
      setStatus("authenticated");
      localStorage.setItem("mock_address", mockAccount.address);
      localStorage.setItem(ADDRESS_KEY, mockAccount.address);

      return mockAccount;
    }

    if (!projectId) throw new Error("ZeroDev Project ID is not configured.");

    // Real Passkey
    const entryPoint = await getLocalEntryPoint(chainId);
    const kernelVersion = chainId === 31337 ? "0.3.3" : constants.KERNEL_V3_1;

    const webAuthnKey = await toWebAuthnKey({
      passkeyName: "Resonate",
      passkeyServerUrl: `/api/zerodev/${projectId}`,
      mode,
    });

    const passkeyValidator = await toPasskeyValidator(publicClient, {
      webAuthnKey,
      entryPoint,
      kernelVersion,
      validatorContractVersion: PasskeyValidatorContractVersion.V0_0_1_UNPATCHED,
    });

    const account = await createKernelAccount(publicClient, {
      plugins: { sudo: passkeyValidator },
      entryPoint,
      kernelVersion,
    });

    setActiveAccount(account);
    return account;

  }, [projectId, publicClient, chainId, activeAccount]);


  const authenticate = useCallback(async (mode: WebAuthnMode) => {
    console.log("[Auth] Starting authentication...", { mode, chainId, projectId });
    setStatus("loading");
    setError(undefined);
    try {
      const account = await getOrConnectAccount(mode);
      const saAddress = (account as Record<string, unknown>).address as string;

      console.log("[Auth] SA Address:", saAddress);
      if (!saAddress || saAddress === "0x0000000000000000000000000000000000000000") {
        throw new Error("Calculated Smart Account address is zero.");
      }

      const { nonce } = await fetchNonce(saAddress);
      const message = `Resonate Sign-In\nAddress: ${saAddress}\nNonce: ${nonce}\nIssued At: ${new Date().toISOString()}`;

      // Sign
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const signature = await (account as Record<string, any>).signMessage({ message });

      const result = await verifySignature({
        address: saAddress,
        message,
        signature,
      });

      if (!("accessToken" in result)) {
        throw new Error(result.status);
      }

      const authAddress = result.address ?? saAddress;
      localStorage.setItem(TOKEN_KEY, result.accessToken);
      localStorage.setItem(ADDRESS_KEY, authAddress.toLowerCase());

      const { role: r, userId: u } = resolveAuth(result.accessToken);
      setToken(result.accessToken);
      setAddress(authAddress.toLowerCase());
      setRole(r);
      setUserId(u);
      setStatus("authenticated");

    } catch (err) {
      console.error(err);
      setError((err as Error).message);
      setStatus("error");
    }
  }, [getOrConnectAccount, chainId, projectId, resolveAuth]);

  const signMessage = useCallback(async (message: string) => {
    // Default to Login mode for signing (as we assume user is registered)
    const { WebAuthnMode } = await import("@zerodev/passkey-validator");
    const account = await getOrConnectAccount(WebAuthnMode.Login);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (account as Record<string, any>).signMessage({ message });
  }, [getOrConnectAccount]);

  const login = useCallback(async () => {
    const { WebAuthnMode } = await import("@zerodev/passkey-validator");
    await authenticate(WebAuthnMode.Login);
  }, [authenticate]);

  const signup = useCallback(async () => {
    const { WebAuthnMode } = await import("@zerodev/passkey-validator");
    await authenticate(WebAuthnMode.Register);
  }, [authenticate]);

  const connectPrivy = useCallback(async () => {
    await login();
  }, [login]);

  const connect = useCallback(async () => {
    await login();
  }, [login]);

  const connectEmbedded = useCallback(async () => {
    await login();
  }, [login]);

  const disconnect = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(ADDRESS_KEY);
    localStorage.removeItem(PRIVY_USER_KEY);
    clearEmbeddedAccount();
    setToken(null);
    setAddress(null);
    setRole(null);
    setUserId(null);
    setWallet(null);
    setStatus("idle");
    setActiveAccount(null);
  }, []);

  // Auto-init mock account in dev mode to ensure address consistency
  const didInit = useRef(false);
  useEffect(() => {
    const isDev = !process.env.NEXT_PUBLIC_ZERODEV_PROJECT_ID;
    // Skip if already authenticated via localStorage (e.g., E2E mock auth)
    const hasStoredAuth = localStorage.getItem(TOKEN_KEY) && localStorage.getItem(ADDRESS_KEY);
    // Only run if dev mode, not yet initialized, no stored auth, and status is idle
    if (isDev && !didInit.current && !hasStoredAuth && status === "idle") {
      didInit.current = true;
      console.log("Dev mode detected, performing full login with mock account...");
      login().catch(e => {
        console.error("Mock login failed:", e);
        didInit.current = false; // Reset on failure so we can try again if needed
      });
    }
  }, [login, status]);

  const value = useMemo<AuthState>(
    () => ({
      status,
      address,
      token,
      role,
      userId,
      wallet,
      error,
      connect,
      login,
      signup,
      connectPrivy,
      connectEmbedded,
      disconnect,
      refreshWallet,
      signMessage,
    }),
    [status, address, token, role, userId, wallet, error, connect, login, signup, connectPrivy, connectEmbedded, disconnect, refreshWallet, signMessage]
  );


  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider.");
  return ctx;
}
