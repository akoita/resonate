import {
  expandGenreSearchTerms,
  genreFamiliesFor,
  genreMatchesRequest,
  normalizeGenreTerm,
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
});
