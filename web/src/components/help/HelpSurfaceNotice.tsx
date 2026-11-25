"use client";

import { useProductSurfaces } from "../../hooks/useProductSurfaces";
import type { ProductSurface } from "../../lib/productSurfaces";

const SURFACE_LABELS: Record<ProductSurface, string> = {
  showsPledging: "pledging to Shows",
  paidCollects: "paid collectible editions",
  stemPurchases: "buying stems and licences",
  wallet: "the wallet",
  agentPayments: "agent payments",
  aiGeneration: "AI music generation",
};

/**
 * Tells the reader when a guide describes something this deployment does not
 * offer (#2658). Renders nothing until the switches load, or when all of the
 * guide's surfaces are on.
 */
export function HelpSurfaceNotice({ surfaces }: { surfaces: ProductSurface[] }) {
  const { surfaces: state, loaded } = useProductSurfaces();
  if (!loaded) return null;
  const off = surfaces.filter((surface) => !state[surface]);
  if (off.length === 0) return null;
  return (
    <p className="help-callout help-callout--warning" role="note">
      Not offered in this version of Resonate: {off.map((surface) => SURFACE_LABELS[surface]).join(", ")}.
      This guide describes how it works where it is available.
    </p>
  );
}
