/**
 * Model-assisted taste-edit parser (#2006, ADR-TE-5) — pure unit tests.
 *
 * The model client is a fake: nothing here touches the network. The model's
 * answer is untrusted, so most cases feed it output the parser must refuse.
 */
import {
  createTasteEditParser,
  ModelTasteEditParser,
  tasteEditParserStrategy,
  type TasteEditModelClient,
} from "../modules/recommendations/model_taste_edit_parser";
import {
  DECLARED_EDIT_RULES,
  deterministicTasteEditParser,
  isAllowedDeclaredEdit,
  parseTasteEditText,
  type ParseTasteEditOptions,
} from "../modules/recommendations/taste_edit_parser";

const KEY = "test-key-not-a-secret";

type FakeItem = unknown;

function answer(items: FakeItem[], unmapped: string[] = []) {
  return JSON.stringify({ items, unmapped });
}

function harness(
  respond: (request: Parameters<TasteEditModelClient["generateJson"]>[0]) => Promise<string>,
  env: NodeJS.ProcessEnv = { GOOGLE_AI_API_KEY: KEY },
) {
  const generateJson = jest.fn(respond);
  const createClient = jest.fn((_apiKey: string): TasteEditModelClient => ({ generateJson }));
  const logger = { warn: jest.fn() };
  const parser = new ModelTasteEditParser({ createClient, env, logger });
  return { parser, generateJson, createClient, logger };
}

const summarize = (items: Array<{ kind: string; value: string; action: string | null }>) =>
  items.map((item) => [item.kind, item.value, item.action]);

