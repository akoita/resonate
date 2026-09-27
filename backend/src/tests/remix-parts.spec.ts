/**
 * AI parts (#1901) — unit tests for the pure rules: style sanitization, the
 * versioned prompt template, request validation, the quote (canonical per-30 s
 * price per take, no new price), the song key, and the remix-parts/v1 recipe
 * (strict on PATCH, tolerant on read).
 */

import { GenerationCreditsService } from "../modules/credits/generation-credits.service";
import {
  buildPartPrompt,
  deriveSongKey,
  normalizePartGenerateRequest,
  normalizeRemixPartsInput,
  PART_CLIP_SECONDS,
  PARTS_NEED_TEMPO_ERROR,
  quotePartTakesCents,
  readStoredRemixParts,
  referencedTakeIds,
  REMIX_PART_PROMPT_VERSION,
  REMIX_PARTS_SCHEMA_VERSION,
  sanitizePartStyle,
  toPartTakeResponse,
} from "../modules/remix/remix-parts";

const BAR_GRID = { kind: "bars" as const, bpm: 120 };

function creditsWithPrice(price?: number) {
  return new GenerationCreditsService({
    get: (key: string, fallback?: unknown) =>
      key === "GENERATION_PRICE_CENTS_PER_30S" && price !== undefined
        ? price
        : fallback,
  } as never);
}

