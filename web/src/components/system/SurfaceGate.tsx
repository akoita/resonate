"use client";

import type { ReactNode } from "react";
import { useProductSurfaces } from "../../hooks/useProductSurfaces";
import type { ProductSurface } from "../../lib/productSurfaces";

/**
 * Renders its children only while a product surface is switched on (#2658).
 * `fallback` renders once the switches have loaded and the surface is off;
 * nothing renders while they load.
 */
export function SurfaceGate({
  surface,
  children,
  fallback = null,
}: {
  surface: ProductSurface;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const { surfaces, loaded } = useProductSurfaces();
  if (surfaces[surface]) return <>{children}</>;
  return loaded ? <>{fallback}</> : null;
}
