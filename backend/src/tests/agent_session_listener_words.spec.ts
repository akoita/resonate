/**
 * The listener layer of the AI DJ session parser (#2452): calm/gym/party words,
 * French and accented spellings, adjectival genres and one-edit genre typos,
 * read only from what the Crate Digger rules left unread. Pure unit tests.
 */
import {
  ACCENT_ONLY_GENRE_WORDS,
  ENERGY_IMPLYING_ACTIVITY_WORDS,
  foldListenerText,
  LISTENER_ENERGY_RANGES,
  LISTENER_GENRE_WORDS,
  LISTENER_GUARD_PHRASES,
  LISTENER_HIGH_ENERGY_WORDS,
  LISTENER_LOW_ENERGY_WORDS,
  LISTENER_MOOD_WORDS,
  osaDistance,
  readListenerWords,
  TYPO_MAX_DISTANCE,
  TYPO_MIN_TARGET_LENGTH,
  TYPO_MIN_TOKEN_LENGTH,
  TYPO_STOPLIST,
} from "../modules/agents/agent_session_listener_words";
import { canonicalCrateGenre, canonicalCrateMood } from "../modules/crates/crate_filters";
import { parseCrateRequestText } from "../modules/crates/crate_request_parser";
import type { CrateParseResult } from "../modules/crates/crate.types";
import { TASTE_EDIT_GENRE_ALIASES, TASTE_EDIT_GENRES } from "../modules/recommendations/taste_edit_vocabulary";
import { listeningRequestFromCrateParse } from "../modules/agents/agent_session_request";

/** What the session parser does with a sentence before the artist step: crate rules, then this layer. */
function read(text: string): CrateParseResult {
  return readListenerWords(parseCrateRequestText(text));
}

/** What the listener sees: the listening request plus what is still unread. */
function seen(text: string) {
  const response = listeningRequestFromCrateParse(read(text));
  return { ...response.request, unparsed: response.unparsed };
}

/** A parse result that carries only leftover phrases, to test the layer in isolation. */
function leftover(...unparsed: string[]): CrateParseResult {
  return { ...parseCrateRequestText(""), unparsed };
}

describe("listener energy words", () => {
  it.each([
    ["something calm", "low"],
    ["relaxing evening", "low"],
    ["calming music for sleep", "low"],
    ["soothing", "low"],
    ["gentle morning", "low"],
    ["peaceful", "low"],
    ["quiet", "low"],
    ["sleepy", "low"],
    ["time to unwind", "low"],
    ["wind down", "low"],
    ["easy listening", "low"],
    ["quelque chose de calme", "low"],
    ["tranquille", "low"],
    ["détente", "low"],
    ["musique relaxante", "low"],
    ["apaisant", "low"],
    ["upbeat", "high"],
    ["something energetic", "high"],
    ["intense", "high"],
    ["pumped", "high"],
    ["énergique", "high"],
  ] as const)("reads %j as %s energy", (text, band) => {
    expect(seen(text).energy).toBe(band);
  });

  it("uses the same bands the crate rules give their own energy words", () => {
    expect(parseCrateRequestText("high energy").filters.energy).toEqual(LISTENER_ENERGY_RANGES.high);
    expect(parseCrateRequestText("low energy").filters.energy).toEqual(LISTENER_ENERGY_RANGES.low);
    expect(parseCrateRequestText("medium energy").filters.energy).toEqual(LISTENER_ENERGY_RANGES.medium);
  });

  it("covers the whole family of each calm and energetic idea", () => {
    const low = new Set(LISTENER_LOW_ENERGY_WORDS);
    for (const word of ["calm", "relax", "relaxing", "relaxed", "soothing", "peaceful", "mellow", "wind down", "calme", "apaisant"]) {
      expect(low.has(word)).toBe(true);
    }
    const high = new Set(LISTENER_HIGH_ENERGY_WORDS);
    for (const word of ["upbeat", "energetic", "intense", "pumped", "energique", "dynamique"]) {
      expect(high.has(word)).toBe(true);
    }
  });

  it("never reads chill as a mood", () => {
    expect(seen("chillout").moods).toEqual([]);
    expect(seen("chillout").energy).toBe("low");
  });
});