describe("AI parts (#1901)", () => {
  describe("style sanitization", () => {
    it("trims, collapses whitespace and strips control/format characters", () => {
      expect(sanitizePartStyle("  warm\t\tlo-fi \n  tape   ")).toBe("warm lo-fi tape");
      expect(sanitizePartStyle("dusty\u0000\u0007 keys")).toBe("dusty keys");
      // Bidi override, zero-width space and line separator.
      expect(sanitizePartStyle("a‮b​c d")).toBe("a b c d");
    });

    it("caps at 80 characters without splitting a code point", () => {
      expect(sanitizePartStyle("x".repeat(200))).toBe("x".repeat(80));
      const emoji = "\u{1F3B8}".repeat(100);
      const capped = sanitizePartStyle(emoji)!;
      expect(Array.from(capped)).toHaveLength(80);
      expect(capped).toBe("\u{1F3B8}".repeat(80));
    });

    it("maps empty or non-string input to null", () => {
      expect(sanitizePartStyle("   \n\t ")).toBeNull();
      expect(sanitizePartStyle(undefined)).toBeNull();
      expect(sanitizePartStyle(null)).toBeNull();
      expect(sanitizePartStyle(42)).toBeNull();
    });
  });

  describe("prompt template remix-part-prompt/v1", () => {
    it("builds a drums prompt without a key", () => {
      expect(
        buildPartPrompt({
          role: "drums",
          style: null,
          bpm: 121.6,
          key: { tonic: "A", mode: "minor", confidence: 0.4 },
        }),
      ).toEqual({
        promptVersion: REMIX_PART_PROMPT_VERSION,
        prompt:
          "tight drum groove, solo drums, isolated instrument, 122 BPM, loopable, instrumental, no vocals",
        negativePrompt: "bass, melody, chords, vocals, full mix",
      });
    });

    it("builds a pitched prompt with sanitized style words and the key", () => {
      expect(
        buildPartPrompt({
          role: "bass",
          style: "  funky\u0000   slap ",
          bpm: 98,
          key: { tonic: "Db", mode: "major", confidence: 0.2 },
        }),
      ).toEqual({
        promptVersion: REMIX_PART_PROMPT_VERSION,
        prompt:
          "deep groovy bass line, solo bass, isolated instrument, funky slap, 98 BPM, C# major, loopable, instrumental, no vocals",
        negativePrompt: "drums, percussion, vocals, full mix, other instruments",
      });
    });

    it("omits an unknown key", () => {
      const { prompt } = buildPartPrompt({ role: "pad", style: "airy", bpm: 90, key: null });
      expect(prompt).toBe(
        "warm evolving synth pad, solo pad, isolated instrument, airy, 90 BPM, loopable, instrumental, no vocals",
      );
    });
  });

  describe("generate request validation", () => {
    it("defaults to 3 takes and sanitizes style", () => {
      expect(
        normalizePartGenerateRequest({ role: "keys", bars: 4, style: "  bright  " }),
      ).toEqual({ value: { role: "keys", bars: 4, style: "bright", takes: 3 } });
      expect(
        normalizePartGenerateRequest({ role: "strings", bars: 8, takes: 1, style: null }),
      ).toEqual({ value: { role: "strings", bars: 8, style: null, takes: 1 } });
    });

    it.each([
      [{ role: "vocals", bars: 4 }, "role must be one of"],
      [{ role: "keys", bars: 16 }, "bars must be one of"],
      [{ role: "keys", bars: "4" }, "bars must be one of"],
      [{ role: "keys", bars: 4, takes: 0 }, "takes must be an integer between 1 and 4"],
      [{ role: "keys", bars: 4, takes: 5 }, "takes must be an integer between 1 and 4"],
      [{ role: "keys", bars: 4, takes: 2.5 }, "takes must be an integer between 1 and 4"],
      [{ role: "keys", bars: 4, style: 7 }, "style must be a string or null"],
      [{ role: "keys", bars: 4, style: "x".repeat(201) }, "style must be at most 200"],
      [null, "must be an object"],
    ])("rejects %j", (body, message) => {
      const result = normalizePartGenerateRequest(body);
      expect("error" in result && result.error).toContain(message);
    });
  });

  describe("quote", () => {
    it("charges the canonical per-30 s price per take (no new price)", () => {
      const credits = creditsWithPrice();
      const perTake = credits.costForDurationCents(PART_CLIP_SECONDS);
      // Default GENERATION_PRICE_CENTS_PER_30S = 10¢; ceil(30 / 30) = 1 block.
      expect(perTake).toBe(10);
      expect(quotePartTakesCents(3, perTake)).toBe(30);
      expect(quotePartTakesCents(1, perTake)).toBe(10);
      expect(quotePartTakesCents(4, perTake)).toBe(40);
    });

    it("follows a configured price", () => {
      const perTake = creditsWithPrice(7).costForDurationCents(PART_CLIP_SECONDS);
      expect(perTake).toBe(7);
      expect(quotePartTakesCents(3, perTake)).toBe(21);
    });

    it("rejects non-integer inputs", () => {
      expect(() => quotePartTakesCents(1.5, 10)).toThrow(RangeError);
      expect(() => quotePartTakesCents(2, -1)).toThrow(RangeError);
    });
  });

  describe("song key", () => {
    const features = (key: unknown) => ({
      audioFeatures: { schemaVersion: "stem-audio-features/v1", key },
    });

    it("picks the highest-confidence valid key and normalizes the tonic", () => {
      expect(
        deriveSongKey([
          features({ tonic: "C", mode: "major", confidence: 0.1 }),
          features({ tonic: "Bb", mode: "minor", confidence: 0.4 }),
          features({ tonic: "H", mode: "major", confidence: 0.9 }),
          features({ tonic: "D", mode: "dorian", confidence: 0.95 }),
          { audioFeatures: { schemaVersion: "other", key: { tonic: "E", mode: "major", confidence: 1 } } },
        ]),
      ).toEqual({ tonic: "A#", mode: "minor", confidence: 0.4 });
    });

    it("keeps a key without confidence as a last resort (confidence null)", () => {
      expect(deriveSongKey([features({ tonic: "G", mode: "major" })])).toEqual({
        tonic: "G",
        mode: "major",
        confidence: null,
      });
      expect(deriveSongKey([{ audioFeatures: null }])).toBeNull();
    });
  });

  describe("remix-parts/v1 recipe", () => {
    const part = (overrides: Record<string, unknown> = {}) => ({
      id: "bass-1",
      role: "bass",
      takeId: "take_1",
      ...overrides,
    });

    it("normalizes a valid recipe", () => {
      expect(
        normalizeRemixPartsInput(
          {
            schemaVersion: REMIX_PARTS_SCHEMA_VERSION,
            parts: [
              part({ gainDb: -3.456, muted: false, blocks: [true, false, true] }),
              part({ id: "keys", role: "keys", takeId: "take_2", gainDb: 0, muted: true, blocks: [true, true, true] }),
            ],
          },
          3,
          BAR_GRID,
        ),
      ).toEqual({
        value: {
          schemaVersion: REMIX_PARTS_SCHEMA_VERSION,
          parts: [
            { id: "bass-1", role: "bass", takeId: "take_1", gainDb: -3.46, blocks: [true, false, true] },
            { id: "keys", role: "keys", takeId: "take_2", muted: true },
          ],
        },
      });
    });

    it("clears on null and on an empty list", () => {
      expect(normalizeRemixPartsInput(null, 3, BAR_GRID)).toEqual({ value: null });
      expect(normalizeRemixPartsInput({ parts: [] }, 3, BAR_GRID)).toEqual({ value: null });
    });

    it.each([
      ["not an object", [], "parts must be an object or null"],
      ["unknown key", { parts: [], extra: 1 }, "parts.extra is not supported"],
      ["foreign version", { schemaVersion: "remix-parts/v2", parts: [] }, "schemaVersion"],
      ["parts not an array", { parts: {} }, "parts.parts must be an array"],
      ["more than 4 parts", { parts: [1, 2, 3, 4, 5].map((i) => part({ id: `p${i}` })) }, "At most 4"],
      ["bad id", { parts: [part({ id: "Bass_1" })] }, "id must match"],
      ["long id", { parts: [part({ id: "a".repeat(33) })] }, "id must match"],
      ["duplicate id", { parts: [part(), part()] }, "used twice"],
      ["bad role", { parts: [part({ role: "vocals" })] }, "role must be one of"],
      ["missing take", { parts: [part({ takeId: "" })] }, "takeId must be a take id"],
      ["gain too high", { parts: [part({ gainDb: 7 })] }, "gainDb must be a number between -24 and 6"],
      ["muted not boolean", { parts: [part({ muted: "yes" })] }, "muted must be a boolean"],
      ["blocks length", { parts: [part({ blocks: [true, false] })] }, "exactly 3 entries"],
      ["blocks type", { parts: [part({ blocks: [1, 0, 1] })] }, "array of booleans"],
      ["unknown part key", { parts: [part({ volume: 1 })] }, "parts[0].volume is not supported"],
    ])("rejects %s", (_label, value, message) => {
      const result = normalizeRemixPartsInput(value, 3, BAR_GRID);
      expect("error" in result && result.error).toContain(message);
    });

    it("needs a bar grid with a tempo (like the beat)", () => {
      expect(normalizeRemixPartsInput({ parts: [part()] }, 3, null)).toEqual({
        error: PARTS_NEED_TEMPO_ERROR,
      });
      expect(
        normalizeRemixPartsInput({ parts: [part()] }, 3, { kind: "time", bpm: null }),
      ).toEqual({ error: PARTS_NEED_TEMPO_ERROR });
      // Clearing never needs a grid.
      expect(normalizeRemixPartsInput(null, 0, null)).toEqual({ value: null });
    });

    it("reads tolerantly: drops invalid parts, parts without a completed take of their role, stale blocks", () => {
      const takes = [
        { id: "take_1", role: "bass", status: "completed" },
        { id: "take_2", role: "keys", status: "completed" },
        { id: "take_3", role: "pad", status: "processing" },
      ];
      const stored = {
        schemaVersion: REMIX_PARTS_SCHEMA_VERSION,
        parts: [
          part({ blocks: [true, false] }), // stale length → on everywhere
          part({ id: "wrong-role", role: "drums", takeId: "take_2" }),
          part({ id: "pending", role: "pad", takeId: "take_3" }),
          part({ id: "gone", takeId: "take_404" }),
          part({ id: "BAD" }),
          part(), // duplicate id
          part({ id: "keys", role: "keys", takeId: "take_2", blocks: [false, true, true] }),
        ],
      };
      expect(readStoredRemixParts(stored, 3, takes)).toEqual({
        schemaVersion: REMIX_PARTS_SCHEMA_VERSION,
        parts: [
          { id: "bass-1", role: "bass", takeId: "take_1" },
          { id: "keys", role: "keys", takeId: "take_2", blocks: [false, true, true] },
        ],
      });
      // No block count: blocks kept as recorded.
      expect(
        readStoredRemixParts({ schemaVersion: REMIX_PARTS_SCHEMA_VERSION, parts: [part({ blocks: [true, false] })] }, null),
      ).toEqual({
        schemaVersion: REMIX_PARTS_SCHEMA_VERSION,
        parts: [part({ blocks: [true, false] })],
      });
    });

    it("reads foreign or empty rows as null", () => {
      expect(readStoredRemixParts(null, 3)).toBeNull();
      expect(readStoredRemixParts({ schemaVersion: "remix-parts/v0", parts: [part()] }, 3)).toBeNull();
      expect(readStoredRemixParts({ schemaVersion: REMIX_PARTS_SCHEMA_VERSION, parts: [] }, 3)).toBeNull();
      expect(
        readStoredRemixParts({ schemaVersion: REMIX_PARTS_SCHEMA_VERSION, parts: [part()] }, 3, []),
      ).toBeNull();
    });

    it("collects every referenced take id, even from malformed parts", () => {
      expect(
        Array.from(
          referencedTakeIds({
            schemaVersion: "anything",
            parts: [part(), { takeId: "take_x", role: "nope" }, { id: "no-take" }, "junk"],
          }),
        ),
      ).toEqual(["take_1", "take_x"]);
      expect(referencedTakeIds(null).size).toBe(0);
    });
  });

  describe("take read shape", () => {
    it("never exposes the storage URI and labels the take AI", () => {
      const response = toPartTakeResponse({
        id: "take_1",
        batchId: "batch",
        role: "bass",
        bars: 4,
        style: "funky",
        seed: 42,
        status: "completed",
        promptVersion: REMIX_PART_PROMPT_VERSION,
        provider: "remix-stub",
        model: "remix-stub-part/v1",
        grounding: "feature_conditioned",
        costCents: 10,
        storageUri: "gs://bucket/secret-path.flac",
        mimeType: "audio/flac",
        durationSec: 8,
        conform: { conformVersion: "remix-part-conform/v1" },
        errorCode: null,
        createdAt: new Date(0),
        startedAt: null,
        completedAt: null,
      });
      expect(response).not.toHaveProperty("storageUri");
      expect(JSON.stringify(response)).not.toContain("secret-path");
      expect(response.aiGenerated).toBe(true);
      expect(response.grounding).toBe("feature_conditioned");
    });
  });
});
