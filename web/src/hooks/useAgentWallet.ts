"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../components/auth/AuthProvider";
import { useSessionKey, type SessionKeyConfig } from "./useSessionKey";
import {
  enableAgentWallet,
  getAgentWalletStatus,
  getAgentTransactions,
  type AgentWalletStatus,
  type AgentTransaction,
} from "../lib/api";

export function useAgentWallet() {
  const { status: authStatus, token } = useAuth();
  const {
    grantSessionKey,
    revokeSessionKey,
    isGranting,
    isRevoking,
    sessionKeyTxHash,
    error: sessionKeyError,
  } = useSessionKey();

  const [walletStatus, setWalletStatus] = useState<AgentWalletStatus | null>(null);
  const [transactions, setTransactions] = useState<AgentTransaction[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isEnabling, setIsEnabling] = useState(false);
  const [isDisabling, setIsDisabling] = useState(false);

  const fetchStatus = useCallback(async () => {
    if (authStatus !== "authenticated" || !token) return;
    try {
      const result = await getAgentWalletStatus(token);
      setWalletStatus(result);
    } catch {
      setWalletStatus(null);
    } finally {
      setIsLoading(false);
    }
  }, [authStatus, token]);

  const fetchTransactions = useCallback(async () => {
    if (authStatus !== "authenticated" || !token) return;
    try {
      const result = await getAgentTransactions(token);
      setTransactions(result);
    } catch {
      setTransactions([]);
    }
  }, [authStatus, token]);

  useEffect(() => {
    fetchStatus();
    fetchTransactions();
  }, [fetchStatus, fetchTransactions]);

  /**
   * Enable agent wallet — self-custodial flow:
   * 1. Enable the ERC-4337 wallet on the backend
   * 2. Grant a session key (user signs tx)
   * 3. Refresh status
   */
  const enable = useCallback(
    async (config?: SessionKeyConfig) => {
      if (!token) return;
      setIsEnabling(true);
      try {
        // Step 1: Ensure ERC-4337 wallet is set up
        await enableAgentWallet(token);
        // Step 2: User signs session key grant tx
        await grantSessionKey(config);
        // Step 3: Refresh status from backend
        await fetchStatus();
        return walletStatus;
      } finally {
        setIsEnabling(false);
      }
    },
    [token, grantSessionKey, fetchStatus, walletStatus]
  );

  /**
   * Disable agent wallet — self-custodial flow:
   * 1. User signs revocation tx on-chain
   * 2. Backend marks session key as revoked
   * 3. Refresh status
   */
  const disable = useCallback(async () => {
    if (!token) return;
    setIsDisabling(true);
    try {
      await revokeSessionKey();
      await fetchStatus();
    } finally {
      setIsDisabling(false);
    }
  }, [token, revokeSessionKey, fetchStatus]);

  return {
    walletStatus,
    transactions,
    isLoading,
    isEnabling: isEnabling || isGranting,
    isDisabling: isDisabling || isRevoking,
    enable,
    disable,
    refetchStatus: fetchStatus,
    refetchTransactions: fetchTransactions,
    // Self-custodial session key state
    sessionKeyTxHash:
      sessionKeyTxHash || walletStatus?.sessionKeyTxHash || null,
    sessionKeyExplorerUrl: walletStatus?.sessionKeyExplorerUrl || null,
    sessionKeyPermissions: walletStatus?.sessionKeyPermissions || null,
    sessionKeyError,
  };
}
