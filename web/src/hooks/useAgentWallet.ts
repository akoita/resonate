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
  const { status: authStatus, token, kernelAccount, login } = useAuth();
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
   * Enable agent wallet — agent-owned key flow:
   * 1. Backend generates the agent's keypair and returns the public address
   * 2. User signs the permission grant via passkey
   * 3. Frontend sends approval data to backend (NOT the private key)
   * 4. Refresh status
   */
  const enable = useCallback(
    async (config?: Partial<SessionKeyConfig>) => {
      if (!token) return;
      setIsEnabling(true);
      try {
        // Step 0: Reconnect Kernel account if lost (e.g. after page refresh)
        let account = kernelAccount;
        if (!account) {
          account = await login();
        }

        // Step 1: Enable wallet — backend generates agent keypair and returns the address
        const { agentAddress } = await enableAgentWallet(token);

        // Step 2: User signs session key grant tx
        // Pass the agent's address so the permission validator is built around it
        await grantSessionKey(
          { agentAddress, ...config },
          account,
        );

        // Step 3: Refresh status from backend
        await fetchStatus();
        return walletStatus;
      } finally {
        setIsEnabling(false);
      }
    },
    [token, kernelAccount, login, grantSessionKey, fetchStatus, walletStatus]
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