describe("ModelTasteEditParser", () => {
  describe("valid model output", () => {
    it("maps model items to the same proposed-edit shape as the deterministic parser", async () => {
      const text = "I keep coming back to jazzy stuff, and something to run to";
      const { parser, generateJson } = harness(async () =>
        answer([
          { kind: "genre", value: "Jazz", direction: "more", phrase: "jazzy stuff" },
          { kind: "energy", value: "high", phrase: "something to run to" },
        ]),
      );
      const result = await parser.parse(text);
      expect(generateJson).toHaveBeenCalledTimes(1);
      expect(summarize(result.items)).toEqual(
        expect.arrayContaining([
          ["boost_genre", "Jazz", "boosted"],
          ["energy_preference", "high", "boosted"],
        ]),
      );
      const jazz = result.items.find((item) => item.value === "Jazz")!;
      expect(jazz).toMatchObject({
        signalType: "genre",
        statement: "Show more Jazz",
        phrase: "jazzy stuff",
      });
      expect(result.items.map((item) => item.id)).toEqual(result.items.map((_, i) => `edit-${i + 1}`));
    });

    it("accepts catalog aliases and canonicalizes values", async () => {
      const { parser } = harness(async () =>
        answer([
          { kind: "genre", value: "hip hop", direction: "less", phrase: "hip hop" },
          { kind: "mood", value: "late night", direction: "more", phrase: "late night" },
        ]),
      );
      const result = await parser.parse("hip hop is too much, give me late night vibes");
      expect(summarize(result.items)).toEqual(
        expect.arrayContaining([
          ["downrank_genre", "Hip-Hop", "downranked"],
          ["boost_mood", "Late Night", "boosted"],
        ]),
      );
    });

    it("hides an artist only when the listener named it and the lookup resolves it", async () => {
      const text = "not a fan of Neon Ghost anymore";
      const resolveArtistAsync = jest.fn(async (name: string) =>
        name.toLowerCase() === "neon ghost" ? "Neon Ghost" : undefined,
      );
      const { parser } = harness(async () =>
        answer([{ kind: "artist", value: "neon ghost", direction: "less", phrase: "not a fan of Neon Ghost" }]),
      );
      const result = await parser.parse(text, { resolveArtistAsync });
      expect(resolveArtistAsync).toHaveBeenCalledWith("neon ghost");
      expect(summarize(result.items)).toContainEqual(["hide_artist", "Neon Ghost", "hidden"]);
    });

    it("keeps a note in the listener's own words", async () => {
      const text = "a harmonica solo now and then";
      const { parser } = harness(async () =>
        answer([{ kind: "note", value: "harmonica solo", phrase: "a harmonica solo" }]),
      );
      const result = await parser.parse(text);
      const note = result.items.find((item) => item.kind === "written_preference");
      expect(note).toMatchObject({ signalType: "note", action: "declared", value: "harmonica solo" });
    });

    it("does not add a second note for words the rules already saved", async () => {
      const text = "more live instruments please";
      const { parser } = harness(async () =>
        answer([{ kind: "note", value: "live instruments", phrase: "more live instruments" }]),
      );
      const result = await parser.parse(text);
      expect(result.items.filter((item) => item.kind === "written_preference")).toHaveLength(1);
    });

    it("sends only the bounded text and the allowed vocabulary", async () => {
      const long = "more jazz ".repeat(200);
      const { parser, generateJson } = harness(async () => answer([]));
      await parser.parse(long);
      const request = generateJson.mock.calls[0][0];
      const prompt = JSON.parse(request.prompt);
      expect(Object.keys(prompt).sort()).toEqual(["allowed", "listenerMessage"]);
      expect(prompt.listenerMessage.length).toBeLessThanOrEqual(500);
      expect(Object.keys(prompt.allowed).sort()).toEqual(["energyBands", "genres", "moods"]);
    });
  });

  describe("untrusted output is re-validated", () => {
    const text = "something about jazz and drill, hide Phantom Band";
    const options: ParseTasteEditOptions = {
      resolveArtistAsync: async (name) => (name.toLowerCase() === "ghost writer" ? "Ghost Writer" : undefined),
    };

    it("drops unknown kinds, values outside the vocabulary and impossible combinations", async () => {
      const { parser } = harness(async () =>
        answer([
          { kind: "genre", value: "Made Up Genre", direction: "more", phrase: "jazz" },
          { kind: "genre", value: "Jazz", phrase: "jazz" }, // no direction
          { kind: "genre", value: "Jazz", direction: "sideways", phrase: "jazz" },
          { kind: "mood", value: "Angry", direction: "less", phrase: "drill" },
          { kind: "energy", value: "extreme", phrase: "jazz" },
          { kind: "artist", value: "Ghost Writer", direction: "more", phrase: "jazz" }, // never boosts an artist
          { kind: "playlist", value: "Jazz", direction: "more", phrase: "jazz" },
          { kind: "genre", value: 7, direction: "more", phrase: "jazz" },
          "not an object",
          null,
        ]),
      );
      const result = await parser.parse(text, options);
      // Nothing valid came back, so the deterministic result stands.
      expect(result).toEqual(await deterministicTasteEditParser.parse(text, options));
    });

    it("drops an artist the listener never named, even if the catalog has it", async () => {
      const { parser } = harness(async () =>
        answer([{ kind: "artist", value: "Ghost Writer", direction: "less", phrase: "hide Phantom Band" }]),
      );
      const result = await parser.parse(text, options);
      expect(result.items.some((item) => item.kind === "hide_artist")).toBe(false);
    });

    it("drops an artist the catalog does not have", async () => {
      const { parser } = harness(async () =>
        answer([{ kind: "artist", value: "Phantom Band", direction: "less", phrase: "hide Phantom Band" }]),
      );
      const result = await parser.parse(text, options);
      expect(result.items.some((item) => item.kind === "hide_artist")).toBe(false);
    });

    it("drops an artist when no lookup is available", async () => {
      const { parser } = harness(async () =>
        answer([{ kind: "artist", value: "Phantom Band", direction: "less", phrase: "hide Phantom Band" }]),
      );
      const result = await parser.parse(text);
      expect(result.items.some((item) => item.kind === "hide_artist")).toBe(false);
    });

    it("drops a note that is not the listener's own words", async () => {
      const { parser } = harness(async () =>
        answer([{ kind: "note", value: "the user adores accordion solos", phrase: "adores accordion" }]),
      );
      const result = await parser.parse("more jazz");
      expect(result.items).toEqual(parseTasteEditText("more jazz").items);
    });

    it("bounds notes like the deterministic parser", async () => {
      const long = `more ${"live instruments ".repeat(20)}`.trim();
      const { parser } = harness(async () => answer([{ kind: "note", value: long, phrase: long }]));
      const result = await parser.parse(long);
      const note = result.items.find((item) => item.kind === "written_preference");
      expect(note).toBeDefined();
      expect(note!.value.length).toBeLessThanOrEqual(80);
      expect(note!.phrase.length).toBeLessThanOrEqual(120);
    });

    it("never produces a combination outside DECLARED_EDIT_RULES", async () => {
      const { parser } = harness(async () =>
        answer([
          { kind: "genre", value: "Jazz", direction: "more", phrase: "jazz" },
          { kind: "genre", value: "Drill", direction: "less", phrase: "drill" },
          { kind: "mood", value: "Dark", direction: "less", phrase: "drill" },
          { kind: "energy", value: "low", phrase: "jazz" },
          { kind: "note", value: "jazz", phrase: "jazz" },
          { kind: "artist", value: "Phantom Band", direction: "less", phrase: "Phantom Band" },
        ]),
      );
      const result = await parser.parse(text, {
        resolveArtistAsync: async () => "Phantom Band",
      });
      for (const item of result.items) {
        if (item.kind === "unmapped") continue;
        expect(isAllowedDeclaredEdit(item.signalType, item.action)).toBe(true);
        expect(Object.keys(DECLARED_EDIT_RULES)).toContain(item.signalType);
      }
    });

    it("caps how many artists are looked up for one response", async () => {
      const names = ["A One", "B Two", "C Three", "D Four", "E Five", "F Six", "G Seven"];
      const resolveArtistAsync = jest.fn(async (name: string) => name);
      const { parser } = harness(async () =>
        answer(names.map((name) => ({ kind: "artist", value: name, direction: "less", phrase: name }))),
      );
      await parser.parse(`no ${names.join(", no ")}`, { resolveArtistAsync });
      expect(resolveArtistAsync.mock.calls.length).toBeLessThanOrEqual(5);
    });
  });

  describe("merging with the deterministic parser", () => {
    it("keeps deterministic readings and lets them win a conflict", async () => {
      const text = "less drill, and I'm into jazz";
      const { parser } = harness(async () =>
        answer([
          // The model gets the polarity of Drill wrong; the cue says "less".
          { kind: "genre", value: "Drill", direction: "more", phrase: "less drill" },
          { kind: "genre", value: "Jazz", direction: "more", phrase: "into jazz" },
        ]),
      );
      const result = await parser.parse(text);
      expect(summarize(result.items)).toEqual([
        ["downrank_genre", "Drill", "downranked"],
        ["boost_genre", "Jazz", "boosted"],
      ]);
    });

    it("does not duplicate an item both parsers found", async () => {
      const { parser } = harness(async () =>
        answer([{ kind: "genre", value: "Jazz", direction: "more", phrase: "more jazz" }]),
      );
      const result = await parser.parse("more jazz");
      expect(result.items).toHaveLength(1);
    });

    it("replaces a deterministic 'could not map' with the model's reading of the same words", async () => {
      const text = "songs to run to";
      expect(parseTasteEditText(text).items[0].kind).toBe("unmapped");
      const { parser } = harness(async () =>
        answer([{ kind: "energy", value: "high", phrase: "songs to run to" }]),
      );
      const result = await parser.parse(text);
      expect(summarize(result.items)).toEqual([["energy_preference", "high", "boosted"]]);
    });

    it("still reports text neither parser could map", async () => {
      const text = "more jazz, songs about the ocean";
      const { parser } = harness(async () =>
        answer(
          [{ kind: "genre", value: "Jazz", direction: "more", phrase: "more jazz" }],
          ["songs about the ocean", "words the listener never wrote"],
        ),
      );
      const result = await parser.parse(text);
      const unmapped = result.items.filter((item) => item.kind === "unmapped");
      expect(unmapped.map((item) => item.phrase)).toEqual(["songs about the ocean"]);
      expect(result.items.find((item) => item.kind === "boost_genre")).toBeDefined();
    });

    it("an unquoted model phrase cannot hide a deterministic unmapped row", async () => {
      const text = "more jazz, songs about the ocean";
      const { parser } = harness(async () =>
        answer([{ kind: "genre", value: "Jazz", direction: "more", phrase: "made-up quote" }]),
      );
      const result = await parser.parse(text);
      expect(result.items.some((item) => item.kind === "unmapped")).toBe(true);
    });
  });

  describe("fallback to the deterministic parser", () => {
    const text = "less drill, more jazz";
    const expected = () => parseTasteEditText(text);

    it("falls back when the key is missing, without calling the provider", async () => {
      const { parser, generateJson, createClient } = harness(async () => answer([]), {});
      expect(await parser.parse(text)).toEqual(expected());
      expect(createClient).not.toHaveBeenCalled();
      expect(generateJson).not.toHaveBeenCalled();
    });

    it("falls back when the provider throws", async () => {
      const { parser } = harness(async () => {
        throw new Error("provider exploded");
      });
      expect(await parser.parse(text)).toEqual(expected());
    });

    it.each([
      ["malformed JSON", "{not json"],
      ["a non-object", "42"],
      ["a missing items array", JSON.stringify({ unmapped: [] })],
      ["an empty answer", answer([])],
      ["an empty string", ""],
    ])("falls back on %s", async (_label, raw) => {
      const { parser } = harness(async () => raw);
      expect(await parser.parse(text)).toEqual(expected());
    });

    it("falls back on timeout", async () => {
      jest.useFakeTimers();
      try {
        const { parser, logger } = harness(
          () => new Promise<string>(() => undefined),
          { GOOGLE_AI_API_KEY: KEY, TASTE_EDIT_PARSER_TIMEOUT_MS: "1500" },
        );
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

    it("clamps the timeout", async () => {
      jest.useFakeTimers();
      try {
        const { parser } = harness(
          () => new Promise<string>(() => undefined),
          { GOOGLE_AI_API_KEY: KEY, TASTE_EDIT_PARSER_TIMEOUT_MS: "1" },
        );
        const pending = parser.parse(text);
        await jest.advanceTimersByTimeAsync(999);
        let settled = false;
        void pending.then(() => {
          settled = true;
        });
        await Promise.resolve();
        expect(settled).toBe(false);
        await jest.advanceTimersByTimeAsync(2);
        expect(await pending).toEqual(expected());
      } finally {
        jest.useRealTimers();
      }
    });

    it("does not call the model for empty text", async () => {
      const { parser, generateJson } = harness(async () => answer([]));
      expect(await parser.parse("   ")).toEqual(parseTasteEditText("   "));
      expect(generateJson).not.toHaveBeenCalled();
    });
  });

  describe("configuration", () => {
    it("uses TASTE_EDIT_PARSER_MODEL, then VERTEX_AI_MODEL, then a default", async () => {
      const models: string[] = [];
      const run = async (env: NodeJS.ProcessEnv) => {
        const { parser, generateJson } = harness(async () => answer([]), { GOOGLE_AI_API_KEY: KEY, ...env });
        await parser.parse("more jazz");
        models.push(generateJson.mock.calls[0][0].model);
      };
      await run({ TASTE_EDIT_PARSER_MODEL: "taste-model", VERTEX_AI_MODEL: "vertex-model" });
      await run({ VERTEX_AI_MODEL: "vertex-model" });
      await run({});
      expect(models[0]).toBe("taste-model");
      expect(models[1]).toBe("vertex-model");
      expect(models[2]).toBeTruthy();
    });
  });

  describe("privacy", () => {
    const secretText = "less drill, hide Quiet Secret Artist, my private note xyzzy";
    const rawOutput = "RAW-MODEL-OUTPUT-xyzzy {broken";

    it("never logs the listener's text or the raw model output on any failure path", async () => {
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
          expect(logged).not.toContain("drill");
          expect(logged).not.toContain(KEY);
        } finally {
          jest.useRealTimers();
        }
      }
    });

    it("never logs on success either", async () => {
      const { parser, logger } = harness(async () =>
        answer([{ kind: "genre", value: "Drill", direction: "less", phrase: "less drill" }]),
      );
      await parser.parse(secretText);
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("does not write to the default Nest logger with the text", async () => {
      // Nest's default logger writes to the process streams.
      const spies = [
        jest.spyOn(process.stdout, "write").mockImplementation(() => true),
        jest.spyOn(process.stderr, "write").mockImplementation(() => true),
      ];
      try {
        const createClient = (): TasteEditModelClient => ({
          generateJson: async () => {
            throw new Error("boom");
          },
        });
        const parser = new ModelTasteEditParser({ createClient, env: { GOOGLE_AI_API_KEY: KEY } });
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

describe("taste edit parser strategy selection", () => {
  it("defaults to deterministic and ignores unknown values", () => {
    expect(tasteEditParserStrategy({})).toBe("deterministic");
    expect(tasteEditParserStrategy({ TASTE_EDIT_PARSER_STRATEGY: "" })).toBe("deterministic");
    expect(tasteEditParserStrategy({ TASTE_EDIT_PARSER_STRATEGY: "gpt-everything" })).toBe("deterministic");
    expect(tasteEditParserStrategy({ TASTE_EDIT_PARSER_STRATEGY: "deterministic" })).toBe("deterministic");
  });

  it("selects the model parser only when explicitly model-assisted", () => {
    expect(tasteEditParserStrategy({ TASTE_EDIT_PARSER_STRATEGY: "model-assisted" })).toBe("model-assisted");
    expect(tasteEditParserStrategy({ TASTE_EDIT_PARSER_STRATEGY: " Model_Assisted " })).toBe("model-assisted");
  });

  it("builds the deterministic parser by default and the model parser when enabled", () => {
    expect(createTasteEditParser({})).toBe(deterministicTasteEditParser);
    expect(createTasteEditParser({ TASTE_EDIT_PARSER_STRATEGY: "model-assisted" })).toBeInstanceOf(
      ModelTasteEditParser,
    );
  });

  it("model-assisted without a key behaves exactly like deterministic", async () => {
    const parser = createTasteEditParser({ TASTE_EDIT_PARSER_STRATEGY: "model-assisted" });
    const text = "less drill, more jazz";
    expect(await parser.parse(text)).toEqual(parseTasteEditText(text));
  });
});
