/**
 * Model-assisted Crate Digger request parser (#1962) — pure unit tests.
 *
 * The model client is a fake and `@google/generative-ai` is mocked: nothing
 * here touches the network. The model's answer is untrusted, so most cases feed
 * it output the parser must refuse.
 */
import { SchemaType } from "@google/generative-ai";
import {
  createCrateRequestParser,
  createGoogleCrateModelClient,
  crateRequestParserStrategy,
  ModelCrateRequestParser,
  type CrateModelClient,
} from "../modules/crates/model_crate_request_parser";
import {
  deterministicCrateRequestParser,
  parseCrateRequestText,
} from "../modules/crates/crate_request_parser";
import { sanitizeCrateFilters } from "../modules/crates/crate_filters";
import { CRATE_REQUEST_MAX_TEXT_LENGTH } from "../modules/crates/crate.types";

const mockGenerateContent = jest.fn();
const mockGetGenerativeModel = jest.fn(() => ({ generateContent: mockGenerateContent }));
const mockGoogleCtor = jest.fn((_apiKey: string) => ({ getGenerativeModel: mockGetGenerativeModel }));
jest.mock("@google/generative-ai", () => ({
  ...jest.requireActual("@google/generative-ai"),
  GoogleGenerativeAI: function (apiKey: string) {
    return mockGoogleCtor(apiKey);
  },
}));

const KEY = "test-key-not-a-secret";

function answer(filters: Record<string, unknown>, phrases: string[] = []) {
  return JSON.stringify({ filters, phrases });
}

function harness(
  respond: (request: Parameters<CrateModelClient["generateJson"]>[0]) => Promise<string>,
  env: NodeJS.ProcessEnv = { GOOGLE_AI_API_KEY: KEY },
) {
  const generateJson = jest.fn(respond);
  const createClient = jest.fn((_apiKey: string): CrateModelClient => ({ generateJson }));
  const logger = { warn: jest.fn() };
  const parser = new ModelCrateRequestParser({ createClient, env, logger });
  return { parser, generateJson, createClient, logger };
}