describe("activity words and moods", () => {
  it.each([
    ["pump me up for the gym", ["Hype"], "high"],
    ["workout", ["Hype"], "high"],
    ["music for training", ["Hype"], "high"],
    ["cardio", ["Hype"], "high"],
    ["pump me up", ["Hype"], "high"],
    ["salle de sport", ["Hype"], "high"],
    ["entraînement", ["Hype"], "high"],
    ["party", ["Club"], "high"],
    ["a party playlist", ["Club"], "high"],
    ["partying", ["Club"], "high"],
    ["fête", ["Club"], "high"],
    ["pour faire la fête", ["Club"], "high"],
  ] as const)("reads %j as %j with %s energy", (text, moods, energy) => {
    const result = seen(text);
    expect(result.moods).toEqual(moods);
    expect(result.energy).toBe(energy);
  });

  it.each([
    ["on the dancefloor", ["Club"]],
    ["dancing", ["Club"]],
    ["pour danser", ["Club"]],
    ["clubbing", ["Club"]],
  ] as const)("reads dancing in %j as the Club mood and no energy", (text, moods) => {
    const result = seen(text);
    expect(result.moods).toEqual(moods);
    expect(result.energy).toBeNull();
  });

  it.each([
    ["something calm to read", "low"],
    ["music to read", null],
    ["I want to concentrate", null],
    ["pour travailler", null],
    ["coding", null],
    ["deep work", "low"],
  ] as const)("reads %j as Focus", (text, energy) => {
    const result = seen(text);
    expect(result.moods).toEqual(["Focus"]);
    expect(result.energy).toBe(energy);
  });

  it.each([
    ["gloomy", ["Dark"]],
    ["midnight", ["Late Night"]],
    ["cozy", ["Warm"]],
    ["meditation", ["Zen"]],
  ] as const)("reads %j as the %j mood", (text, moods) => {
    expect(seen(text).moods).toEqual(moods);
  });

  it("leaves a phrase that merely contains an activity word unread", () => {
    expect(seen("unwind after work")).toMatchObject({ moods: [], energy: "low", unparsed: ["after work"] });
    expect(seen("a dinner party")).toMatchObject({ moods: [], energy: null, unparsed: ["dinner party"] });
    expect(LISTENER_GUARD_PHRASES).toContain("after work");
  });

  it("keeps every table in the catalog's own vocabulary", () => {
    for (const mood of Object.keys(LISTENER_MOOD_WORDS)) expect(canonicalCrateMood(mood)).toBe(mood);
    for (const genre of [...Object.values(LISTENER_GENRE_WORDS), ...Object.values(ACCENT_ONLY_GENRE_WORDS)]) {
      expect(canonicalCrateGenre(genre)).toBe(genre);
    }
    const moodWords = new Set(Object.values(LISTENER_MOOD_WORDS).flat());
    for (const word of ENERGY_IMPLYING_ACTIVITY_WORDS) expect(moodWords.has(word)).toBe(true);
  });

  it("does not turn night, evening or the like into a mood", () => {
    expect(seen("trace the night").moods).toEqual([]);
    expect(seen("relaxing evening").moods).toEqual([]);
  });
});

