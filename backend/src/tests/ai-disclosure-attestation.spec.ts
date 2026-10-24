import {
  ARTIST_REFERENCE_HOSTS,
  AttestationManifestError,
  GENERATIVE_AI_ERA_CUTOFF,
  buildAttestationReport,
  classifyAttestationCandidate,
  formatAttestationReportSummary,
  isKnownLabel,
  isrcReferenceYear,
  parseAttestationManifest,
  trackAttestationDecision,
  type AttestationCandidateRelease,
  type AttestationCandidateTrack,
} from "../modules/catalog/ai-disclosure-attestation";
import { parseApplyArgs } from "../scripts/apply_ai_disclosure_attestation";
import { parseReportArgs } from "../scripts/report_ai_disclosure_attestation_candidates";

const NOW = new Date("2026-10-25T09:00:00.000Z");

function track(overrides: Partial<AttestationCandidateTrack> = {}): AttestationCandidateTrack {
  return {
    id: "t1",
    isrc: null,
    aiDisclosureLevel: "UNDECLARED",
    aiDisclosureSource: "migration",
    hasGenerationMetadata: false,
    ...overrides,
  };
}

function release(overrides: Partial<AttestationCandidateRelease> = {}): AttestationCandidateRelease {
  return {
    id: "r1",
    title: "Known Album",
    type: "album",
    primaryArtist: "Known Artist",
    label: null,
    releaseDate: null,
    artist: null,
    tracks: [track()],
    ...overrides,
  };
}

const COMMONS_ARTIST = {
  id: "a1",
  displayName: "Known Artist",
  imageUrl: "https://upload.wikimedia.org/wikipedia/commons/a/ab/Known.jpg",
  website: null,
  socialLinks: null,
};

describe("ISRC reference year", () => {
  it.each([
    ["USRC17607839", 1976],
    ["US-RC1-17-07839", 2017],
    ["gbaaa9900001", 1999],
    ["FRZ112200001", 2022],
    ["FRZ112600001", 2026],
    ["FRZ112700001", 1927],
  ])("reads %s as %s", (isrc, year) => {
    expect(isrcReferenceYear(isrc, NOW)).toBe(year);
  });

  it.each([null, undefined, "", "not-an-isrc", "USRC1760783", "12RC17607839"])(
    "returns null for %p",
    (isrc) => {
      expect(isrcReferenceYear(isrc as string | null | undefined, NOW)).toBeNull();
    },
  );
});

describe("known label", () => {
  it.each(["Sony Music", "Sacra Music", "Barclay"])("treats %s as known", (label) => {
    expect(isKnownLabel(label)).toBe(true);
  });

  it.each([null, undefined, "", "  ", "Self-Released", "INDEPENDENT", "N/A", "None", "x"])(
    "does not treat %p as a known label",
    (label) => {
      expect(isKnownLabel(label as string | null | undefined)).toBe(false);
    },
  );
});

