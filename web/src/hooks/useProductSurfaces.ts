"use client";

import { useEffect, useState } from "react";
import {
  ALL_SURFACES_OFF,
  getCachedProductSurfaces,
  loadProductSurfaces,
  type ProductSurface,
  type ProductSurfaceState,
} from "../lib/productSurfaces";

/**
 * The product surface switches (#2658). Every surface reads as off until the
 * switches load, so a payment or generation entry point never flashes on a
 * deployment where it is switched off.
 */
export function useProductSurfaces(): { surfaces: ProductSurfaceState; loaded: boolean } {
  const [surfaces, setSurfaces] = useState<ProductSurfaceState | null>(getCachedProductSurfaces);

  useEffect(() => {
    if (surfaces) return;
    let cancelled = false;
    loadProductSurfaces()
      .then((state) => {
        if (!cancelled) setSurfaces(state);
      })
      .catch(() => {
        // Stay fail-closed; a later mount retries.
      });
    return () => {
      cancelled = true;
    };
  }, [surfaces]);

  return { surfaces: surfaces ?? ALL_SURFACES_OFF, loaded: surfaces !== null };
}

export function useSurfaceEnabled(surface: ProductSurface): boolean {
  return useProductSurfaces().surfaces[surface];
}
