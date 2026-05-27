"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { fetchNonce, fetchWallet, verifySignature, type WalletRecord } from "../../lib/api";
import { clearEmbeddedAccount } from "../../lib/embedded_wallet";
import { syncPlaylists } from "../../lib/playlistStore";
import { useZeroDev } from "./ZeroDevProviderClient";
import { getKernelAccountConfig } from "../../lib/accountAbstraction";
import { getNetworkLabel } from "../../lib/explorer";
import { markFundingAnnouncementSeen } from "../../lib/fundingAnnouncement";
import { getPasskeyRpId, getPasskeyServerUrl } from "../../lib/passkeyConfig";
import {
  ADDRESS_KEY,
  AUTH_INVALIDATED_EVENT,
  clearStoredAuthSession,
  SA_ADDRESS_KEY,
  TOKEN_KEY,
} from "../../lib/authSession";
import { recordProductAnalytics } from "../../lib/productAnalytics";
import type { WebAuthnMode } from "@zerodev/passkey-validator";
import { useToast } from "../ui/Toast";

type AuthState = {
  status: "idle" | "loading" | "authenticated" | "error";
  address: string | null;
  token: string | null;
  role: string | null;
  userId: string | null;
  wallet: WalletRecord | null;
  error?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  kernelAccount: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  webAuthnKey: any;
  /** All Smart Account addresses this user has ever authenticated with */
  knownAddresses: string[];
  /** The actual on-chain Smart Account address (may differ from auth address) */
  smartAccountAddress: string | null;
  connect: () => Promise<void>;
  // Returns the freshly-built kernel account and the webAuthnKey for callers
  // that need to operate on a different chain (e.g. x402 builds a parallel
  // Base Sepolia account from the same passkey). The return is null on error.
  login: () => Promise<{ account: unknown; webAuthnKey: unknown } | null>;
  signup: () => Promise<void>;
  connectPrivy: () => Promise<void>;
  connectEmbedded: () => Promise<void>;
  disconnect: () => void;
  refreshWallet: () => Promise<void>;
  signMessage: (message: string) => Promise<string>;
};

const AuthContext = createContext<AuthState | null>(null);

const KNOWN_ADDRESSES_KEY = "resonate.knownAddresses";
const ETH_ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;

/** Read the accumulated set of all Smart Account addresses this Passkey has ever used */
function getKnownAddresses(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const stored = localStorage.getItem(KNOWN_ADDRESSES_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch { return []; }
}

/** Add a new address to the accumulated set */
function addKnownAddress(addr: string) {
  const set = new Set(getKnownAddresses().map((a: string) => a.toLowerCase()));
  set.add(addr.toLowerCase());
  localStorage.setItem(KNOWN_ADDRESSES_KEY, JSON.stringify(Array.from(set)));
}

function getRecoverableSmartAccountAddress() {
  if (typeof window === "undefined") return null;

  const storedSmartAccount = localStorage.getItem(SA_ADDRESS_KEY);
  if (storedSmartAccount && ETH_ADDRESS_PATTERN.test(storedSmartAccount)) {
    return storedSmartAccount.toLowerCase();
  }

  const storedAuthAddress = localStorage.getItem(ADDRESS_KEY);
  if (storedAuthAddress && ETH_ADDRESS_PATTERN.test(storedAuthAddress)) {
    return storedAuthAddress.toLowerCase();
  }

  const knownAddresses = getKnownAddresses().filter((addr) => ETH_ADDRESS_PATTERN.test(addr));
  return knownAddresses.length === 1 ? knownAddresses[0].toLowerCase() : null;
}

function shortAddress(addr: string) {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

/** Decode role and userId from a JWT without validation */
function decodeAuthClaims(jwt: string | null) {
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
}

function isExistingPasskeyRegistrationError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("previously registered") ||
    message.includes("already registered with the relying party")
  );
}

