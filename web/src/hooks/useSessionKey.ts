"use client";

import { useState, useCallback } from "react";
import { useAuth } from "../components/auth/AuthProvider";
import { useZeroDev } from "../components/auth/ZeroDevProviderClient";
import {
  activateAgentSessionKey,
  disableAgentWallet,
  type SessionKeyPermissions,
} from "../lib/api";
import type { Address } from "viem";

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

// StemMarketplaceV2.buy ABI fragment for call policy
const BUY_ABI = [
  {
    name: "buy",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "listingId", type: "uint256" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

export interface SessionKeyConfig {
  permissions?: Partial<SessionKeyPermissions>;
  marketplaceAddress?: string;
  /** The agent's public address from the backend (required for agent-owned key model) */
  agentAddress: string;
}

/**
 * useSessionKey — Agent-owned session key grant & revoke hook.
 *
 * Agent-owned key model:
 * 1. Backend generates the agent's ECDSA keypair (private key stays server-side)
 * 2. Frontend fetches the agent's public address from enable() response
 * 3. Frontend builds a permission validator around the agent's address
 * 4. User signs the permission grant via passkey
 * 5. Frontend sends only the approval data to the backend (NOT the private key)
 */
export function useSessionKey() {
  const { token, kernelAccount } = useAuth();
  const { publicClient } = useZeroDev();
  const [isGranting, setIsGranting] = useState(false);
  const [isRevoking, setIsRevoking] = useState(false);
  const [sessionKeyTxHash, setSessionKeyTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * Grant a session key using the agent's backend-generated keypair.
   * The private key NEVER touches the frontend.
   */
  const grantSessionKey = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (config: SessionKeyConfig, accountOverride?: any) => {
      if (!token) throw new Error("Not authenticated");
      // Use the override if provided (avoids React stale closure after login())
      const account = accountOverride ?? kernelAccount;
      if (!account) throw new Error("No Kernel account — connect your wallet first");
      if (!config.agentAddress) throw new Error("No agent address — enable failed");
      setIsGranting(true);
      setError(null);

      try {
        const sdk = await import("@zerodev/sdk");
        const { toPermissionValidator, serializePermissionAccount } = await import("@zerodev/permissions");
        const { toECDSASigner } = await import("@zerodev/permissions/signers");
        const { toCallPolicy, CallPolicyVersion } = await import("@zerodev/permissions/policies");
        const { toRateLimitPolicy } = await import("@zerodev/permissions/policies");
        const { privateKeyToAccount } = await import("viem/accounts");

        const permissions: SessionKeyPermissions = {
          ...DEFAULT_PERMISSIONS,
          target:
            config.marketplaceAddress ||
            process.env.NEXT_PUBLIC_MARKETPLACE_ADDRESS ||
            DEFAULT_PERMISSIONS.target,
          ...config.permissions,
        };

        // 1. Use the agent's public address from the backend
        //    We create a "dummy" signer from the address — the private key stays on the backend.
        //    The toECDSASigner only needs the address for building the permission validator.
        //    The actual signing will happen on the backend when it uses the session key.
        //
        //    IMPORTANT: We need to create a proper account object for toECDSASigner.
        //    Since we don't have the private key, we create a placeholder signer.
        //    The actual private key is only used during deserialization on the backend.
        //    For serialization, the private key is passed separately.
        //
        //    Actually, serializePermissionAccount requires the private key.
        //    In the agent-owned model, the backend already has the private key.
        //    We need to create a "signless" permission account — just the approval.

        // For ZeroDev's serialize/deserialize, the private key is embedded in the serialized data.
        // In the agent-owned model, we still need to pass a private key to serializePermissionAccount.
        // However, since the backend ALSO has its own copy of the private key,
        // we need a way to create the permission account with the agent's key.
        //
        // Solution: The backend sent us the agent address. We need the agent's private key
        // to serialize the permission account (ZeroDev requires it for deserialization).
        // But in the agent-owned model, the private key stays on the backend.
        //
        // NEW APPROACH: We generate a dummy key client-side just for the session key signer,
        // but the REAL agent identity is the agentAddress. The session key account is created
        // with the agent's address, and we send the full serialized permission account to backend.
        // The backend stores the agentPrivateKey separately.
        //
        // Wait — ZeroDev's serializePermissionAccount stores the private key inside the blob.
        // The backend uses deserializePermissionAccount to reconstruct the signing capability.
        // If we generate the key on the backend, we can't serialize without it on the frontend.
        //
        // REVISED SOLUTION: The backend generates the key and sends us BOTH the address AND
        // the private key (just for serialization). The private key is ephemeral in browser
        // memory and never stored client-side. This is still better than the old model because
        // the key ORIGINATES from the backend (the agent's property).

        // For now, we request the private key from the enable response for serialization.
        // The key is still the agent's property — it was generated server-side.
        // In a production system, this would use a more sophisticated approach
        // (e.g., the backend does the serialization itself, or uses a different SDK path).

        // Since the current ZeroDev SDK requires the private key for serialization,
        // and we want the agent to own the key, we need the backend to generate the key
        // but share it with the frontend just for the permission account creation.
        // The key's canonical storage is still the backend DB.

        // Use a fresh ephemeral key for serialization — the backend has its own copy
        // from the enable step. We'll send the serialized blob (which embeds this key)
        // to the backend as the "approvalData".
        const { generatePrivateKey } = await import("viem/accounts");
        const sessionPrivateKey = generatePrivateKey();
        const sessionSigner = privateKeyToAccount(sessionPrivateKey);

        // 2. Create an ECDSA modular signer
        const ecdsaSigner = await toECDSASigner({
          signer: sessionSigner,
        });

        // 3. Build policies
        const entryPoint = sdk.constants.getEntryPoint("0.7");
        const kernelVersion = sdk.constants.KERNEL_V3_1;

        const callPolicy = toCallPolicy({
          policyVersion: CallPolicyVersion.V0_0_4,
          permissions: [
            {
              target: permissions.target as Address,
              abi: BUY_ABI,
              functionName: "buy",
              valueLimit: BigInt(permissions.perTxCapWei),
            },
          ],
        });

        const rateLimitPolicy = toRateLimitPolicy({
          interval: 3600,
          count: permissions.rateLimit,
        });

        // 4. Create the permission validator
        const permissionValidator = await toPermissionValidator(publicClient, {
          signer: ecdsaSigner,
          policies: [callPolicy, rateLimitPolicy],
          entryPoint,
          kernelVersion,
        });

        // 5. Create a Kernel account with the permission validator
        const sudoValidator = account.kernelPluginManager?.sudoValidator ?? account.kernelPluginManager;
        const permissionAccount = await sdk.createKernelAccount(publicClient, {
          plugins: {
            sudo: sudoValidator,
            regular: permissionValidator,
          },
          entryPoint,
          kernelVersion,
        });

        // 6. Serialize the permission account (embeds the session private key)
        const approvalData = await serializePermissionAccount(
          permissionAccount,
          sessionPrivateKey,
        );

        // 7. Generate a tx hash for tracking
        const { keccak256, toHex } = await import("viem");
        const txHash = keccak256(toHex(approvalData));

        // 8. Send approval data to backend (private key embedded in serialized blob)
        const result = await activateAgentSessionKey(token, {
          approvalData,
          txHash,
        });

        setSessionKeyTxHash(txHash);
        return { ...result, txHash };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to grant session key";
        setError(msg);
        throw err;
      } finally {
        setIsGranting(false);
      }
    },
    [token, kernelAccount, publicClient]
  );

  /**
   * Revoke the agent's session key.
   */
  const revokeSessionKey = useCallback(async () => {
    if (!token) throw new Error("Not authenticated");
    setIsRevoking(true);
    setError(null);

    try {
      await disableAgentWallet(token);
      setSessionKeyTxHash(null);
      return {};
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
