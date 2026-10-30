import {
  expandGenreSearchTerms,
  firstMatchingGenreTerm,
  genreFamiliesFor,
  descriptorMatchesRequest,
  genreMatchesRequest,
  normalizeGenreTerm,
  primaryGenreFamily,
  relatedGenreLabels,
  releaseGenreFamilies,
} from "../modules/recommendations/genre_families";

describe("genre families (#2088)", () => {
  describe("normalizeGenreTerm", () => {
    it("lowercases, strips accents and punctuation", () => {
      expect(normalizeGenreTerm("Hip-Hop")).toBe("hip hop");
      expect(normalizeGenreTerm("  Coupé-Décalé ")).toBe("coupe decale");
      expect(normalizeGenreTerm("Raï")).toBe("rai");
      expect(normalizeGenreTerm("R&B")).toBe("r and b");
      expect(normalizeGenreTerm("Drum & Bass")).toBe("drum and bass");
    });
  });

  describe("genreFamiliesFor", () => {
    it("resolves requested terms to their families", () => {
      expect(genreFamiliesFor("World").map((f) => f.id)).toContain("world");
      expect(genreFamiliesFor("Musiques du monde").map((f) => f.id)).toContain("world");
      expect(genreFamiliesFor("French Rap").map((f) => f.id)).toContain("hip-hop");
    });

    it("does not widen a narrow request to a broad family through a member", () => {
      expect(genreFamiliesFor("Afrobeats").map((f) => f.id)).not.toContain("world");
      expect(genreFamiliesFor("Reggaeton").map((f) => f.id)).not.toContain("latin");
    });

    it("resolves nothing for an unknown term", () => {
      expect(genreFamiliesFor("Zzyzx")).toEqual([]);
    });

    it("classifies release genres by whole-word members", () => {
      expect(releaseGenreFamilies("African").map((f) => f.id)).toEqual(
        expect.arrayContaining(["world", "african"]),
      );
      expect(releaseGenreFamilies("Afro House").map((f) => f.id)).toContain("electronic");
    });
  });

  describe("expandGenreSearchTerms", () => {
    it("starts with the original term and adds family labels", () => {
      const terms = expandGenreSearchTerms("World");
      expect(terms[0]).toBe("World");
      expect(terms).toEqual(expect.arrayContaining(["african", "musiques du monde"]));
    });

    it("offers hyphenated and accent-free spellings", () => {
      const terms = expandGenreSearchTerms("Hip Hop");
      expect(terms).toEqual(expect.arrayContaining(["Hip Hop", "hip-hop", "rap", "french rap"]));
      expect(expandGenreSearchTerms("World")).toEqual(
        expect.arrayContaining(["coupé-décalé", "coupe decale", "coupe-decale"]),
      );
    });

    it("dedupes case-insensitively, caps the list and keeps terms of 3+ characters", () => {
      const terms = expandGenreSearchTerms("World", 10);
      expect(terms).toHaveLength(10);
      const lower = terms.map((t) => t.toLowerCase());
      expect(new Set(lower).size).toBe(lower.length);
      expect(expandGenreSearchTerms("World").slice(1).every((t) => t.length >= 3)).toBe(true);
    });

    it("returns only the term for an unknown genre and nothing for blank input", () => {
      expect(expandGenreSearchTerms("Zzyzx")).toEqual(["Zzyzx"]);
      expect(expandGenreSearchTerms("  ")).toEqual([]);
    });
  });

  describe("genreMatchesRequest", () => {
    it("treats spacing, hyphens and case as equal", () => {
      expect(genreMatchesRequest("Hip Hop", "Hip-Hop")).toBe(true);
      expect(genreMatchesRequest("hip-hop", "HIP HOP")).toBe(true);
      expect(genreMatchesRequest("HipHop", "Hip-Hop")).toBe(true);
    });

    it("matches family members", () => {
      expect(genreMatchesRequest("Rap", "Hip-Hop")).toBe(true);
      expect(genreMatchesRequest("French Rap", "Hip Hop")).toBe(true);
      expect(genreMatchesRequest("Hip Hop", "Rap")).toBe(true);
      expect(genreMatchesRequest("African", "World")).toBe(true);
      expect(genreMatchesRequest("Musiques du monde", "World")).toBe(true);
      expect(genreMatchesRequest("World", "Musiques du monde")).toBe(true);
      expect(genreMatchesRequest("Afrobeats", "World")).toBe(true);
    });

    it("matches a label contained as whole words", () => {
      expect(genreMatchesRequest("Deep House", "house")).toBe(true);
      expect(genreMatchesRequest("house", "Deep House")).toBe(true);
    });

    it("does not match a label that is only a fragment of a word", () => {
      expect(genreMatchesRequest("Dubstep", "Reggae")).toBe(false);
      expect(genreMatchesRequest("Dubstep", "dub")).toBe(false);
      expect(genreMatchesRequest("Popcorn", "Pop")).toBe(false);
    });

    it("handles diacritics", () => {
      expect(genreMatchesRequest("Raï", "World")).toBe(true);
      expect(genreMatchesRequest("Rai", "Raï")).toBe(true);
      expect(genreMatchesRequest("Coupé-Décalé", "World")).toBe(true);
      expect(genreMatchesRequest("Coupe Decale", "African")).toBe(true);
    });

    it("rejects unrelated genres", () => {
      expect(genreMatchesRequest("Ambient", "Rap")).toBe(false);
      expect(genreMatchesRequest("Techno", "World")).toBe(false);
      expect(genreMatchesRequest("Flamenco", "Afrobeats")).toBe(false);
      expect(genreMatchesRequest("Jazz", "Hip-Hop")).toBe(false);
    });

    it("never matches blank or missing values", () => {
      expect(genreMatchesRequest(null, "World")).toBe(false);
      expect(genreMatchesRequest("African", "")).toBe(false);
      expect(genreMatchesRequest(undefined, undefined)).toBe(false);
    });
  });

  describe("relatedGenreLabels", () => {
    it("lists other family labels without the term itself", () => {
      const related = relatedGenreLabels("Hip-Hop", 8);
      expect(related.length).toBeLessThanOrEqual(8);
      expect(related).toContain("rap");
      expect(related.map(normalizeGenreTerm)).not.toContain("hip hop");
    });
  });

  describe("one matcher for sessions and lanes (#2236)", () => {
    it("treats the taste-edit vocabulary's spellings as one genre", () => {
      expect(genreMatchesRequest("DnB", "Drum & Bass")).toBe(true);
      expect(genreMatchesRequest("Lo Fi", "Lo-Fi")).toBe(true);
      expect(genreMatchesRequest("Afrobeats", "Afrobeat")).toBe(true);
      expect(genreMatchesRequest("Techno", "Drum & Bass")).toBe(false);
    });

    it("returns the first requested term a genre satisfies", () => {
      expect(firstMatchingGenreTerm("Mandingue", ["Techno", "World", "African"])).toBe("World");
      expect(firstMatchingGenreTerm("Mandingue", ["Techno", "Jazz"])).toBeUndefined();
      expect(firstMatchingGenreTerm(null, ["World"])).toBeUndefined();
      expect(firstMatchingGenreTerm("African", [])).toBeUndefined();
    });

    it("keys a free-text genre by one family: narrow first, then the smallest broad one", () => {
      expect(primaryGenreFamily("French Rap")?.id).toBe("hip-hop");
      expect(primaryGenreFamily("Mandingue")?.id).toBe("african");
      expect(primaryGenreFamily("African")?.id).toBe("african");
      expect(primaryGenreFamily("Afrobeats")?.id).toBe("afrobeats");
      expect(primaryGenreFamily("Flamenco")?.id).toBe("world");
      expect(primaryGenreFamily("Senegal")).toBeUndefined();
      expect(primaryGenreFamily(null)).toBeUndefined();
    });

    it("a family id is a request the matcher understands", () => {
      for (const [genre, id] of [
        ["Mandingue", "african"],
        ["French Rap", "hip-hop"],
        ["Neo Soul", "r&b-soul"],
        ["Chillhop", "ambient-lofi"],
      ] as const) {
        expect(primaryGenreFamily(genre)?.id).toBe(id);
        expect(genreMatchesRequest(genre, id)).toBe(true);
      }
    });
  });

  describe("exact first, and a guarded reverse containment (#2453)", () => {
    const ids = (term: string) => genreFamiliesFor(term).map((f) => f.id).sort();

    it("resolves a known label to its own families, not through an inner word", () => {
      expect(ids("afro pop")).toEqual(["afrobeats"]);
      expect(ids("Afro-Pop")).toEqual(["afrobeats"]);
      expect(ids("latin pop")).toEqual([]);
      expect(ids("baile funk")).toEqual([]);
      expect(ids("latin trap")).toEqual(["reggaeton"]);
      expect(ids("french rap")).toEqual(["hip-hop"]);
      expect(ids("deep house")).toEqual([]);
      expect(ids("world")).toEqual(["world"]);
    });

    it("still resolves a term that is not a member through containment", () => {
      expect(ids("psych rock")).toEqual(["rock"]);
    });

    it("does not let Pop releases satisfy Afro-Pop, Latin Pop or Baile Funk requests", () => {
      expect(genreMatchesRequest("Pop", "Afro-Pop")).toBe(false);
      expect(genreMatchesRequest("Dance Pop", "Afro-Pop")).toBe(false);
      expect(genreMatchesRequest("Synthpop", "Afro-Pop")).toBe(false);
      expect(genreMatchesRequest("Pop", "Latin Pop")).toBe(false);
      expect(genreMatchesRequest("Funk", "Baile Funk")).toBe(false);
      expect(genreMatchesRequest("Trap", "Latin Trap")).toBe(false);
    });

    it("still satisfies those requests with the right releases", () => {
      expect(genreMatchesRequest("Afro-Pop", "Afro-Pop")).toBe(true);
      expect(genreMatchesRequest("Afrobeats", "Afro-Pop")).toBe(true);
      expect(genreMatchesRequest("Amapiano", "Afro-Pop")).toBe(true);
      expect(genreMatchesRequest("Latin Pop", "Latin Pop")).toBe(true);
      expect(genreMatchesRequest("Reggaeton", "Latin Trap")).toBe(true);
      expect(genreMatchesRequest("Afro-Pop", "Pop")).toBe(true);
    });

    it("keeps reverse containment for a generic label in the same family", () => {
      expect(genreMatchesRequest("House", "Deep House")).toBe(true);
      expect(genreMatchesRequest("Jazz", "Acid Jazz")).toBe(true);
      expect(genreMatchesRequest("Rock", "Psych-Rock")).toBe(true);
      expect(genreMatchesRequest("Deep House", "House")).toBe(true);
    });

    it("keeps Techno and Deep House out of a Pop request, and Dance Pop in", () => {
      expect(genreMatchesRequest("Techno", "Pop")).toBe(false);
      expect(genreMatchesRequest("Deep House", "Synthpop")).toBe(false);
      expect(genreMatchesRequest("EDM", "Pop")).toBe(false);
      expect(genreMatchesRequest("Dance Pop", "Pop")).toBe(true);
      expect(genreMatchesRequest("Synthpop", "Pop")).toBe(true);
    });

    it("gives the search expansion and the descriptor match the same exact-first reading", () => {
      const afro = expandGenreSearchTerms("Afro-Pop").map((t) => t.toLowerCase());
      expect(afro).toContain("amapiano");
      expect(afro).not.toContain("dance pop");
      expect(afro).not.toContain("synthpop");
      expect(descriptorMatchesRequest(["pop"], "Afro-Pop")).toBe(false);
      expect(descriptorMatchesRequest(["afrobeats"], "Afro-Pop")).toBe(true);
      expect(descriptorMatchesRequest(["pop"], "Pop")).toBe(true);
    });
  });
});

describe("release side is exact first too (#2453)", () => {
  const ids = (label: string) => releaseGenreFamilies(label).map((family) => family.id).sort();

  it("classifies a known compound label only by the families listing it", () => {
    expect(ids("Dance Pop")).toEqual(["pop"]);
    expect(ids("Indie Pop")).toEqual(["pop"]);
    expect(ids("Afro House").sort()).toEqual(["african", "electronic"]);
  });

  it("still classifies an unlisted label by every member it contains", () => {
    expect(ids("Lo-fi Hip Hop")).toEqual(["ambient-lofi", "hip-hop"]);
  });

  it("no longer lets a Dance Pop release into an Electronic request", () => {
    expect(genreMatchesRequest("Dance Pop", "Electronic")).toBe(false);
    expect(genreMatchesRequest("Techno", "Electronic")).toBe(true);
  });
});
