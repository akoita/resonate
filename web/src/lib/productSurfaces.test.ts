import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ALL_SURFACES_OFF,
  PRODUCT_SURFACE_NAMES,
  isSurfaceDisabledError,
  loadProductSurfaces,
  parseProductSurfaces,
  resetProductSurfacesCache,
} from "./productSurfaces";

describe("product surfaces (#2658)", () => {
  afterEach(() => resetProductSurfacesCache());

  it("reads only literal true as on", () => {
    expect(
      parseProductSurfaces({ surfaces: { wallet: true, showsPledging: "true", aiGeneration: 1 } }),
    ).toEqual({ ...ALL_SURFACES_OFF, wallet: true });
  });

  it("treats a malformed body as everything off", () => {
    expect(parseProductSurfaces(null)).toEqual(ALL_SURFACES_OFF);
    expect(parseProductSurfaces({ surfaces: "x" })).toEqual(ALL_SURFACES_OFF);
    expect(Object.keys(ALL_SURFACES_OFF)).toEqual([...PRODUCT_SURFACE_NAMES]);
  });

  it("fetches once and caches a success", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ surfaces: { stemPurchases: true } }), { status: 200 }),
    );
    const first = await loadProductSurfaces(fetchImpl as unknown as typeof fetch);
    const second = await loadProductSurfaces(fetchImpl as unknown as typeof fetch);
    expect(first.stemPurchases).toBe(true);
    expect(second).toBe(first);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String((fetchImpl.mock.calls[0] as unknown[])[0])).toMatch(/\/config\/surfaces$/);
  });

  it("does not cache a failure", async () => {
    const failing = vi.fn(async () => new Response("nope", { status: 500 }));
    await expect(loadProductSurfaces(failing as unknown as typeof fetch)).rejects.toThrow();
    const ok = vi.fn(async () => new Response(JSON.stringify({ surfaces: { wallet: true } }), { status: 200 }));
    expect((await loadProductSurfaces(ok as unknown as typeof fetch)).wallet).toBe(true);
  });

  it("recognises the typed refusal", () => {
    expect(isSurfaceDisabledError({ code: "surface_disabled", surface: "wallet" })).toBe(true);
    expect(isSurfaceDisabledError({ code: "other" })).toBe(false);
  });
});
