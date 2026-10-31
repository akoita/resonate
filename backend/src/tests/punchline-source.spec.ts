/**
 * Golden Moments source layers + per-layer clip bounds (#1476). Pure units.
 */
import { ConfigService } from "@nestjs/config";
import {
  PUNCHLINE_CLIP_MAX_MS,
  PUNCHLINE_CLIP_MIN_MS,
  PUNCHLINE_FULL_MIX_CLIP_MAX_MS,
  resolvePunchlineClipBounds,
  resolvePunchlineClipBoundsByLayer,
} from "../modules/punchline/punchline-clip.config";
import {
  PUNCHLINE_KNOWN_SOURCE_LAYERS,
  resolvePunchlineSourceLayers,
  sourceLayerForStemType,
  sourceLayerLabel,
  stemTypesForSourceLayer,
} from "../modules/punchline/punchline-source";

function config(values: Record<string, string>): ConfigService {
  return new ConfigService(values);
}

describe("punchline source layers", () => {
  it("allows every known layer, including the full mix, by default", () => {
    expect(resolvePunchlineSourceLayers()).toEqual([
      ...PUNCHLINE_KNOWN_SOURCE_LAYERS,
    ]);
    expect(resolvePunchlineSourceLayers()).toContain("full");
    expect(resolvePunchlineSourceLayers(config({}))).toContain("vocals");
  });

  it("narrows to the env allowlist and drops unknown names", () => {
    expect(
      resolvePunchlineSourceLayers(
        config({ PUNCHLINE_SOURCE_LAYERS: " Vocals, full ,laser" }),
      ),
    ).toEqual(["vocals", "full"]);
  });

  it("falls back to vocals alone when the allowlist keeps nothing", () => {
    expect(
      resolvePunchlineSourceLayers(config({ PUNCHLINE_SOURCE_LAYERS: "x,y" })),
    ).toEqual(["vocals"]);
  });

  it("maps the full mix to the stored original/master rows", () => {
    expect(stemTypesForSourceLayer("full")).toEqual(["original", "master"]);
    expect(stemTypesForSourceLayer("drums")).toEqual(["drums"]);
    expect(sourceLayerForStemType("original")).toBe("full");
    expect(sourceLayerForStemType("MASTER")).toBe("full");
    expect(sourceLayerForStemType("guitar")).toBe("guitar");
    expect(sourceLayerForStemType("unknown")).toBeNull();
  });

  it("names layers for reason messages", () => {
    expect(sourceLayerLabel("full")).toBe("full mix");
    expect(sourceLayerLabel("vocals")).toBe("vocals stem");
  });
});

describe("punchline clip bounds per layer", () => {
  it("keeps the stem bounds for stem layers", () => {
    expect(resolvePunchlineClipBounds(undefined, "vocals")).toEqual({
      minMs: PUNCHLINE_CLIP_MIN_MS,
      maxMs: PUNCHLINE_CLIP_MAX_MS,
    });
    expect(resolvePunchlineClipBounds()).toEqual({
      minMs: PUNCHLINE_CLIP_MIN_MS,
      maxMs: PUNCHLINE_CLIP_MAX_MS,
    });
  });

  it("gives the full mix a tighter max than a stem", () => {
    const full = resolvePunchlineClipBounds(undefined, "full");
    expect(full).toEqual({
      minMs: PUNCHLINE_CLIP_MIN_MS,
      maxMs: PUNCHLINE_FULL_MIX_CLIP_MAX_MS,
    });
    expect(full.maxMs).toBeLessThan(PUNCHLINE_CLIP_MAX_MS);
  });

  it("never lets the full-mix cap exceed the stem cap", () => {
    expect(
      resolvePunchlineClipBounds(
        config({
          PUNCHLINE_CLIP_MAX_MS: "8000",
          PUNCHLINE_FULL_MIX_CLIP_MAX_MS: "12000",
        }),
        "full",
      ).maxMs,
    ).toBe(8000);
  });

  it("ignores a full-mix cap at or below the min", () => {
    expect(
      resolvePunchlineClipBounds(
        config({ PUNCHLINE_FULL_MIX_CLIP_MAX_MS: "1000" }),
        "full",
      ).maxMs,
    ).toBe(PUNCHLINE_CLIP_MAX_MS);
  });

  it("returns bounds for each allowed layer", () => {
    const byLayer = resolvePunchlineClipBoundsByLayer(undefined, [
      "vocals",
      "full",
    ]);
    expect(byLayer.vocals.maxMs).toBe(PUNCHLINE_CLIP_MAX_MS);
    expect(byLayer.full.maxMs).toBe(PUNCHLINE_FULL_MIX_CLIP_MAX_MS);
  });
});
