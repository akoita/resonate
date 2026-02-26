"use client";

import { useState, useEffect } from "react";
import { useZeroDev } from "../components/auth/ZeroDevProviderClient";

/**
 * Check whether a smart account contract is deployed on-chain.
 * Uses `getCode` — if bytecode exists at the address, the account is deployed.
 * ZeroDev auto-deploys Kernel accounts with the first UserOperation,
 * so this is more reliable than checking `deploymentTxHash` in the DB.
 */
export function useIsDeployed(address: string | null | undefined) {
  const { publicClient } = useZeroDev();
  const [isDeployed, setIsDeployed] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!address || !publicClient) {
      setIsDeployed(false);
      return;
    }

    let cancelled = false;

    const check = async () => {
      setLoading(true);
      try {
        const code = await publicClient.getCode({
          address: address as `0x${string}`,
        });
        // getCode returns undefined or "0x" for EOAs / undeployed counterfactual accounts
        if (!cancelled) setIsDeployed(!!code && code !== "0x");
      } catch {
        if (!cancelled) setIsDeployed(false);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    check();

    return () => { cancelled = true; };
  }, [address, publicClient]);

  return { isDeployed, loading };
}