describe("energy precedence", () => {
  it("lets an explicit energy word beat the energy a party implies", () => {
    expect(seen("calm party")).toMatchObject({ moods: ["Club"], energy: "low" });
    expect(seen("relaxed gym session").energy).toBe("low");
  });

  it("never overrides the energy the crate rules already read", () => {
    const crate = parseCrateRequestText("peak-time calm");
    expect(crate.filters.energy).toEqual(LISTENER_ENERGY_RANGES.high);
    const result = readListenerWords(crate);
    expect(result.filters.energy).toEqual(LISTENER_ENERGY_RANGES.high);
    expect(result.unparsed).toEqual(["calm"]);
  });

  it("does not let a party word override the crate's energy either", () => {
    const result = readListenerWords(parseCrateRequestText("warm-up party"));
    expect(result.filters.energy).toEqual(LISTENER_ENERGY_RANGES.low);
    expect(result.filters.moods).toEqual(["Club"]);
  });

  it("consumes an energy word that agrees with the energy already read", () => {
    const result = readListenerWords(parseCrateRequestText("chill and calm"));
    expect(result.filters.energy).toEqual(LISTENER_ENERGY_RANGES.low);
    expect(result.unparsed).toEqual([]);
  });

  it("sets no energy, and leaves both words unread, when listener words disagree", () => {
    const result = read("calm but upbeat");
    expect(result.filters.energy).toBeNull();
    expect(result.unparsed).toEqual(["calm but upbeat"]);
  });
});

describe("genres: French names, accents and adjectival forms", () => {
  it.each([
    ["classique", "Classical"],
    ["musique classique", "Classical"],
    ["musique du monde", "Musiques du monde"],
    ["musique électronique", "Electronic"],
    ["électro", "Electronic"],
    ["opéra", "Opera"],
    ["reggaetón", "Reggaeton"],
    ["jazzy", "Jazz"],
    ["funky", "Funk"],
    ["soulful", "Soul"],
    ["latino", "Latin"],
    ["ambiant", "Ambient"],
    ["musique ambiante", "Ambient"],
  ])("reads %j as %s", (text, genre) => {
    expect(seen(text).genres).toEqual([genre]);
  });

  it("keeps the plain unaccented electro as the crate rules' Electro genre", () => {
    expect(read("electro").filters.genres).toEqual(["Electro"]);
    expect(read("électro").filters.genres).toEqual(["Electronic"]);
  });

  it("does not read rocky as rock", () => {
    expect(seen("rocky road")).toMatchObject({ genres: [], unparsed: ["rocky road"] });
  });

  it("reads French electro for dancing as Electronic in the Club mood, with no energy", () => {
    expect(seen("électro pour danser")).toMatchObject({
      genres: ["Electronic"],
      moods: ["Club"],
      energy: null,
      unparsed: [],
    });
  });

  it("combines a French genre with a French energy word", () => {
    expect(seen("musique classique calme")).toMatchObject({ genres: ["Classical"], energy: "low", unparsed: [] });
  });

  it("folds accents and case", () => {
    expect(foldListenerText("Électro FÊTE Français")).toBe("electro fete francais");
    expect(foldListenerText("Électro").length).toBe("Électro".length);
    expect(seen("FÊTE").moods).toEqual(["Club"]);
  });
});

