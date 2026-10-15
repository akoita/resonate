"use client";

import { useEffect, useState } from "react";
import { API_BASE } from "../lib/api";
import type { StemTierPricing } from "../lib/listingTiers";

/**
 * Catalog per-tier prices for a stem, used to prefill listing prices.
 * Returns null while loading, without a stem id, or when the lookup fails —
 * manual pricing still works in every case.
 */
export function useStemTierPricing(stemId: string | null | undefined): StemTierPricing | null {
  const [pricing, setPricing] = useState<{ stemId: string; value: StemTierPricing } | null>(null);

  useEffect(() => {
    if (!stemId) return;
    let cancelled = false;
    fetch(`${API_BASE}/api/stem-pricing/${stemId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data) {
          setPricing({
            stemId,
            value: {
              remixLicenseUsd: data.remixLicenseUsd ?? null,
              commercialLicenseUsd: data.commercialLicenseUsd ?? null,
            },
          });
        }
      })
      .catch(() => {
        /* no prefill — manual pricing still works */
      });
    return () => {
      cancelled = true;
    };
  }, [stemId]);

  return stemId && pricing?.stemId === stemId ? pricing.value : null;
}
