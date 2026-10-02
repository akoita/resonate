import {
  candidateFactsFromRow,
  type CrateStemRow,
  type CrateTrackRow,
} from "../modules/crates/crate_candidates";

const NOW = new Date("2026-10-02T12:00:00.000Z");
const FUTURE = new Date("2026-12-01T00:00:00.000Z");
const PAST = new Date("2026-09-01T00:00:00.000Z");

function measuredFeatures(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: "stem-audio-features/v1",
    extractor: { name: "librosa", version: "0.10" },
    sampleRate: 22050,
    durationSeconds: 200,
    tempoBpm: 128,
    tempoConfidence: 0.8,
    beatCount: 400,
    firstBeatSec: 0.4,
    key: { tonic: "A", mode: "minor", confidence: 0.4 },
    energyRms: 0.15,
    onsetDensity: 4,
    camelot: "8A",
    ...overrides,
  };
}

function stem(overrides: Partial<CrateStemRow> = {}): CrateStemRow {
  return {
    type: "drums",
    isCurrent: true,
    audioFeatures: null,
    pricing: null,
    listings: [],
    ...overrides,
  };
}

function row(stems: CrateStemRow[], overrides: Partial<CrateTrackRow> = {}): CrateTrackRow {
  return {
    id: "track-1",
    title: "Track One",
    artist: null,
    aiDisclosureLevel: "NONE",
    contentStatus: "clean",
    rightsRoute: null,
    release: {
      title: "Release",
      status: "published",
      rightsRoute: null,
      withdrawnAt: null,
      withdrawalReason: null,
      genre: "Techno",
      moods: ["dark"],
      artistId: "artist-1",
      primaryArtist: null,
      artist: { displayName: "Artist" },
    },
    stems,
    ...overrides,
  };
}

describe("candidateFactsFromRow", () => {
  it("maps identity, genre, moods and disclosure from the row", () => {
    const facts = candidateFactsFromRow(row([]), new Set(), NOW);
    expect(facts).toMatchObject({
      trackId: "track-1",
      artistId: "artist-1",
      genre: "Techno",
      moods: ["dark"],
      aiDisclosureLevel: "NONE",
      stemTypes: [],
      listedLicenseTypes: [],
      indicativePriceUsd: {},
      verifiedHuman: false,
    });
  });

  it("reads measured tempo, key and energy from the current original stem only", () => {
    const facts = candidateFactsFromRow(
      row([
        stem({ type: "original", audioFeatures: measuredFeatures() }),
        // Another stem's features and a superseded original are ignored.
        stem({ type: "drums", audioFeatures: measuredFeatures({ tempoBpm: 90, camelot: "1B" }) }),
        stem({
          type: "original",
          isCurrent: false,
          audioFeatures: measuredFeatures({ tempoBpm: 70, camelot: "2B" }),
        }),
      ]),
      new Set(),
      NOW,
    );
    expect(facts.tempoBpm).toBe(128);
    expect(facts.camelot).toBe("8A");
    expect(facts.energy).toBe(0.5);
  });

  it("leaves measured features null when there is no original stem or no features", () => {
    const noOriginal = candidateFactsFromRow(
      row([stem({ type: "drums", audioFeatures: measuredFeatures() })]),
      new Set(),
      NOW,
    );
    expect(noOriginal).toMatchObject({ tempoBpm: null, camelot: null, energy: null });

    const noFeatures = candidateFactsFromRow(row([stem({ type: "original" })]), new Set(), NOW);
    expect(noFeatures).toMatchObject({ tempoBpm: null, camelot: null, energy: null });
  });

  it("lists current stem types lower-cased without original and master", () => {
    const facts = candidateFactsFromRow(
      row([
        stem({ type: "original" }),
        stem({ type: "Master" }),
        stem({ type: "VOCALS" }),
        stem({ type: "Drums" }),
        stem({ type: "drums" }),
        stem({ type: "bass", isCurrent: false }),
      ]),
      new Set(),
      NOW,
    );
    expect(facts.stemTypes).toEqual(["drums", "vocals"]);
  });

  it("takes the cheapest price per tier across current non-original stems", () => {
    const facts = candidateFactsFromRow(
      row([
        stem({
          type: "drums",
          pricing: { basePlayPriceUsd: 0.1, remixLicenseUsd: 8, commercialLicenseUsd: 30 },
        }),
        stem({
          type: "vocals",
          pricing: { basePlayPriceUsd: 0.05, remixLicenseUsd: 12, commercialLicenseUsd: 20 },
        }),
        // Original and superseded stems never set a price.
        stem({
          type: "original",
          pricing: { basePlayPriceUsd: 0.01, remixLicenseUsd: 1, commercialLicenseUsd: 1 },
        }),
        stem({
          type: "bass",
          isCurrent: false,
          pricing: { basePlayPriceUsd: 0.01, remixLicenseUsd: 1, commercialLicenseUsd: 1 },
        }),
      ]),
      new Set(),
      NOW,
    );
    expect(facts.indicativePriceUsd).toEqual({ personal: 0.05, remix: 8, commercial: 20 });
  });

  it("omits every tier when no stem has pricing", () => {
    const facts = candidateFactsFromRow(row([stem({ type: "drums" })]), new Set(), NOW);
    expect(facts.indicativePriceUsd).toEqual({});
    expect(Object.keys(facts.indicativePriceUsd)).toHaveLength(0);
  });

  it("keeps a real zero price but drops non-finite and negative ones", () => {
    const facts = candidateFactsFromRow(
      row([
        stem({
          type: "drums",
          pricing: { basePlayPriceUsd: 0, remixLicenseUsd: Number.NaN, commercialLicenseUsd: -1 },
        }),
      ]),
      new Set(),
      NOW,
    );
    expect(facts.indicativePriceUsd).toEqual({ personal: 0 });
  });

  it("lists license tiers from active, unexpired listings only", () => {
    const facts = candidateFactsFromRow(
      row([
        stem({
          type: "drums",
          listings: [
            { licenseType: "remix", status: "active", expiresAt: FUTURE },
            { licenseType: "commercial", status: "sold", expiresAt: FUTURE },
            { licenseType: "personal", status: "cancelled", expiresAt: FUTURE },
            { licenseType: "sync", status: "active", expiresAt: PAST },
          ],
        }),
        stem({
          type: "original",
          listings: [{ licenseType: "Remix", status: "active", expiresAt: FUTURE }],
        }),
        stem({
          type: "bass",
          isCurrent: false,
          listings: [{ licenseType: "broadcast", status: "active", expiresAt: FUTURE }],
        }),
      ]),
      new Set(),
      NOW,
    );
    expect(facts.listedLicenseTypes).toEqual(["remix"]);
  });

  it("marks the artist verified only when they are in the verified set", () => {
    expect(candidateFactsFromRow(row([]), new Set(["artist-1"]), NOW).verifiedHuman).toBe(true);
    expect(candidateFactsFromRow(row([]), new Set(["artist-2"]), NOW).verifiedHuman).toBe(false);
  });

  it("copies moods rather than aliasing the row", () => {
    const source = row([]);
    const facts = candidateFactsFromRow(source, new Set(), NOW);
    facts.moods.push("changed");
    expect(source.release.moods).toEqual(["dark"]);
  });
});