function getErrorName(error: unknown) {
  return error instanceof Error ? error.name : "";
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function isRetryablePasskeyRegistrationError(error: unknown): boolean {
  const name = getErrorName(error);
  const message = getErrorMessage(error).toLowerCase();
  return (
    isExistingPasskeyRegistrationError(error) ||
    name === "NotAllowedError" ||
    message.includes("notallowederror") ||
    message.includes("timed out or was not allowed") ||
    message.includes("the operation either timed out or was not allowed")
  );
}

export function formatPasskeyAuthError(error: unknown): string {
  const name = getErrorName(error);
  const message = getErrorMessage(error);
  const normalized = `${name} ${message}`.toLowerCase();

  if (
    normalized.includes("notallowederror") ||
    normalized.includes("timed out or was not allowed")
  ) {
    return "Passkey access was blocked or timed out. If you already created a Resonate passkey, use Log In; otherwise try Sign Up again and approve the browser or system passkey prompt.";
  }

  return message;
}

export default function AuthProvider({ children }: { children: React.ReactNode }) {
  const { addToast } = useToast();
  // Memoized wrapper for use in dependency arrays
  const resolveAuth = useCallback((jwt: string | null) => decodeAuthClaims(jwt), []);

  const [status, setStatus] = useState<AuthState["status"]>("idle");
  const [address, setAddress] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [smartAccountAddress, setSmartAccountAddress] = useState<string | null>(null);
  const [knownAddresses, setKnownAddresses] = useState<string[]>([]);
  const [wallet, setWallet] = useState<WalletRecord | null>(null);
  const [error, setError] = useState<string | undefined>(undefined);
  const { projectId, publicClient, chainId } = useZeroDev();

  // Keep track of the active account in memory if possible (for mock mode especially)
  const [activeAccount, setActiveAccount] = useState<unknown>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [storedWebAuthnKey, setStoredWebAuthnKey] = useState<any>(null);

  const clearAuthState = useCallback((nextStatus: AuthState["status"] = "idle") => {
    setToken(null);
    setAddress(null);
    setSmartAccountAddress(null);
    setKnownAddresses([]);
    setRole(null);
    setUserId(null);
    setWallet(null);
    setStatus(nextStatus);
    setActiveAccount(null);
    setStoredWebAuthnKey(null);
  }, []);

  useEffect(() => {
    const storedToken = localStorage.getItem(TOKEN_KEY);
    const storedAddress = localStorage.getItem(ADDRESS_KEY);
    const storedSmartAccount = localStorage.getItem(SA_ADDRESS_KEY);

    setKnownAddresses(getKnownAddresses());

    if (!storedToken || !storedAddress) {
      clearAuthState("idle");
      return;
    }

    const { role: storedRole, userId: storedUserId } = resolveAuth(storedToken);
    setToken(storedToken);
    setAddress(storedAddress);
    setSmartAccountAddress(storedSmartAccount);
    setRole(storedRole);
    setUserId(storedUserId);
    setStatus("authenticated");
  }, [clearAuthState, resolveAuth]);

  useEffect(() => {
    const handleInvalidated = () => {
      clearEmbeddedAccount();
      clearAuthState("error");
      setError("Your session expired. Please reconnect.");
    };

    window.addEventListener(AUTH_INVALIDATED_EVENT, handleInvalidated);
    return () => {
      window.removeEventListener(AUTH_INVALIDATED_EVENT, handleInvalidated);
    };
  }, [clearAuthState]);

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
    const { createKernelAccount, constants } = sdk;
    const passkey = await import("@zerodev/passkey-validator");
    const { toPasskeyValidator, toWebAuthnKey, PasskeyValidatorContractVersion } = passkey;

    // Always use real passkeys (either self-hosted or ZeroDev)
    // This ensures local dev validates the same auth path as production.

    // Path 2 & 3: Real Passkeys (either self-hosted or ZeroDev)
    const { entryPoint, factoryAddress } = getKernelAccountConfig(chainId);
    const kernelVersion = constants.KERNEL_V3_1;

    const passkeyServerUrl = getPasskeyServerUrl(projectId);

    if (!projectId) {
      console.log("[Auth] Using self-hosted Passkey server (no ZeroDev Project ID)");
    }

    const buildAccount = async (webAuthnMode: WebAuthnMode) => {
      const webAuthnKey = await toWebAuthnKey({
        passkeyName: "Resonate",
        passkeyServerUrl,
        mode: webAuthnMode,
        rpID: getPasskeyRpId(),
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
        factoryAddress,
      });

      return { account, webAuthnKey };
    };

    let result;
    try {
      result = await buildAccount(mode);
    } catch (error) {
      if (mode === passkey.WebAuthnMode.Register && isRetryablePasskeyRegistrationError(error)) {
        console.warn("[Auth] Registration could not create a new passkey; retrying with the existing passkey.");
        result = await buildAccount(passkey.WebAuthnMode.Login);
      } else {
        throw error;
      }
    }

    if (
      mode === passkey.WebAuthnMode.Register &&
      (result.account as Record<string, unknown>).address === "0x0000000000000000000000000000000000000000"
    ) {
      console.warn("[Auth] Register-mode passkey derivation returned zero address; retrying with login-mode credential lookup.");
      result = await buildAccount(passkey.WebAuthnMode.Login);
    }

    setActiveAccount(result.account);
    return result;

  }, [projectId, publicClient, chainId, activeAccount]);


  const authenticate = useCallback(async (mode: WebAuthnMode) => {
    console.log("[Auth] Starting authentication...", { mode, chainId, projectId });
    setStatus("loading");
    setError(undefined);
    try {
      const connectResult = await getOrConnectAccount(mode);
      // getOrConnectAccount returns { account, webAuthnKey } for real passkeys, or just the account for mock
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const parsed = connectResult as Record<string, any>;
      const account = parsed.account ?? connectResult;
      const webAuthnKey = parsed.webAuthnKey;
      if (webAuthnKey) setStoredWebAuthnKey(webAuthnKey);
      const saAddress = (account as Record<string, unknown>).address as string;

      console.log("[Auth] SA Address:", saAddress);
      if (!saAddress || saAddress === "0x0000000000000000000000000000000000000000") {
        throw new Error("Calculated Smart Account address is zero.");
      }

      const recoverableAddress = getRecoverableSmartAccountAddress();
      if (recoverableAddress && saAddress.toLowerCase() !== recoverableAddress) {
        throw new Error(
          `That passkey opens ${shortAddress(saAddress)}, but this browser is trying to recover ${shortAddress(recoverableAddress)}. Choose the passkey for the saved account or clear the saved account before creating a new one.`,
        );
      }

      const { nonce } = await fetchNonce(saAddress);
      const message = `Resonate Sign-In\nAddress: ${saAddress}\nNonce: ${nonce}\nIssued At: ${new Date().toISOString()}`;

      // Sign
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const signature = await (account as Record<string, any>).signMessage({ message });

      // Send P-256 public key alongside signature so the backend can persist it
      // for future cross-device off-chain verification
      const result = await verifySignature({
        address: saAddress,
        message,
        signature,
        authMode: mode === "register" ? "register" : "login",
        chainId,
        pubKeyX: webAuthnKey?.pubX?.toString(16)?.padStart(64, "0"),
        pubKeyY: webAuthnKey?.pubY?.toString(16)?.padStart(64, "0"),
      });

      if (!("accessToken" in result)) {
        throw new Error(result.status);
      }

      const authAddress = result.address ?? saAddress;
      localStorage.setItem(TOKEN_KEY, result.accessToken);
      localStorage.setItem(ADDRESS_KEY, authAddress.toLowerCase());
      // Store the actual SA address (used for on-chain transactions) separately
      localStorage.setItem(SA_ADDRESS_KEY, saAddress.toLowerCase());

      const { role: r, userId: u } = resolveAuth(result.accessToken);
      setToken(result.accessToken);
      setAddress(authAddress.toLowerCase());
      setSmartAccountAddress(saAddress.toLowerCase());
      setRole(r);
      setUserId(u);
      setStatus("authenticated");

      // Accumulate the SA address (the on-chain identity) for marketplace filtering
      addKnownAddress(saAddress);
      setKnownAddresses(getKnownAddresses());

      void recordProductAnalytics(result.accessToken, "wallet.connected", {
        source: "auth",
        subjectType: "wallet",
        payload: {
          authMode: mode === "register" ? "register" : "login",
          chainId,
          hasSignupFaucet: Boolean(result.signupFaucet),
          walletProvider: "zerodev_passkey",
        },
      });

      if (result.signupFaucet?.status === "sent") {
        const { amountEth, chainId: fundedChainId } = result.signupFaucet;
        void recordProductAnalytics(result.accessToken, "wallet.faucet_requested", {
          source: "auth",
          subjectType: "wallet",
          payload: {
            surface: "signup_faucet",
            status: "sent",
            chainId: fundedChainId,
            amountEth,
          },
        });
        markFundingAnnouncementSeen(saAddress, fundedChainId);
        addToast({
          type: "success",
          visual: "funding",
          title: "Wallet funded for staging",
          message: `Happy news: your wallet was exceptionally funded with ${amountEth} ETH on ${getNetworkLabel(fundedChainId)} for this environment. This is test funding, not normal production onboarding.`,
          duration: 9000,
        });
      }

      // Return the account and webAuthnKey so callers can use them
      // immediately (React state updates won't flush until next render).
      return { account, webAuthnKey };

    } catch (err) {
      const message = formatPasskeyAuthError(err);
      console.warn("[Auth] Authentication failed:", message);
      setError(message);
      setStatus("error");
      return { account: null, webAuthnKey: null };
    }
  }, [getOrConnectAccount, chainId, projectId, resolveAuth, addToast]);

  const signMessage = useCallback(async (message: string) => {
    // Default to Login mode for signing (as we assume user is registered)
    const { WebAuthnMode } = await import("@zerodev/passkey-validator");
    const connectResult = await getOrConnectAccount(WebAuthnMode.Login);
    // getOrConnectAccount returns { account, webAuthnKey } for real passkeys, or just the account for mock
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parsed = connectResult as Record<string, any>;
    const account = parsed.account ?? connectResult;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (account as Record<string, any>).signMessage({ message });
  }, [getOrConnectAccount]);

  const login = useCallback(async () => {
    const { WebAuthnMode } = await import("@zerodev/passkey-validator");
    return authenticate(WebAuthnMode.Login);
  }, [authenticate]);

  const signup = useCallback(async () => {
    const { WebAuthnMode } = await import("@zerodev/passkey-validator");
    if (getRecoverableSmartAccountAddress()) {
      await authenticate(WebAuthnMode.Login);
      return;
    }
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
    clearStoredAuthSession();
    clearEmbeddedAccount();
    clearAuthState();
    setError(undefined);
  }, [clearAuthState]);

  const value = useMemo<AuthState>(
    () => ({
      status,
      address,
      token,
      role,
      userId,
      wallet,
      error,
      kernelAccount: activeAccount,
      webAuthnKey: storedWebAuthnKey,
      knownAddresses,
      smartAccountAddress,
      connect,
      login,
      signup,
      connectPrivy,
      connectEmbedded,
      disconnect,
      refreshWallet,
      signMessage,
    }),
    [status, address, token, role, userId, wallet, error, activeAccount, storedWebAuthnKey, knownAddresses, smartAccountAddress, connect, login, signup, connectPrivy, connectEmbedded, disconnect, refreshWallet, signMessage]
  );


  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider.");
  return ctx;
}