describe("typo tolerance (genres only)", () => {
  it.each([
    ["afrobaet", "Afrobeat"],
    ["techo", "Techno"],
    ["tecno", "Techno"],
    ["classicl", "Classical"],
    ["hip hpo", "Hip-Hop"],
    ["hip-hpo", "Hip-Hop"],
    ["hiphpo", "Hip-Hop"],
    ["raggae", "Reggae"],
    ["dubsetp", "Dubstep"],
    ["gospell", "Gospel"],
    ["minimall", "Minimal"],
    ["psytrnce", "Psytrance"],
    ["tech hause", "Tech House"],
  ])("reads the typo %j as %s", (text, genre) => {
    const result = seen(text);
    expect(result.genres).toEqual([genre]);
    expect(result.unparsed).toEqual([]);
  });

  it.each([
    "songs from france",
    "horse riding playlist",
    "trace the night",
    "county fair afternoon",
    "a medal ceremony",
    "reggie's birthday",
    "classic car road trip",
    "building a model train",
    "electric guitar",
    "the american dream",
    "garbage collector",
    "jingle bells",
    "hardcode the value",
  ])("leaves the ordinary sentence %j alone", (text) => {
    const result = seen(text);
    expect(result.genres).toEqual([]);
    expect(result.moods).toEqual([]);
    expect(result.energy).toBeNull();
  });

  it("applies the length guards: short tokens and short targets never fuzzy-match", () => {
    expect(TYPO_MIN_TARGET_LENGTH).toBe(6);
    expect(TYPO_MIN_TOKEN_LENGTH).toBe(5);
    // Four- and five-letter tokens one edit from Trap/House/Metal/Opera stay unread.
    for (const word of ["trip", "traps", "horse", "hous", "metle", "opra", "folks", "bluez", "jazzz"]) {
      expect(read(word).filters.genres).toEqual([]);
    }
    // Targets under six characters (Metal, House, Latin) are not fuzzy targets at all.
    expect(read("metel").filters.genres).toEqual([]);
    expect(read("latim").filters.genres).toEqual([]);
  });

  it("only accepts a distance of one edit", () => {
    expect(TYPO_MAX_DISTANCE).toBe(1);
    expect(osaDistance("afrobaet", "afrobeat")).toBe(1);
    expect(osaDistance("classic", "classical")).toBe(2);
    expect(osaDistance("techo", "techno")).toBe(1);
    expect(read("classic").filters.genres).toEqual([]);
    expect(read("tchno").filters.genres).toEqual(["Techno"]);
    expect(read("tchnoo").filters.genres).toEqual([]);
  });

  it("never matches a stoplisted word, whatever it sits next to", () => {
    for (const word of ["france", "horse", "county", "medal", "reggie", "mouse", "model", "latte", "soup"]) {
      expect(TYPO_STOPLIST.has(word)).toBe(true);
    }
    expect(read("deep horse").filters.genres).toEqual([]);
    expect(read("deep mouse").filters.genres).toEqual([]);
    expect(read("big boom").filters.genres).toEqual([]);
    expect(read("future base").filters.genres).toEqual([]);
  });

  it("rejects every stoplisted word", () => {
    for (const word of TYPO_STOPLIST) {
      if (word.length < TYPO_MIN_TOKEN_LENGTH) continue;
      expect(readListenerWords(leftover(word)).filters.genres).toEqual([]);
    }
  });

  it("takes no match on a tie between two genres", () => {
    // One edit from both Hip-Hop and Trip-Hop, and from both Garage and UK Garage.
    expect(osaDistance("tiphop", "hiphop")).toBe(1);
    expect(osaDistance("tiphop", "triphop")).toBe(1);
    expect(read("tiphop").filters.genres).toEqual([]);
    expect(osaDistance("kgarage", "garage")).toBe(1);
    expect(osaDistance("kgarage", "ukgarage")).toBe(1);
    expect(read("kgarage").filters.genres).toEqual([]);
    // One edit from only one of them is still read.
    expect(read("hiphpo").filters.genres).toEqual(["Hip-Hop"]);
  });

  it("never fuzzy-matches moods or energy words", () => {
    for (const word of ["relaxd", "calmm", "mellw", "upbeet", "energtic", "gloomi", "meditaton", "midnigth"]) {
      const result = read(word);
      expect(result.filters.moods).toEqual([]);
      expect(result.filters.energy).toBeNull();
    }
    // "hype" is a crate mood, and its typos are not read either.
    expect(read("hyp").filters.moods).toEqual([]);
    expect(read("hypee").filters.moods).toEqual([]);
  });

  it("does not read a typo inside a word the tables already consumed", () => {
    expect(seen("calm techo")).toMatchObject({ genres: ["Techno"], energy: "low", unparsed: [] });
  });

  it("never invents a genre from every one-letter deletion of a long genre name", () => {
    const names = [...TASTE_EDIT_GENRES, ...Object.keys(TASTE_EDIT_GENRE_ALIASES)]
      .map((name) => foldListenerText(name).replaceAll(/[\s-]+/g, ""))
      .filter((name) => /^[a-z]+$/.test(name) && name.length > TYPO_MIN_TARGET_LENGTH);
    for (const name of names) {
      for (let i = 0; i < name.length; i += 1) {
        const typo = name.slice(0, i) + name.slice(i + 1);
        const genres = readListenerWords(leftover(typo)).filters.genres;
        // Either it is read as a genre the typo is really one edit from, or it is left alone.
        for (const genre of genres) {
          const near = [...TASTE_EDIT_GENRES, ...Object.entries(TASTE_EDIT_GENRE_ALIASES).map(([k]) => k)].some(
            (candidate) => osaDistance(foldListenerText(candidate).replaceAll(/[\s-]+/g, ""), typo) <= 1,
          );
          expect(near).toBe(true);
          expect(canonicalCrateGenre(genre)).toBe(genre);
        }
      }
    }
  });
});

