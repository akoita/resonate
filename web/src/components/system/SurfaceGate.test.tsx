import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SurfaceGate } from "./SurfaceGate";
import { loadProductSurfaces, resetProductSurfacesCache } from "../../lib/productSurfaces";

async function primeSurfaces(surfaces: Record<string, boolean>) {
  const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ surfaces }), { status: 200 }));
  await loadProductSurfaces(fetchImpl as unknown as typeof fetch);
}

function renderGate() {
  return renderToStaticMarkup(
    <SurfaceGate surface="showsPledging" fallback={<p>off</p>}>
      <button type="button">Pledge</button>
    </SurfaceGate>,
  );
}

describe("SurfaceGate (#2658)", () => {
  afterEach(() => resetProductSurfacesCache());

  it("renders the entry point when the surface is on", async () => {
    await primeSurfaces({ showsPledging: true });
    expect(renderGate()).toBe('<button type="button">Pledge</button>');
  });

  it("hides the entry point and shows the fallback when the surface is off", async () => {
    await primeSurfaces({ showsPledging: false });
    expect(renderGate()).toBe("<p>off</p>");
  });

  it("renders nothing before the switches load", () => {
    expect(renderGate()).toBe("");
  });
});
