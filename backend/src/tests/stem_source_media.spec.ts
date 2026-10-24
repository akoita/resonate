/**
 * Stem source, delivered format and plain license terms (#1976, ADR-TE-7).
 */
import { plainLicenseTerms, STEM_LICENSE_PLAIN_TERMS } from "../modules/contracts/stem_license_tier";
import {
  isLosslessStemMime,
  knownStemFileExtension,
  mimeTypeForExtension,
  rekordboxKind,
  stemContentType,
  stemDownloadFileName,
  stemFileExtension,
} from "../modules/shared/stem-media";
import {
  DEFAULT_SEPARATION_MODEL,
  isMixStemType,
  isStemSource,
  resolveStemSource,
  stemSourceFacts,
  stemSourceFields,
  stemSourceLabel,
} from "../modules/shared/stem-source";

describe("stem source", () => {
  it("labels the two sources Official and Separated (AI)", () => {
    expect(stemSourceLabel({ type: "vocals", source: "official" })).toBe("Official");
    expect(stemSourceLabel({ type: "vocals", source: "separated" })).toBe("Separated (AI)");
  });

  it("gives the full-mix rows no source and treats a legacy stem as separated", () => {
    expect(resolveStemSource({ type: "original", source: null })).toBeNull();
    expect(resolveStemSource({ type: "MASTER", source: "official" })).toBeNull();
    expect(resolveStemSource({ type: "drums", source: null })).toBe("separated");
    expect(resolveStemSource({ type: "drums", source: "junk" })).toBe("separated");
    expect(isMixStemType("Original")).toBe(true);
    expect(isStemSource("official")).toBe(true);
    expect(isStemSource("other")).toBe(false);
  });

  it("names the separation model of a separated stem and none for an official one", () => {
    expect(stemSourceFacts({ type: "bass", source: "separated", separationModel: "demucs-htdemucs-6s" })).toEqual(
      expect.objectContaining({ source: "separated", separationModel: "demucs-htdemucs-6s", lossless: false }),
    );
    expect(stemSourceFacts({ type: "bass", source: "separated" })?.separationModel).toBe(DEFAULT_SEPARATION_MODEL);
    expect(stemSourceFacts({ type: "bass", source: "official", separationModel: "ignored" })).toEqual(
      expect.objectContaining({ source: "official", separationModel: null, lossless: true, label: "Official" }),
    );
    expect(stemSourceFacts({ type: "original" })).toBeNull();
  });

  it("flattens the source for listings and stem pages", () => {
    expect(stemSourceFields({ type: "vocals", source: "official", mimeType: "audio/flac" })).toEqual({
      source: "official",
      sourceLabel: "Official",
      separationModel: null,
      lossless: true,
      mimeType: "audio/flac",
    });
    expect(stemSourceFields({ type: "original", mimeType: "audio/mpeg" }).source).toBeNull();
  });
});

describe("stem media", () => {
  it("serves the stored format, defaulting to MP3", () => {
    expect(stemContentType("audio/wav")).toBe("audio/wav");
    expect(stemContentType("audio/flac; charset=binary")).toBe("audio/flac");
    expect(stemContentType(null)).toBe("audio/mpeg");
    expect(stemContentType("application/octet-stream")).toBe("audio/mpeg");
    expect(stemFileExtension("audio/x-wav")).toBe("wav");
    expect(stemFileExtension("audio/flac")).toBe("flac");
    expect(stemFileExtension(undefined)).toBe("mp3");
    expect(knownStemFileExtension("audio/flac")).toBe("flac");
    expect(knownStemFileExtension("text/plain")).toBeNull();
    expect(mimeTypeForExtension(".WAV")).toBe("audio/wav");
    expect(mimeTypeForExtension("txt")).toBeNull();
  });

  it("names a download after its stored format and strips unsafe characters", () => {
    expect(stemDownloadFileName({ title: "Hook Vocals", type: "vocals", mimeType: "audio/wav" })).toBe("Hook Vocals.wav");
    expect(stemDownloadFileName({ type: "drums", mimeType: "audio/flac" })).toBe("drums.flac");
    expect(stemDownloadFileName({ type: "drums" })).toBe("drums.mp3");
    expect(stemDownloadFileName({ title: 'a/b\\c:"d"\n', mimeType: "audio/mpeg" })).toBe("a b c d.mp3");
    expect(stemDownloadFileName({ title: "///" })).toBe("stem.mp3");
  });

  it("tells rekordbox the kind of file and which formats are lossless", () => {
    expect(rekordboxKind("audio/wav")).toBe("WAV File");
    expect(rekordboxKind("audio/flac")).toBe("FLAC File");
    expect(rekordboxKind("audio/mpeg")).toBe("MP3 File");
    expect(rekordboxKind(null)).toBe("MP3 File");
    expect(isLosslessStemMime("audio/wav")).toBe(true);
    expect(isLosslessStemMime("audio/mpeg")).toBe(false);
  });
});

describe("plain license terms", () => {
  it("has plain words for the three standard tiers and none for the others", () => {
    for (const tier of ["personal", "remix", "commercial"] as const) {
      expect(plainLicenseTerms(tier)).toBe(STEM_LICENSE_PLAIN_TERMS[tier]);
      expect(STEM_LICENSE_PLAIN_TERMS[tier].length).toBeGreaterThan(40);
    }
    expect(plainLicenseTerms("sync")).toBeNull();
    expect(plainLicenseTerms(undefined)).toBeNull();
  });
});
