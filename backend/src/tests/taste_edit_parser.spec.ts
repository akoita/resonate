/**
 * Deterministic taste-edit parser (#1961, ADR-TE-5) — pure unit tests.
 * No database: artist matching goes through an injected lookup.
 */
import {
  candidateArtistNames,
  DECLARED_EDIT_RULES,
  isAllowedDeclaredEdit,
  parseTasteEditText,
  TASTE_EDIT_MAX_CLAUSES,
  TASTE_EDIT_MAX_TEXT_LENGTH,
} from "../modules/recommendations/taste_edit_parser";

const summarize = (text: string, options?: Parameters<typeof parseTasteEditText>[1]) =>
  parseTasteEditText(text, options).items.map((item) => [item.kind, item.value, item.action]);

describe("parseTasteEditText", () => {
  describe("genres", () => {
    it("reads 'less X' as a downrank and 'more X' as a boost", () => {
      expect(summarize("less drill")).toEqual([["downrank_genre", "Drill", "downranked"]]);
      expect(summarize("more jazz")).toEqual([["boost_genre", "Jazz", "boosted"]]);
    });

    it.each([
      ["fewer trap beats", "downrank_genre", "Trap"],
      ["no drill", "downrank_genre", "Drill"],
      ["without techno", "downrank_genre", "Techno"],
      ["avoid metal", "downrank_genre", "Metal"],
      ["stop playing rock", "downrank_genre", "Rock"],
      ["hide disco", "downrank_genre", "Disco"],
      ["I love funk", "boost_genre", "Funk"],
      ["I want more reggae", "boost_genre", "Reggae"],
    ])("reads %j", (text, kind, value) => {
      const [item] = parseTasteEditText(text).items;
      expect(item.kind).toBe(kind);
      expect(item.value).toBe(value);
    });

    it("writes the statement the listener will confirm", () => {
      const [less, more] = parseTasteEditText("less drill, more jazz").items;
      expect(less.statement).toBe("Show less Drill");
      expect(more.statement).toBe("Show more Jazz");
      expect(less.signalType).toBe("genre");
      expect(less.phrase).toBe("less drill");
    });

    it("maps spelling aliases onto the catalog genre", () => {
      expect(summarize("more hip hop")[0]).toEqual(["boost_genre", "Hip-Hop", "boosted"]);
      expect(summarize("more hiphop")[0][1]).toBe("Hip-Hop");
      expect(summarize("more lofi")[0][1]).toBe("Lo-Fi");
      expect(summarize("more lo-fi")[0][1]).toBe("Lo-Fi");
      expect(summarize("less rnb")[0][1]).toBe("R&B");
      expect(summarize("less r&b")[0][1]).toBe("R&B");
      expect(summarize("more rhythm and blues")[0][1]).toBe("R&B");
    });

    it("keeps compound genres whole instead of splitting on 'and'", () => {
      expect(summarize("more drum and bass")).toEqual([["boost_genre", "Drum & Bass", "boosted"]]);
      expect(summarize("less drum & bass")).toEqual([["downrank_genre", "Drum & Bass", "downranked"]]);
    });

    it("prefers the longest genre name", () => {
      expect(summarize("more deep house")).toEqual([["boost_genre", "Deep House", "boosted"]]);
      expect(summarize("less k-pop")).toEqual([["downrank_genre", "K-Pop", "downranked"]]);
    });
  });

  describe("clauses", () => {
    it("splits on commas, semicolons and 'and'", () => {
      expect(summarize("less drill, more jazz; fewer trap and more soul")).toEqual([
        ["downrank_genre", "Drill", "downranked"],
        ["boost_genre", "Jazz", "boosted"],
        ["downrank_genre", "Trap", "downranked"],
        ["boost_genre", "Soul", "boosted"],
      ]);
    });

    it("carries the previous more/less into a bare follow-on clause", () => {
      expect(summarize("less drill and trap")).toEqual([
        ["downrank_genre", "Drill", "downranked"],
        ["downrank_genre", "Trap", "downranked"],
      ]);
    });

    it("does not guess a direction for a bare genre", () => {
      const [item] = parseTasteEditText("jazz").items;
      expect(item.kind).toBe("unmapped");
      expect(item.signalType).toBeNull();
      expect(item.action).toBeNull();
      expect(item.statement).toContain("more jazz");
    });

    it("drops duplicate proposals", () => {
      expect(summarize("more jazz, more jazz")).toHaveLength(1);
    });

    it("gives every item a distinct id", () => {
      const ids = parseTasteEditText("less drill, more jazz, chill").items.map((item) => item.id);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  describe("moods", () => {
    it("maps moods to boost and downrank", () => {
      expect(summarize("more dark")).toEqual([["boost_mood", "Dark", "boosted"]]);
      expect(summarize("less hype")).toEqual([["downrank_mood", "Hype", "downranked"]]);
      expect(summarize("more late night")).toEqual([["boost_mood", "Late Night", "boosted"]]);
      expect(parseTasteEditText("more focus").items[0].statement).toBe("Show more Focus music");
    });
  });

  describe("energy", () => {
    it("maps energy wording to an energy preference", () => {
      expect(summarize("more energetic")).toEqual([["energy_preference", "high", "boosted"]]);
      expect(summarize("calmer")).toEqual([["energy_preference", "low", "boosted"]]);
      expect(summarize("chill")).toEqual([["energy_preference", "low", "boosted"]]);
      expect(summarize("medium energy")).toEqual([["energy_preference", "medium", "boosted"]]);
    });

    it("flips the band for 'less'", () => {
      expect(summarize("less energetic")).toEqual([["energy_preference", "low", "boosted"]]);
      expect(summarize("less chill")).toEqual([["energy_preference", "high", "boosted"]]);
    });

    it("does not inherit another clause's direction", () => {
      expect(summarize("no drill and chill")).toEqual([
        ["downrank_genre", "Drill", "downranked"],
        ["energy_preference", "low", "boosted"],
      ]);
    });

    it("can combine energy with a genre in one clause", () => {
      expect(summarize("more chill lofi")).toEqual([
        ["energy_preference", "low", "boosted"],
        ["boost_genre", "Lo-Fi", "boosted"],
      ]);
    });
  });

  describe("artists", () => {
    const resolveArtist = (name: string) =>
      name.toLowerCase() === "the night owls" ? "The Night Owls" : undefined;

    it("hides an artist only when the injected lookup knows the name", () => {
      expect(summarize("no the night owls", { resolveArtist })).toEqual([
        ["hide_artist", "The Night Owls", "hidden"],
      ]);
      expect(summarize("hide THE NIGHT OWLS", { resolveArtist })[0][0]).toBe("hide_artist");
      expect(parseTasteEditText("hide the night owls", { resolveArtist }).items[0].statement)
        .toBe("Hide The Night Owls");
    });

    it("reports an unknown artist as unmapped", () => {
      expect(summarize("hide Somebody Unknown", { resolveArtist })).toEqual([["unmapped", "", null]]);
    });

    it("never proposes an artist without a lookup", () => {
      expect(parseTasteEditText("hide the night owls").items[0].kind).toBe("unmapped");
    });

    it("does not hide an artist for a soft 'less'", () => {
      expect(parseTasteEditText("less the night owls", { resolveArtist }).items[0].kind).toBe("unmapped");
    });

    it("collects candidate names for the service's lookup", () => {
      expect(candidateArtistNames("hide the night owls, more jazz")).toContain("the night owls");
      expect(candidateArtistNames("more jazz")).toEqual([]);
    });
  });

  describe("written preferences and unmapped text", () => {
    it("keeps instrument phrases as a written preference", () => {
      const [item] = parseTasteEditText("more live instruments").items;
      expect(item).toMatchObject({
        kind: "written_preference",
        signalType: "note",
        action: "declared",
        value: "more live instruments",
      });
      expect(item.statement).toContain("nudges recommendations toward music like it");
    });

    it("handles the issue's headline example", () => {
      expect(summarize("less drill, more live instruments")).toEqual([
        ["downrank_genre", "Drill", "downranked"],
        ["written_preference", "more live instruments", "declared"],
      ]);
    });

    it("reads 'acoustic guitar' as an instrument, not the Acoustic genre", () => {
      expect(summarize("more acoustic guitar")).toEqual([
        ["written_preference", "more acoustic guitar", "declared"],
      ]);
    });

    it("strips leading pleasantries from a written preference", () => {
      expect(parseTasteEditText("I want more piano").items[0].value).toBe("more piano");
    });

    it("bounds a written preference to the 80-character value limit", () => {
      const [item] = parseTasteEditText(`more ${"piano ".repeat(30)}`).items;
      expect(item.kind).toBe("written_preference");
      expect(item.value.length).toBeLessThanOrEqual(80);
    });

    it("says so honestly when it cannot map something", () => {
      const [item] = parseTasteEditText("songs about the ocean").items;
      expect(item).toMatchObject({
        kind: "unmapped",
        signalType: null,
        action: null,
        value: "",
      });
      expect(item.statement).toBe("Couldn't map 'songs about the ocean' to a taste signal");
    });

    it("keeps mapped and unmapped clauses side by side", () => {
      expect(summarize("less drill, songs about the ocean").map(([kind]) => kind)).toEqual([
        "downrank_genre",
        "unmapped",
      ]);
    });
  });

  describe("bounds", () => {
    it("returns nothing for empty or non-string input", () => {
      expect(parseTasteEditText("").items).toEqual([]);
      expect(parseTasteEditText("   ").items).toEqual([]);
      expect(parseTasteEditText(undefined as unknown as string).items).toEqual([]);
    });

    it("ignores text beyond the length bound", () => {
      const padding = " ".repeat(TASTE_EDIT_MAX_TEXT_LENGTH);
      expect(parseTasteEditText(`${padding}more jazz`).items).toEqual([]);
    });

    it("reads at most ten clauses and says what it skipped", () => {
      const genres = ["jazz", "soul", "funk", "rock", "pop", "blues", "folk", "punk", "ska", "disco", "dub", "trance"];
      const { items } = parseTasteEditText(genres.map((genre) => `more ${genre}`).join(", "));
      expect(items.filter((item) => item.kind === "boost_genre")).toHaveLength(TASTE_EDIT_MAX_CLAUSES);
      expect(items[items.length - 1].kind).toBe("unmapped");
      expect(items[items.length - 1].statement).toContain(`first ${TASTE_EDIT_MAX_CLAUSES}`);
    });

    it("is deterministic", () => {
      const text = "less drill, more live instruments, calmer, more hip hop";
      expect(parseTasteEditText(text)).toEqual(parseTasteEditText(text));
    });
  });
});

describe("declared edit rules", () => {
  it("allows exactly the combinations a confirmed edit may write", () => {
    expect(isAllowedDeclaredEdit("genre", "boosted")).toBe(true);
    expect(isAllowedDeclaredEdit("genre", "downranked")).toBe(true);
    expect(isAllowedDeclaredEdit("mood", "boosted")).toBe(true);
    expect(isAllowedDeclaredEdit("artist", "hidden")).toBe(true);
    expect(isAllowedDeclaredEdit("energy", "boosted")).toBe(true);
    expect(isAllowedDeclaredEdit("note", "declared")).toBe(true);
  });

  it("rejects everything else", () => {
    expect(isAllowedDeclaredEdit("genre", "hidden")).toBe(false);
    expect(isAllowedDeclaredEdit("artist", "boosted")).toBe(false);
    expect(isAllowedDeclaredEdit("energy", "downranked")).toBe(false);
    expect(isAllowedDeclaredEdit("note", "hidden")).toBe(false);
    expect(isAllowedDeclaredEdit("scene", "boosted")).toBe(false);
    expect(isAllowedDeclaredEdit("genre", "bogus")).toBe(false);
    expect(isAllowedDeclaredEdit("__proto__", "boosted")).toBe(false);
    expect(isAllowedDeclaredEdit(undefined, "boosted")).toBe(false);
    expect(Object.keys(DECLARED_EDIT_RULES).sort()).toEqual(["artist", "energy", "genre", "mood", "note"]);
  });
});
