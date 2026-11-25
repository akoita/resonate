import { API_BASE } from "./api";

/**
 * Product surface switches (#2658), resolved by the backend at
 * `GET /config/surfaces`. The backend refuses a switched-off surface's routes;
 * the web app hides its entry points so nobody is offered an action that will
 * be refused.
 */
export const PRODUCT_SURFACE_NAMES = [
  "showsPledging",
  "paidCollects",
  "stemPurchases",
  "wallet",
  "agentPayments",
  "aiGeneration",
] as const;

export type ProductSurface = (typeof PRODUCT_SURFACE_NAMES)[number];
export type ProductSurfaceState = Record<ProductSurface, boolean>;

/** Every surface off: used until the switches load, and when they cannot. */
export const ALL_SURFACES_OFF: ProductSurfaceState = Object.freeze(
  Object.fromEntries(PRODUCT_SURFACE_NAMES.map((name) => [name, false])),
) as ProductSurfaceState;

/** Reads the endpoint body. Anything not literally `true` counts as off. */
export function parseProductSurfaces(body: unknown): ProductSurfaceState {
  const surfaces =
    body && typeof body === "object" && "surfaces" in body
      ? (body as { surfaces?: unknown }).surfaces
      : undefined;
  const record = surfaces && typeof surfaces === "object" ? (surfaces as Record<string, unknown>) : {};
  return Object.fromEntries(
    PRODUCT_SURFACE_NAMES.map((name) => [name, record[name] === true]),
  ) as ProductSurfaceState;
}

let cached: ProductSurfaceState | null = null;
let inFlight: Promise<ProductSurfaceState> | null = null;

export function getCachedProductSurfaces(): ProductSurfaceState | null {
  return cached;
}

/**
 * Fetches the switches once per page load. A failure is not cached, so the
 * next caller retries; until then every surface stays hidden.
 */
export function loadProductSurfaces(fetchImpl: typeof fetch = fetch): Promise<ProductSurfaceState> {
  if (cached) return Promise.resolve(cached);
  if (inFlight) return inFlight;
  inFlight = fetchImpl(`${API_BASE}/config/surfaces`)
    .then((res) => {
      if (!res.ok) throw new Error(`product surfaces: ${res.status}`);
      return res.json();
    })
    .then((body) => {
      cached = parseProductSurfaces(body);
      return cached;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/** Test seam. */
export function resetProductSurfacesCache(): void {
  cached = null;
  inFlight = null;
}

/** A typed refusal from a switched-off backend route. */
export function isSurfaceDisabledError(body: unknown): boolean {
  return Boolean(
    body && typeof body === "object" && (body as { code?: unknown }).code === "surface_disabled",
  );
}