describe("attestation classification", () => {
  it("proposes a pre-cutoff release by a label-backed artist", () => {
    const result = classifyAttestationCandidate(
      release({ releaseDate: new Date("2019-05-01"), label: "Sony Music" }),
      NOW,
    );

    expect(result.bucket).toBe("proposed");
    expect(result.reasons).toEqual([]);
    expect(result.signals.map((signal) => signal.code)).toEqual([
      "release_date_before_cutoff",
      "known_label",
    ]);
  });

  it("proposes on ISRC years plus an artist reference when the date is missing", () => {
    const result = classifyAttestationCandidate(
      release({
        artist: COMMONS_ARTIST,
        tracks: [track({ id: "t1", isrc: "USRC11900001" }), track({ id: "t2", isrc: "USRC12100002" })],
      }),
      NOW,
    );

    expect(result.bucket).toBe("proposed");
    expect(result.signals.map((signal) => signal.code)).toEqual([
      "isrc_year_before_cutoff",
      "artist_external_reference",
    ]);
  });

  describe("stored artist ids (#2258)", () => {
    const MBID = "5b11f4ce-a62d-471e-81fc-a69a8278c7da";
    const IDS_ARTIST = {
      ...COMMONS_ARTIST,
      imageUrl: null,
      musicbrainzArtistId: MBID,
      wikidataQid: "Q42",
      externalIdMatchConfidence: "high",
      externalIdMatchedAt: new Date("2026-10-20T10:00:00.000Z"),
    };
    const dated = { releaseDate: new Date("2015-01-01") };
    const codes = (r: AttestationCandidateRelease) =>
      classifyAttestationCandidate(r, NOW).signals.map((signal) => signal.code);

    it("proposes on a date plus a stored high-confidence id, with no URL trace", () => {
      const result = classifyAttestationCandidate(release({ ...dated, artist: IDS_ARTIST }), NOW);

      expect(result.bucket).toBe("proposed");
      expect(result.signals.map((signal) => signal.code)).toEqual([
        "release_date_before_cutoff",
        "artist_external_id",
      ]);
      expect(result.signals[1].detail).toBe(
        `artist matched MusicBrainz ${MBID}, Wikidata Q42 (high confidence, matched 2026-10-20)`,
      );
    });

    it("accepts a medium match and a MusicBrainz id without a Wikidata QID", () => {
      const artist = { ...IDS_ARTIST, wikidataQid: null, externalIdMatchConfidence: "medium", externalIdMatchedAt: null };
      const result = classifyAttestationCandidate(release({ ...dated, artist }), NOW);

      expect(result.bucket).toBe("proposed");
      expect(result.signals[1].detail).toBe(`artist matched MusicBrainz ${MBID} (medium confidence)`);
    });

    it("emits one artist signal: stored ids replace the URL-host inference", () => {
      expect(codes(release({ ...dated, artist: { ...IDS_ARTIST, imageUrl: COMMONS_ARTIST.imageUrl } })))
        .toEqual(["release_date_before_cutoff", "artist_external_id"]);
    });

    it.each([
      ["a low-confidence match", { externalIdMatchConfidence: "low" }],
      ["a missing confidence", { externalIdMatchConfidence: null }],
      ["an unknown confidence", { externalIdMatchConfidence: "certain" }],
      ["a malformed MusicBrainz id", { musicbrainzArtistId: "not-a-uuid" }],
      ["no MusicBrainz id", { musicbrainzArtistId: null }],
    ])("does not count %s as provenance", (_label, override) => {
      const result = classifyAttestationCandidate(
        release({ ...dated, artist: { ...IDS_ARTIST, ...override } }),
        NOW,
      );

      expect(result.bucket).toBe("needs_review");
      expect(result.reasons).toEqual(["missing_provenance_evidence"]);
      expect(result.signals.map((signal) => signal.code)).toEqual(["release_date_before_cutoff"]);
    });

    it("falls back to the URL-host inference when the stored match is unusable", () => {
      const artist = { ...COMMONS_ARTIST, musicbrainzArtistId: MBID, externalIdMatchConfidence: "low" };

      expect(codes(release({ ...dated, artist }))).toEqual([
        "release_date_before_cutoff",
        "artist_external_reference",
      ]);
    });

    it("still falls back to URL hosts for an artist with no stored ids at all", () => {
      expect(codes(release({ ...dated, artist: COMMONS_ARTIST }))).toEqual([
        "release_date_before_cutoff",
        "artist_external_reference",
      ]);
    });

    it("never lets stored ids override a conflicting or excluding signal", () => {
      const late = classifyAttestationCandidate(
        release({ artist: IDS_ARTIST, releaseDate: new Date("2024-01-01") }),
        NOW,
      );
      const ai = classifyAttestationCandidate(
        release({ ...dated, artist: IDS_ARTIST, type: "ai_generated" }),
        NOW,
      );

      expect(late.bucket).toBe("needs_review");
      expect(ai.bucket).toBe("excluded");
    });
  });

  it("treats the cutoff day itself as not before the cutoff", () => {
    const result = classifyAttestationCandidate(
      release({ releaseDate: GENERATIVE_AI_ERA_CUTOFF, label: "Sony Music" }),
      NOW,
    );

    expect(result.bucket).toBe("needs_review");
    expect(result.reasons).toEqual(
      expect.arrayContaining(["conflicting_signals", "missing_date_evidence"]),
    );
  });

  it("never proposes on a date alone", () => {
    const result = classifyAttestationCandidate(
      release({ releaseDate: new Date("2010-01-01") }),
      NOW,
    );

    expect(result.bucket).toBe("needs_review");
    expect(result.reasons).toEqual(["missing_provenance_evidence"]);
  });

  it("never proposes on a known label alone", () => {
    const result = classifyAttestationCandidate(release({ label: "Sony Music" }), NOW);

    expect(result.bucket).toBe("needs_review");
    expect(result.reasons).toEqual(["missing_date_evidence"]);
  });

  it("sends a pre-cutoff date contradicted by a later ISRC to review", () => {
    const result = classifyAttestationCandidate(
      release({
        releaseDate: new Date("2015-01-01"),
        label: "Sony Music",
        tracks: [track({ isrc: "USRC12400001" })],
      }),
      NOW,
    );

    expect(result.bucket).toBe("needs_review");
    expect(result.reasons).toContain("conflicting_signals");
  });

  it("sends a release that mixes declared and undeclared tracks to review", () => {
    const result = classifyAttestationCandidate(
      release({
        releaseDate: new Date("2015-01-01"),
        label: "Sony Music",
        tracks: [
          track({ id: "t1" }),
          track({ id: "t2", aiDisclosureLevel: "PARTLY", aiDisclosureSource: "artist" }),
        ],
      }),
      NOW,
    );

    expect(result.bucket).toBe("needs_review");
    expect(result.reasons).toEqual(["mixed_declarations"]);
    expect(result.undeclaredTrackCount).toBe(1);
  });

  it("excludes a release with no signal at all", () => {
    const result = classifyAttestationCandidate(release(), NOW);

    expect(result.bucket).toBe("excluded");
    expect(result.reasons).toEqual(["no_supporting_signal"]);
    expect(result.signals).toEqual([]);
  });

  it.each([
    ["ai_generated", "ai_generated_release"],
    ["remix", "remix_release"],
  ])("excludes a %s release however strong the signals", (type, reason) => {
    const result = classifyAttestationCandidate(
      release({ type, releaseDate: new Date("2015-01-01"), label: "Sony Music" }),
      NOW,
    );

    expect(result.bucket).toBe("excluded");
    expect(result.reasons).toContain(reason);
  });

  it("excludes a release with a generationMetadata track", () => {
    const result = classifyAttestationCandidate(
      release({
        releaseDate: new Date("2015-01-01"),
        label: "Sony Music",
        tracks: [track({ id: "t1" }), track({ id: "t2", hasGenerationMetadata: true })],
      }),
      NOW,
    );

    expect(result.bucket).toBe("excluded");
    expect(result.reasons).toEqual(["has_generation_metadata"]);
  });

  it("excludes a release with no UNDECLARED migration track", () => {
    const result = classifyAttestationCandidate(
      release({
        releaseDate: new Date("2015-01-01"),
        label: "Sony Music",
        tracks: [track({ aiDisclosureSource: "artist" })],
      }),
      NOW,
    );

    expect(result.bucket).toBe("excluded");
    expect(result.reasons).toEqual(["no_undeclared_migration_tracks"]);
  });

  it("recognises enrichment hosts on subdomains only, not look-alikes", () => {
    expect(ARTIST_REFERENCE_HOSTS).toContain("musicbrainz.org");
    const withHost = (imageUrl: string) =>
      classifyAttestationCandidate(
        release({ artist: { ...COMMONS_ARTIST, imageUrl }, releaseDate: new Date("2015-01-01") }),
        NOW,
      ).signals.some((signal) => signal.code === "artist_external_reference");

    expect(withHost("https://upload.wikimedia.org/x.jpg")).toBe(true);
    expect(withHost("https://musicbrainz.org/artist/abc")).toBe(true);
    expect(withHost("https://evil-musicbrainz.org/artist/abc")).toBe(false);
    expect(withHost("https://musicbrainz.org.evil.example/abc")).toBe(false);
    expect(withHost("not a url")).toBe(false);
  });

  it("places every release in exactly one bucket and drafts only the proposed ids", () => {
    const report = buildAttestationReport(
      [
        release({ id: "r-proposed", releaseDate: new Date("2015-01-01"), label: "Sony Music" }),
        release({ id: "r-review", releaseDate: new Date("2015-01-01") }),
        release({ id: "r-excluded" }),
        release({ id: "r-remix", type: "remix", releaseDate: new Date("2015-01-01") }),
      ],
      NOW,
    );

    expect(report.counts).toEqual({ proposed: 1, needs_review: 1, excluded: 2, total: 4 });
    expect(report.releases).toHaveLength(4);
    expect(new Set(report.releases.map((entry) => entry.releaseId)).size).toBe(4);
    expect(report.manifestDraft).toEqual({ releaseIds: ["r-proposed"] });
    expect(report.cutoff).toBe(GENERATIVE_AI_ERA_CUTOFF.toISOString());

    const summary = formatAttestationReportSummary(report);
    expect(summary).toContain("proposed:     1");
    expect(summary).toContain("excluded:     2");
    expect(summary).toContain("excluded:remix_release = 1");
  });
});