describe("unparsed bookkeeping", () => {
  it("reads only what the crate rules left, and keeps everything else", () => {
    const crate = parseCrateRequestText("warm deep house around 122 BPM, calm");
    expect(crate.filters.genres).toEqual(["Deep House"]);
    const result = readListenerWords(crate);
    expect(result.filters.bpm).toEqual(crate.filters.bpm);
    expect(result.filters.genres).toEqual(["Deep House"]);
    expect(result.filters.moods).toEqual(["Warm"]);
    expect(result.strategy).toBe("deterministic");
  });

  it("returns the same object when there is nothing to read", () => {
    const empty = parseCrateRequestText("deep house");
    expect(readListenerWords(empty)).toBe(empty);
    const unread = parseCrateRequestText("for cooking");
    expect(readListenerWords(unread)).toBe(unread);
  });

  it("removes the consumed words and the glue at the edges, keeping the rest", () => {
    expect(read("something calm to read").unparsed).toEqual([]);
    expect(read("quelque chose de calme").unparsed).toEqual([]);
    expect(seen("relaxing evening").unparsed).toEqual(["evening"]);
    expect(seen("afrobaet for my cooking").unparsed).toEqual(["cooking"]);
  });

  it("splits what is left on either side of a consumed word into separate phrases", () => {
    expect(read("jogging with the dog calm").unparsed).toEqual(["dog"]);
  });

  it("merges genres and moods with those already read, deduplicated", () => {
    const result = readListenerWords(parseCrateRequestText("jazz, pump me up for the gym, hype"));
    expect(result.filters.genres).toEqual(["Jazz"]);
    expect(result.filters.moods).toEqual(["Hype"]);
  });

  it("respects the crate's maximum number of genres and leaves the extra unread", () => {
    const crate = parseCrateRequestText("jazz, rock, pop, blues, funk");
    const result = readListenerWords({ ...crate, unparsed: ["jazzy soul"] });
    expect(result.filters.genres).toHaveLength(5);
    expect(result.filters.genres).not.toContain("Soul");
    expect(result.unparsed).toContain("soul");
  });

  it("keeps the artists and the strategy the caller set", () => {
    const crate = { ...parseCrateRequestText("calm"), artists: ["Nadia Okoro"] };
    expect(readListenerWords(crate).artists).toEqual(["Nadia Okoro"]);
  });

  it("is deterministic and does not mutate its input", () => {
    const crate = parseCrateRequestText("pump me up for the gym, hip hpo");
    const before = JSON.stringify(crate);
    const first = readListenerWords(crate);
    expect(JSON.stringify(crate)).toBe(before);
    expect(JSON.stringify(readListenerWords(crate))).toBe(JSON.stringify(first));
  });
});

describe("running reads as a workout only in a workout context (#2452)", () => {
  it("reads a running playlist as Hype and high energy", () => {
    expect(seen("running playlist")).toMatchObject({ moods: ["Hype"], energy: "high" });
    expect(seen("music for a run")).toMatchObject({ moods: ["Hype"], energy: "high" });
  });

  it("reads nothing from running late or running errands", () => {
    expect(seen("running late again")).toMatchObject({ genres: [], moods: [], energy: null });
    expect(seen("running errands")).toMatchObject({ genres: [], moods: [], energy: null });
  });
});
