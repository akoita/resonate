"use client";

import { useEffect, useState } from "react";
import { API_BASE } from "../lib/api";

export type X402PublicConfig =
  | { enabled: false }
  | {
      enabled: true;
      network: string;
      chainId: number;
      facilitatorUrl: string;
      payoutAddress: string;
      asset: {
        assetId: string;
        address: string;
        symbol: string;
        name: string;
        version: string;
        decimals: number;
      };
    };

let cachedConfig: X402PublicConfig | null = null;
let inFlight: Promise<X402PublicConfig> | null = null;

async function fetchPublicConfig(): Promise<X402PublicConfig> {
  if (cachedConfig) return cachedConfig;
  if (inFlight) return inFlight;

  inFlight = fetch(`${API_BASE}/api/x402/public-config`)
    .then((res) => {
      if (!res.ok) {
        throw new Error(`x402 public-config: ${res.status}`);
      }
      return res.json() as Promise<X402PublicConfig>;
    })
    .then((cfg) => {
      cachedConfig = cfg;
      return cfg;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

export function useX402PublicConfig() {
  const [config, setConfig] = useState<X402PublicConfig | null>(cachedConfig);
  const [loading, setLoading] = useState(cachedConfig === null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (cachedConfig) return;
    let cancelled = false;
    fetchPublicConfig()
      .then((cfg) => {
        if (cancelled) return;
        setConfig(cfg);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err : new Error(String(err)));
        setConfig({ enabled: false });
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { config, loading, error };
}