describe("ModelCrateRequestParser", () => {
  describe("valid model output", () => {
    it("fills fields the deterministic parser left open and says it was model-assisted", async () => {
      const text = "something to open the floor, in Bb major, verified artists";
      const deterministic = parseCrateRequestText(text);
      expect(deterministic.filters.energy).toBeNull();
      expect(deterministic.filters.keys).toEqual(["6B"]);
      const { parser } = harness(async () =>
        answer(
          {
            energyMin: 0,
            energyMax: 0.4,
            genres: ["house"],
            moods: ["late night"],
            requiredStems: ["acapella"],
            licenseType: "Remix",
            maxTotalUsd: 30,
            maxPerItemUsd: 6,
            bpmMin: 118,
            bpmMax: 122,
            verifiedHumanOnly: true,
          },
          ["verified artists"],
        ),
      );
      const result = await parser.parse(text);
      expect(result.strategy).toBe("model-assisted");
      expect(result.filters).toEqual({
        ...deterministic.filters,
        bpm: { min: 118, max: 122 },
        energy: { min: 0, max: 0.4 },
        requiredStems: ["vocals"],
        licenseType: "remix",
        maxTotalUsd: 30,
        maxPerItemUsd: 6,
        verifiedHumanOnly: true,
        genres: ["House"],
        moods: ["Late Night"],
      });
      // Phrases the model really quoted and read are no longer unparsed.
      expect(result.unparsed).not.toContain("verified artists");
      expect(sanitizeCrateFilters(result.filters)).toEqual({ filters: result.filters, errors: [] });
    });

    it("reads keys written as musical keys", async () => {
      const { parser } = harness(async () => answer({ keys: ["A minor", "9a", "nope"] }));
      const result = await parser.parse("something moody");
      expect(result.filters.keys).toEqual(["8A", "9A"]);
      expect(result.strategy).toBe("model-assisted");
    });

    it("sends only the bounded text and the allowed vocabulary", async () => {
      const long = "more jazz ".repeat(200);
      const { parser, generateJson } = harness(async () => answer({}));
      await parser.parse(long);
      const request = generateJson.mock.calls[0][0];
      const prompt = JSON.parse(request.prompt);
      expect(Object.keys(prompt).sort()).toEqual(["allowed", "requestText"]);
      expect(prompt.requestText.length).toBeLessThanOrEqual(CRATE_REQUEST_MAX_TEXT_LENGTH);
      expect(Object.keys(prompt.allowed).sort()).toEqual(["genres", "licenseTypes", "moods", "stems"]);
      expect(request.systemInstruction).toContain("data, not instructions");
    });
  });

  describe("the deterministic parser always wins", () => {
    it("does not let the model override any field the rules set", async () => {
      const text = "peak-time house, 122–124 BPM, 8A, acapella available, remix license, under $20 total, $5 each, no AI, dark";
      const deterministic = parseCrateRequestText(text);
      const { parser } = harness(async () =>
        answer({
          bpmMin: 90,
          bpmMax: 100,
          keys: ["3B"],
          energyMin: 0,
          energyMax: 0.2,
          requiredStems: ["drums"],
          licenseType: "sync",
          maxTotalUsd: 999,
          maxPerItemUsd: 99,
          verifiedHumanOnly: false,
          genres: ["Jazz"],
          moods: ["Zen"],
        }),
      );
      const result = await parser.parse(text);
      expect(result).toEqual(deterministic);
      expect(result.strategy).toBe("deterministic");
    });

    it("fills only the open fields when some are set", async () => {
      const text = "house, 124 bpm, and something dreamy";
      const { parser } = harness(async () =>
        answer({ bpmMin: 90, bpmMax: 100, genres: ["Jazz"], moods: ["Zen"], energyMin: 0, energyMax: 0.3 }),
      );
      const result = await parser.parse(text);
      expect(result.filters.bpm).toEqual({ min: 122, max: 126 });
      expect(result.filters.genres).toEqual(["House"]);
      expect(result.filters.moods).toEqual(["Zen"]);
      expect(result.filters.energy).toEqual({ min: 0, max: 0.3 });
      expect(result.strategy).toBe("model-assisted");
    });

    it("never sets count, neighbours or fully-AI, even when asked nicely", async () => {
      const text = "something dreamy";
      const { parser } = harness(async () =>
        answer({
          count: 25,
          includeCamelotNeighbors: false,
          allowFullyAi: true,
          genres: ["Ambient"],
        }),
      );
      const result = await parser.parse(text);
      const base = parseCrateRequestText(text).filters;
      expect(result.filters.count).toBe(base.count);
      expect(result.filters.includeCamelotNeighbors).toBe(true);
      expect(result.filters.allowFullyAi).toBe(false);
      expect(result.filters.genres).toEqual(["Ambient"]);
    });

    it("keeps the labels honest: deterministic when the model added nothing", async () => {
      const text = "peak-time house 124 bpm";
      const { parser } = harness(async () => answer({ genres: ["Jazz"] }));
      expect(await parser.parse(text)).toEqual(parseCrateRequestText(text));
      const empty = harness(async () => answer({}));
      expect(await empty.parser.parse("something dreamy")).toEqual(parseCrateRequestText("something dreamy"));
    });
  });

  describe("untrusted output is re-validated", () => {
    const text = "something dreamy";
    const base = parseCrateRequestText(text);

    it("drops every invalid value and falls back to the deterministic result", async () => {
      const { parser } = harness(async () =>
        answer({
          bpmMin: "fast",
          bpmMax: NaN,
          keys: [7, null, "13A", "<script>"],
          energyMin: "high",
          requiredStems: ["kazoo", "original"],
          licenseType: "exclusive",
          maxTotalUsd: -5,
          maxPerItemUsd: 1e9,
          verifiedHumanOnly: "yes",
          genres: ["Made Up Genre", 3],
          moods: ["Chill"],
        }),
      );
      expect(await parser.parse(text)).toEqual(base);
    });

    it("clamps out-of-range numbers through the same sanitizer as client edits", async () => {
      const { parser } = harness(async () =>
        answer({ bpmMin: 5, bpmMax: 900, energyMin: -2, energyMax: 4, maxTotalUsd: 50 }),
      );
      const result = await parser.parse(text);
      expect(result.filters.bpm).toEqual({ min: 30, max: 300 });
      expect(result.filters.energy).toEqual({ min: 0, max: 1 });
      expect(result.filters.maxTotalUsd).toBe(50);
    });

    it("swaps a reversed range", async () => {
      const { parser } = harness(async () => answer({ bpmMin: 130, bpmMax: 120 }));
      expect((await parser.parse(text)).filters.bpm).toEqual({ min: 120, max: 130 });
    });

    it("bounds lists", async () => {
      const { parser } = harness(async () =>
        answer({
          genres: ["Jazz", "Blues", "Rock", "Pop", "Funk", "Soul", "Folk"],
          keys: ["1A", "2A", "3A", "4A", "5A", "6A", "7A", "8A"],
        }),
      );
      const result = await parser.parse(text);
      expect(result.filters.genres).toHaveLength(5);
      expect(result.filters.keys).toHaveLength(6);
    });

    it("ignores unknown properties and a phrase that is not in the request", async () => {
      const withUnparsed = "Afro dreamy";
      const deterministic = parseCrateRequestText(withUnparsed);
      expect(deterministic.unparsed.length).toBeGreaterThan(0);
      const { parser } = harness(async () =>
        answer({ moods: ["Zen"], isAdmin: true, constructor: "x" }, ["words never written", "Afro"]),
      );
      const result = await parser.parse(withUnparsed);
      expect(Object.keys(result.filters).sort()).toEqual(Object.keys(deterministic.filters).sort());
      expect((result.filters as unknown as Record<string, unknown>).isAdmin).toBeUndefined();
      // "Afro" really is in the request and the model quoted it; the invented phrase is ignored.
      expect(result.unparsed.join(" ")).not.toContain("Afro");
      expect(result.unparsed.join(" ")).not.toContain("never written");
    });

    it("keeps an unparsed phrase the model did not quote", async () => {
      const { parser } = harness(async () => answer({ moods: ["Zen"] }, []));
      const result = await parser.parse("Afro zen");
      expect(result.unparsed).toEqual(parseCrateRequestText("Afro zen").unparsed);
    });
  });

  describe("fallback to the deterministic parser", () => {
    const text = "something dreamy, house";
    const expected = () => parseCrateRequestText(text);

    it("falls back when the key is missing, without calling the provider", async () => {
      const { parser, generateJson, createClient, logger } = harness(async () => answer({}), {});
      expect(await parser.parse(text)).toEqual(expected());
      expect(await parser.parse(text)).toEqual(expected());
      expect(createClient).not.toHaveBeenCalled();
      expect(generateJson).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledTimes(1);
    });

    it("falls back when the provider throws", async () => {
      const { parser, logger } = harness(async () => {
        throw new Error("provider exploded");
      });
      expect(await parser.parse(text)).toEqual(expected());
      expect(String(logger.warn.mock.calls[0][0])).toContain("provider_error");
    });

    it("falls back when the client cannot even be built", async () => {
      const logger = { warn: jest.fn() };
      const parser = new ModelCrateRequestParser({
        createClient: () => {
          throw new Error("no client");
        },
        env: { GOOGLE_AI_API_KEY: KEY },
        logger,
      });
      expect(await parser.parse(text)).toEqual(expected());
    });

    it.each([
      ["malformed JSON", "{not json"],
      ["a non-object", "42"],
      ["null", "null"],
      ["an array", "[]"],
      ["a missing filters object", JSON.stringify({ phrases: [] })],
      ["filters that are not an object", JSON.stringify({ filters: "house", phrases: [] })],
      ["an empty string", ""],
    ])("falls back on %s", async (_label, raw) => {
      const { parser, logger } = harness(async () => raw);
      expect(await parser.parse(text)).toEqual(expected());
      expect(String(logger.warn.mock.calls[0][0])).toContain("invalid_output");
    });

    it("falls back on timeout", async () => {
      jest.useFakeTimers();
      try {
        const { parser, logger } = harness(() => new Promise<string>(() => undefined), {
          GOOGLE_AI_API_KEY: KEY,
          CRATE_REQUEST_PARSER_TIMEOUT_MS: "1500",
        });
        const pending = parser.parse(text);
        await jest.advanceTimersByTimeAsync(1_499);
        expect(logger.warn).not.toHaveBeenCalled();
        await jest.advanceTimersByTimeAsync(2);
        expect(await pending).toEqual(expected());
        expect(logger.warn).toHaveBeenCalledTimes(1);
        expect(String(logger.warn.mock.calls[0][0])).toContain("timeout");
      } finally {
        jest.useRealTimers();
      }
    });

    it("clamps the timeout to 1s..15s and defaults to 4s", async () => {
      const settleAfter = async (env: NodeJS.ProcessEnv, ms: number) => {
        jest.useFakeTimers();
        try {
          const { parser, logger } = harness(() => new Promise<string>(() => undefined), {
            GOOGLE_AI_API_KEY: KEY,
            ...env,
          });
          const pending = parser.parse(text);
          await jest.advanceTimersByTimeAsync(ms);
          const timedOut = logger.warn.mock.calls.length > 0;
          await jest.advanceTimersByTimeAsync(60_000);
          await pending;
          return timedOut;
        } finally {
          jest.useRealTimers();
        }
      };
      expect(await settleAfter({ CRATE_REQUEST_PARSER_TIMEOUT_MS: "1" }, 999)).toBe(false);
      expect(await settleAfter({ CRATE_REQUEST_PARSER_TIMEOUT_MS: "1" }, 1_001)).toBe(true);
      expect(await settleAfter({ CRATE_REQUEST_PARSER_TIMEOUT_MS: "999999" }, 14_999)).toBe(false);
      expect(await settleAfter({ CRATE_REQUEST_PARSER_TIMEOUT_MS: "999999" }, 15_001)).toBe(true);
      expect(await settleAfter({}, 3_999)).toBe(false);
      expect(await settleAfter({}, 4_001)).toBe(true);
      expect(await settleAfter({ CRATE_REQUEST_PARSER_TIMEOUT_MS: "soon" }, 4_001)).toBe(true);
    });

    it("does not call the model for empty text", async () => {
      const { parser, generateJson } = harness(async () => answer({}));
      expect(await parser.parse("   ")).toEqual(parseCrateRequestText("   "));
      expect(await parser.parse(undefined as unknown as string)).toEqual(parseCrateRequestText(""));
      expect(generateJson).not.toHaveBeenCalled();
    });

    it("truncates over-long text before anything is sent", async () => {
      const long = `${"x".repeat(CRATE_REQUEST_MAX_TEXT_LENGTH)} 124 bpm`;
      const { parser, generateJson } = harness(async () => answer({}));
      await parser.parse(long);
      expect(JSON.parse(generateJson.mock.calls[0][0].prompt).requestText).toHaveLength(CRATE_REQUEST_MAX_TEXT_LENGTH);
    });

    it("uses an injected fallback for the baseline", async () => {
      const fallback = {
        parse: jest.fn(async () => ({ ...parseCrateRequestText("house"), unparsed: ["from-fallback"] })),
      };
      const parser = new ModelCrateRequestParser({
        fallback,
        createClient: () => ({
          generateJson: async () => {
            throw new Error("x");
          },
        }),
        env: { GOOGLE_AI_API_KEY: KEY },
        logger: { warn: jest.fn() },
      });
      expect((await parser.parse("house")).unparsed).toEqual(["from-fallback"]);
    });
  });

  describe("configuration", () => {
    it("uses CRATE_REQUEST_PARSER_MODEL, then VERTEX_AI_MODEL, then a default", async () => {
      const models: string[] = [];
      const run = async (env: NodeJS.ProcessEnv) => {
        const { parser, generateJson } = harness(async () => answer({}), { GOOGLE_AI_API_KEY: KEY, ...env });
        await parser.parse("something dreamy");
        models.push(generateJson.mock.calls[0][0].model);
      };
      await run({ CRATE_REQUEST_PARSER_MODEL: "crate-model", VERTEX_AI_MODEL: "vertex-model" });
      await run({ VERTEX_AI_MODEL: "vertex-model" });
      await run({});
      expect(models[0]).toBe("crate-model");
      expect(models[1]).toBe("vertex-model");
      expect(models[2]).toBeTruthy();
    });

    it("passes the API key to the client factory and nothing else secret", async () => {
      const { parser, createClient } = harness(async () => answer({}));
      await parser.parse("something dreamy");
      expect(createClient).toHaveBeenCalledWith(KEY);
    });
  });

  describe("privacy", () => {
    const secretText = "xyzzy private rooftop party for Quiet Secret Artist, 124 bpm";
    const rawOutput = "RAW-MODEL-OUTPUT-xyzzy {broken";

    it("never logs the request text or the raw model output on any failure path", async () => {
      const failures: Array<() => Promise<string>> = [
        async () => rawOutput,
        async () => {
          throw new Error(`provider echoed ${secretText}`);
        },
        () => new Promise<string>(() => undefined),
      ];
      for (const respond of failures) {
        jest.useFakeTimers();
        try {
          const { parser, logger } = harness(respond, { GOOGLE_AI_API_KEY: KEY });
          const pending = parser.parse(secretText);
          await jest.advanceTimersByTimeAsync(5_000);
          await pending;
          expect(logger.warn).toHaveBeenCalled();
          const logged = JSON.stringify(logger.warn.mock.calls);
          expect(logged).not.toContain("xyzzy");
          expect(logged).not.toContain("Quiet Secret");
          expect(logged).not.toContain("124");
          expect(logged).not.toContain(KEY);
        } finally {
          jest.useRealTimers();
        }
      }
    });

    it("never logs on success either", async () => {
      const { parser, logger } = harness(async () => answer({ genres: ["House"] }, ["xyzzy"]));
      await parser.parse(secretText);
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("does not write the text to the default Nest logger", async () => {
      const spies = [
        jest.spyOn(process.stdout, "write").mockImplementation(() => true),
        jest.spyOn(process.stderr, "write").mockImplementation(() => true),
      ];
      try {
        const parser = new ModelCrateRequestParser({
          createClient: () => ({
            generateJson: async () => {
              throw new Error(`boom ${secretText}`);
            },
          }),
          env: { GOOGLE_AI_API_KEY: KEY },
        });
        await parser.parse(secretText);
        for (const spy of spies) {
          expect(JSON.stringify(spy.mock.calls)).not.toContain("xyzzy");
        }
      } finally {
        spies.forEach((spy) => spy.mockRestore());
      }
    });
  });
});

describe("crate request parser strategy selection", () => {
  it("defaults to deterministic and ignores unknown values", () => {
    expect(crateRequestParserStrategy({})).toBe("deterministic");
    expect(crateRequestParserStrategy({ CRATE_REQUEST_PARSER_STRATEGY: "" })).toBe("deterministic");
    expect(crateRequestParserStrategy({ CRATE_REQUEST_PARSER_STRATEGY: "gpt-everything" })).toBe("deterministic");
    expect(crateRequestParserStrategy({ CRATE_REQUEST_PARSER_STRATEGY: "deterministic" })).toBe("deterministic");
  });

  it("selects the model parser only when explicitly model-assisted", () => {
    expect(crateRequestParserStrategy({ CRATE_REQUEST_PARSER_STRATEGY: "model-assisted" })).toBe("model-assisted");
    expect(crateRequestParserStrategy({ CRATE_REQUEST_PARSER_STRATEGY: " Model_Assisted " })).toBe("model-assisted");
  });

  it("is not switched on by the taste-edit strategy variable", () => {
    expect(crateRequestParserStrategy({ TASTE_EDIT_PARSER_STRATEGY: "model-assisted" })).toBe("deterministic");
  });

  it("builds the deterministic parser by default and the model parser when enabled", () => {
    expect(createCrateRequestParser({})).toBe(deterministicCrateRequestParser);
    expect(createCrateRequestParser({ CRATE_REQUEST_PARSER_STRATEGY: "model-assisted" })).toBeInstanceOf(
      ModelCrateRequestParser,
    );
  });

  it("builds a working parser end to end from the environment", async () => {
    const generateJson = jest.fn(async () => answer({ genres: ["Ambient"] }));
    const parser = createCrateRequestParser(
      { CRATE_REQUEST_PARSER_STRATEGY: "model-assisted", GOOGLE_AI_API_KEY: KEY },
      { createClient: () => ({ generateJson }), logger: { warn: jest.fn() } },
    );
    const result = await parser.parse("something dreamy");
    expect(result.strategy).toBe("model-assisted");
    expect(result.filters.genres).toEqual(["Ambient"]);
  });
});

describe("createGoogleCrateModelClient", () => {
  beforeEach(() => {
    mockGenerateContent.mockReset();
    mockGetGenerativeModel.mockClear();
    mockGoogleCtor.mockClear();
  });

  it("asks for JSON against a response schema with the system instruction", async () => {
    mockGenerateContent.mockResolvedValue({ response: { text: () => "{\"filters\":{},\"phrases\":[]}" } });
    const client = createGoogleCrateModelClient(KEY);
    const raw = await client.generateJson({ model: "m", systemInstruction: "sys", prompt: "p" });
    expect(raw).toBe("{\"filters\":{},\"phrases\":[]}");
    expect(mockGoogleCtor).toHaveBeenCalledWith(KEY);
    expect(mockGenerateContent).toHaveBeenCalledWith("p");
    const config = (mockGetGenerativeModel.mock.calls[0] as unknown as [Record<string, unknown>])[0];
    expect(config.model).toBe("m");
    expect(config.systemInstruction).toBe("sys");
    const generationConfig = config.generationConfig as { responseMimeType: string; responseSchema: { type: string; properties: Record<string, unknown> } };
    expect(generationConfig.responseMimeType).toBe("application/json");
    expect(generationConfig.responseSchema.type).toBe(SchemaType.OBJECT);
    const filterProps = (generationConfig.responseSchema.properties.filters as { properties: Record<string, unknown> }).properties;
    // The model is never offered count, neighbours or fully-AI.
    expect(Object.keys(filterProps)).not.toEqual(expect.arrayContaining(["count"]));
    expect(Object.keys(filterProps)).not.toContain("allowFullyAi");
    expect(Object.keys(filterProps)).not.toContain("includeCamelotNeighbors");
  });

  it("propagates provider errors so the parser can fall back", async () => {
    mockGenerateContent.mockRejectedValue(new Error("quota"));
    await expect(
      createGoogleCrateModelClient(KEY).generateJson({ model: "m", systemInstruction: "s", prompt: "p" }),
    ).rejects.toThrow("quota");
  });
});
