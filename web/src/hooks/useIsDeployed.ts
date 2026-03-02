"use client";

import { useState, useEffect, useCallback } from "react";

/** RPC URL for direct eth_getCode calls (bypasses Viem cache) */
const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || "http://localhost:8545";

/**
 * Check whether a smart account contract is deployed on-chain.
 * Uses a direct RPC call (bypassing Viem's request cache) to ensure
 * fresh results after deployment.
 */
export function useIsDeployed(address: string | null | undefined) {
  const [isDeployed, setIsDeployed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);

  /** Force a re-check of deployment status */
  const recheck = useCallback(() => {
    // Small delay to ensure the TX has been mined on Anvil
    setTimeout(() => setTick((t) => t + 1), 1500);
  }, []);

  useEffect(() => {
    if (!address) {
      setIsDeployed(false);
      return;
    }

    let cancelled = false;

    const check = async () => {
      setLoading(true);
      try {
        const resp = await fetch(RPC_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            method: "eth_getCode",
            params: [address, "latest"],
            id: Date.now(),
          }),
        });
        const json = await resp.json();
        const code = json?.result as string | undefined;
        const deployed = !!code && code !== "0x" && code !== "0x0";
        console.log(`[useIsDeployed] address=${address.slice(0, 10)}… code=${code?.slice(0, 20)}… deployed=${deployed}`);
        if (!cancelled) setIsDeployed(deployed);
      } catch (err) {
        console.error("[useIsDeployed] RPC error:", err);
        if (!cancelled) setIsDeployed(false);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    check();

    return () => { cancelled = true; };
  }, [address, tick]);

  return { isDeployed, loading, recheck };
}
