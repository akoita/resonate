"use client";

import { useState, useEffect } from "react";
import { useZeroDev } from "../components/auth/ZeroDevProviderClient";
import { formatEther } from "viem";

/**
 * Live on-chain ETH balance for any address.
 * Uses the ZeroDev publicClient so it shares the same chain + transport.
 */
export function useOnChainBalance(address: string | null | undefined) {
  const { publicClient } = useZeroDev();
  const [balance, setBalance] = useState<bigint | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!address || !publicClient) {
      setBalance(null);
      return;
    }

    let cancelled = false;

    const fetch = async () => {
      setLoading(true);
      setError(null);
      try {
        const wei = await publicClient.getBalance({
          address: address as `0x${string}`,
        });
        if (!cancelled) setBalance(wei);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetch();

    // Refresh balance every 30 seconds
    const interval = setInterval(fetch, 30_000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [address, publicClient]);

  return {
    balance,
    balanceEth: balance != null ? formatEther(balance) : null,
    loading,
    error,
  };
}