describe("attestation apply guards (pure)", () => {
  it.each([
    [{ aiDisclosureLevel: "UNDECLARED", aiDisclosureSource: "migration", hasGenerationMetadata: false }, "eligible"],
    [{ aiDisclosureLevel: "UNDECLARED", aiDisclosureSource: "migration", hasGenerationMetadata: true }, "has_generation_metadata"],
    [{ aiDisclosureLevel: "NONE", aiDisclosureSource: "catalog_attestation", hasGenerationMetadata: false }, "already_attested"],
    [{ aiDisclosureLevel: "NONE", aiDisclosureSource: "artist", hasGenerationMetadata: false }, "already_declared"],
    [{ aiDisclosureLevel: "ALL", aiDisclosureSource: "resonate_native", hasGenerationMetadata: false }, "already_declared"],
    [{ aiDisclosureLevel: "UNDECLARED", aiDisclosureSource: "artist", hasGenerationMetadata: false }, "unexpected_source"],
  ] as const)("decides %j -> %s", (input, expected) => {
    expect(trackAttestationDecision(input)).toBe(expected);
  });
});

describe("attestation manifest", () => {
  it("accepts an array or a releaseIds object and collapses duplicates", () => {
    expect(parseAttestationManifest(["a", " b ", "a"])).toEqual({ releaseIds: ["a", "b"] });
    expect(parseAttestationManifest({ releaseIds: ["a"] })).toEqual({ releaseIds: ["a"] });
  });

  it.each([null, "a", 3, {}, { releaseIds: "a" }, [1], [""], ["a", null]])(
    "rejects %j",
    (raw) => {
      expect(() => parseAttestationManifest(raw)).toThrow(AttestationManifestError);
    },
  );
});

describe("attestation CLI arguments", () => {
  it("defaults the apply script to a dry run", () => {
    expect(parseApplyArgs(["--manifest", "m.json"])).toEqual({ manifest: "m.json", apply: false });
    expect(parseApplyArgs(["--manifest", "m.json", "--dry-run"]).apply).toBe(false);
    expect(parseApplyArgs(["--manifest", "m.json", "--apply"]).apply).toBe(true);
  });

  it.each([
    [[], "--manifest"],
    [["--manifest"], "needs a file path"],
    [["--manifest", "--apply"], "needs a file path"],
    [["--manifest", "m.json", "--apply", "--dry-run"], "mutually exclusive"],
    [["--manifest", "m.json", "--force"], "Unknown argument"],
  ])("rejects %j", (argv, message) => {
    expect(() => parseApplyArgs(argv)).toThrow(message);
  });

  it("parses the report script flags", () => {
    expect(parseReportArgs([])).toEqual({ json: false, out: undefined });
    expect(parseReportArgs(["--json", "--out", "r.json"])).toEqual({ json: true, out: "r.json" });
    expect(() => parseReportArgs(["--out"])).toThrow("needs a file path");
    expect(() => parseReportArgs(["--apply"])).toThrow("Unknown argument");
  });
});
