import type { CrateCandidateFacts } from "../modules/crates/crate.types";
import {
  CRATE_LICENSE_RIGHTS,
  crateLicenseOptions,
  crateTierRights,
} from "../modules/crates/crate_license_rights";

function facts(overrides: Partial<CrateCandidateFacts> = {}): CrateCandidateFacts {
  return {
    trackId: "t1",
    artistId: "a1",
    genre: null,
    moods: [],
    aiDisclosureLevel: null,
    tempoBpm: null,
    camelot: null,
    energy: null,
    stemTypes: [],
    listedLicenseTypes: [],
    indicativePriceUsd: {},
    verifiedHuman: false,
    ...overrides,
  };
}

describe("CRATE_LICENSE_RIGHTS", () => {
  it("uses the buy flow's wording for the three standard tiers", () => {
    expect(CRATE_LICENSE_RIGHTS.personal).toEqual(["Stream & collect — personal listening"]);
    expect(CRATE_LICENSE_RIGHTS.remix).toEqual([
      "Use in derivative works, publish remixes",
      "Includes personal rights",
    ]);
    expect(CRATE_LICENSE_RIGHTS.commercial).toEqual([
      "Ads, films, products, monetized content",
      "Includes remix and personal rights",
    ]);
  });

  it("has no wording for sync, sample or broadcast", () => {
    expect(Object.keys(CRATE_LICENSE_RIGHTS).sort()).toEqual(["commercial", "personal", "remix"]);
  });
});

describe("crateLicenseOptions", () => {
  it("is empty for a track that lists and prices nothing", () => {
    expect(crateLicenseOptions(facts())).toEqual([]);
  });

  it("reports one option per priced standard tier with its grants", () => {
    const options = crateLicenseOptions(
      facts({ indicativePriceUsd: { personal: 0.05, remix: 8, commercial: 20 } }),
    );
    expect(options).toEqual([
      {
        licenseType: "personal",
        listed: false,
        indicativePriceUsd: 0.05,
        standardTerms: true,
        grants: [...CRATE_LICENSE_RIGHTS.personal],
      },
      {
        licenseType: "remix",
        listed: false,
        indicativePriceUsd: 8,
        standardTerms: true,
        grants: [...CRATE_LICENSE_RIGHTS.remix],
      },
      {
        licenseType: "commercial",
        listed: false,
        indicativePriceUsd: 20,
        standardTerms: true,
        grants: [...CRATE_LICENSE_RIGHTS.commercial],
      },
    ]);
  });

  it("includes a listed tier with no price, with a null price", () => {
    const options = crateLicenseOptions(facts({ listedLicenseTypes: ["remix"] }));
    expect(options).toEqual([
      {
        licenseType: "remix",
        listed: true,
        indicativePriceUsd: null,
        standardTerms: true,
        grants: [...CRATE_LICENSE_RIGHTS.remix],
      },
    ]);
  });

  it("matches listed tiers case-insensitively", () => {
    const [option] = crateLicenseOptions(facts({ listedLicenseTypes: ["COMMERCIAL"] }));
    expect(option).toMatchObject({ licenseType: "commercial", listed: true });
  });

  it.each(["sync", "sample", "broadcast"] as const)(
    "%s has no standard terms and no grants",
    (tier) => {
      const [option] = crateLicenseOptions(facts({ listedLicenseTypes: [tier] }));
      expect(option).toEqual({
        licenseType: tier,
        listed: true,
        indicativePriceUsd: null,
        standardTerms: false,
        grants: [],
      });
    },
  );

  it("returns the options in license-tier order whatever the input order", () => {
    const options = crateLicenseOptions(
      facts({
        listedLicenseTypes: ["broadcast", "sync", "remix"],
        indicativePriceUsd: { commercial: 20, personal: 1 },
      }),
    );
    expect(options.map((option) => option.licenseType)).toEqual([
      "personal",
      "remix",
      "commercial",
      "sync",
      "broadcast",
    ]);
  });

  it("does not let callers mutate the shared grants", () => {
    const [option] = crateLicenseOptions(facts({ listedLicenseTypes: ["personal"] }));
    option.grants.push("extra");
    expect(CRATE_LICENSE_RIGHTS.personal).toHaveLength(1);
  });
});

describe("crateTierRights", () => {
  it("gives the standard tiers their grants and the others none", () => {
    expect(crateTierRights("remix")).toEqual({
      licenseType: "remix",
      standardTerms: true,
      grants: [...CRATE_LICENSE_RIGHTS.remix],
    });
    expect(crateTierRights("sync")).toEqual({ licenseType: "sync", standardTerms: false, grants: [] });
  });

  it("does not let callers mutate the shared grants", () => {
    crateTierRights("personal").grants.push("extra");
    expect(CRATE_LICENSE_RIGHTS.personal).toHaveLength(1);
  });
});
