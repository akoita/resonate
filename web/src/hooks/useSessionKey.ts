"use client";

import { useState, useCallback } from "react";
import { useAuth } from "../components/auth/AuthProvider";
import {
  registerAgentSessionKey,
  disableAgentWallet,
  type SessionKeyPermissions,
} from "../lib/api";

/**
 * Default session key policy stack for agent purchases.
 * All constraints are enforced on-chain by the smart account.
 */
const DEFAULT_PERMISSIONS: SessionKeyPermissions = {
  target: "", // Will be set to StemMarketplaceV2 address from env
  function: "buy(uint256,uint256)",
  totalCapWei: "50000000000000000000", // 50 ETH equivalent ($50 at $1=1ETH mock)
  perTxCapWei: "5000000000000000000",  // 5 ETH equivalent ($5 per tx)
  rateLimit: 10,                        // 10 tx per hour
};

const DEFAULT_VALIDITY_HOURS = 24;

export interface SessionKeyConfig {
  permissions?: Partial<SessionKeyPermissions>;
  validityHours?: number;
  marketplaceAddress?: string;
}

/**
 * useSessionKey — Self-custodial session key grant & revoke hook.
 *
 * The USER signs the grant/revoke tx from the frontend.
 * The backend never holds the root key — only a delegated session key.
 *
 * In a real ZeroDev integration, this hook would:
 * 1. Generate an ephemeral ECDSA keypair in-browser
 * 2. Build a ZeroDev permission object with 4 policies
 * 3. Send the permission tx to the kernel client for user signing
 * 4. Serialize the session key and send it to the backend
 *
 * For now, it uses a mock flow (generateMockSessionKey) until
 * the ZeroDev SDK frontend integration is wired in.
 */
export function useSessionKey() {
  const { token } = useAuth();
  const [isGranting, setIsGranting] = useState(false);
  const [isRevoking, setIsRevoking] = useState(false);
  const [sessionKeyTxHash, setSessionKeyTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * Grant a session key to the agent backend.
   * The user signs the session key registration tx on-chain.
   */
  const grantSessionKey = useCallback(
    async (config?: SessionKeyConfig) => {
      if (!token) throw new Error("Not authenticated");
      setIsGranting(true);
      setError(null);

      try {
        const permissions: SessionKeyPermissions = {
          ...DEFAULT_PERMISSIONS,
          target:
            config?.marketplaceAddress ||
            process.env.NEXT_PUBLIC_MARKETPLACE_ADDRESS ||
            DEFAULT_PERMISSIONS.target,
          ...config?.permissions,
        };

        const validityHours = config?.validityHours ?? DEFAULT_VALIDITY_HOURS;
        const validUntil = new Date(
          Date.now() + validityHours * 60 * 60 * 1000
        );

        // TODO: Replace with actual ZeroDev SDK integration:
        //   1. const sessionKeyAccount = await createSessionKeyAccount(kernelClient, permissions)
        //   2. const txHash = await kernelClient.sendTransaction(sessionKeyAccount.registerTx)
        //   3. const serializedKey = serializeSessionKeyAccount(sessionKeyAccount)
        // For now, generate a mock serialized key.
        const mockSerializedKey = generateMockSessionKey();
        const mockTxHash = `0x${Array.from({ length: 64 }, () =>
          Math.floor(Math.random() * 16).toString(16)
        ).join("")}`;

        // Register with backend
        const result = await registerAgentSessionKey(token, {
          serializedKey: mockSerializedKey,
          permissions,
          validUntil: validUntil.toISOString(),
          txHash: mockTxHash,
        });

        setSessionKeyTxHash(mockTxHash);
        return { ...result, txHash: mockTxHash };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to grant session key";
        setError(msg);
        throw err;
      } finally {
        setIsGranting(false);
      }
    },
    [token]
  );

  /**
   * Revoke the agent's session key.
   * The user signs the on-chain revocation tx, then notifies the backend.
   */
  const revokeSessionKey = useCallback(async () => {
    if (!token) throw new Error("Not authenticated");
    setIsRevoking(true);
    setError(null);

    try {
      // TODO: Replace with actual ZeroDev SDK integration:
      //   1. const revokeTx = await kernelClient.sendTransaction(revokeSessionKeyTx)
      //   2. const revokeTxHash = revokeTx.hash
      const mockRevokeTxHash = `0x${Array.from({ length: 64 }, () =>
        Math.floor(Math.random() * 16).toString(16)
      ).join("")}`;

      await disableAgentWallet(token, mockRevokeTxHash);
      setSessionKeyTxHash(null);
      return { txHash: mockRevokeTxHash };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to revoke session key";
      setError(msg);
      throw err;
    } finally {
      setIsRevoking(false);
    }
  }, [token]);

  return {
    grantSessionKey,
    revokeSessionKey,
    isGranting,
    isRevoking,
    sessionKeyTxHash,
    error,
  };
}

/**
 * Generate a mock serialized session key for development.
 * In production, this would be the output of serializeSessionKeyAccount().
 */
function generateMockSessionKey(): string {
  const mockData = {
    type: "zerodev-session-key-v1",
    privateKey: `0x${Array.from({ length: 64 }, () =>
      Math.floor(Math.random() * 16).toString(16)
    ).join("")}`,
    validatorAddress: "0xd9AB5096a832b9ce79914329DAEE236f8Eea0390",
    createdAt: Date.now(),
  };
  return btoa(JSON.stringify(mockData));
}
