import {
  assertSceneScoutAcceptanceMutationRequirements,
  assertSceneScoutAcceptanceStagingEnvironment,
  parseSceneScoutAcceptanceArgs,
  planSceneScoutAcceptanceUnmetGap,
  sceneScoutAcceptanceCrateRequestId,
  sceneScoutAcceptanceEventId,
  sceneScoutAcceptanceMarkerEventId,
  sceneScoutAcceptancePrefix,
  sceneScoutAcceptanceUserId,
  type SceneScoutAcceptanceInvocation,
} from "../scripts/scene_scout_acceptance_support";
import type { CrateCandidateFacts } from "../modules/crates/crate.types";
import { deriveCrateUnmetDemand } from "../modules/scene_scout/unmet_demand.derivation";

const REQUIRED_ARGS = [
  "--artist-id", "artist_1",
  "--release-id", "release_1",
  "--run-id", "run-1",
  "--city-slug", "Montréal",
  "--country-code", "ca",
];

function invocation(args: string[] = REQUIRED_ARGS): SceneScoutAcceptanceInvocation {
  return parseSceneScoutAcceptanceArgs(args);
}

describe("Scene Scout acceptance CLI support", () => {
  describe("argument parsing", () => {
    it("defaults to a read-only preview and the catalog artist's first track", () => {
      expect(invocation()).toEqual({
        phase: "preview",
        artistId: "artist_1",
        releaseId: "release_1",
        showArtistId: "artist_1",
        trackId: undefined,
        runId: "run-1",
        citySlug: "montreal",
        countryCode: "CA",
        confirm: false,
      });
    });

    it("parses explicit phase, reviewed Shows artist, track, and confirmation", () => {
      expect(invocation([
        "seed",
        ...REQUIRED_ARGS,
        "--show-artist-id", " credited_artist ",
        "--track-id", " track_1 ",
        "--confirm",
      ])).toMatchObject({
        phase: "seed",
        artistId: "artist_1",
        releaseId: "release_1",
        showArtistId: "credited_artist",
        trackId: "track_1",
        runId: "run-1",
        citySlug: "montreal",
        countryCode: "CA",
        confirm: true,
      });
    });

    it.each(["withdraw-consent", "erase-listener", "unmet-demand", "access-check"] as const)(
      "parses the %s scenario phase with the shared target arguments",
      (phase) => {
        expect(invocation([phase, ...REQUIRED_ARGS, "--confirm"])).toMatchObject({
          phase,
          artistId: "artist_1",
          releaseId: "release_1",
          runId: "run-1",
          confirm: true,
        });
        expect(() => invocation([phase, ...REQUIRED_ARGS.slice(0, -2)])).toThrow(/Missing required flag --country-code/);
      },
    );

    it("rejects unknown phases that resemble scenario names", () => {
      expect(() => invocation(["withdraw", ...REQUIRED_ARGS])).toThrow(/Unknown phase withdraw/);
      expect(() => invocation(["erase", ...REQUIRED_ARGS])).toThrow(/Unknown phase erase/);
    });

    it("rejects unknown, duplicate, and missing flags", () => {
      expect(() => invocation([...REQUIRED_ARGS, "--unknown"])).toThrow(/Unknown flag/);
      expect(() => invocation([...REQUIRED_ARGS, "--artist-id", "artist_2"])).toThrow(/Duplicate flag --artist-id/);
      expect(() => invocation(REQUIRED_ARGS.slice(0, -2))).toThrow(/Missing required flag --country-code/);
      expect(() => invocation([...REQUIRED_ARGS, "--confirm", "--confirm"])).toThrow(/Duplicate flag --confirm/);
    });

    it("rejects empty identifiers after trimming and invalid run ids", () => {
      for (const [flag, expected] of [
        ["--artist-id", /artist-id must not be empty/],
        ["--release-id", /release-id must not be empty/],
        ["--show-artist-id", /show-artist-id must not be empty/],
        ["--track-id", /track-id must not be empty/],
      ] as const) {
        const args = [...REQUIRED_ARGS];
        const index = args.indexOf(flag);
        if (index >= 0) args[index + 1] = "   ";
        else args.push(flag, "   ");
        expect(() => invocation(args)).toThrow(expected);
      }

      for (const runId of ["Upper", "has space", "a".repeat(25), "-starts-with-hyphen"]) {
        const args = [...REQUIRED_ARGS];
        args[args.indexOf("--run-id") + 1] = runId;
        expect(() => invocation(args)).toThrow(/--run-id must start/);
      }
      expect(() => invocation([...REQUIRED_ARGS.slice(0, REQUIRED_ARGS.indexOf("--run-id") + 1)])).toThrow(/--run-id requires a value/);
    });

    it("rejects malformed city and country values", () => {
      const invalidCity = [...REQUIRED_ARGS];
      invalidCity[invalidCity.indexOf("--city-slug") + 1] = "!!!";
      expect(() => invocation(invalidCity)).toThrow(/valid city geo dimension/);

      const invalidCountry = [...REQUIRED_ARGS];
      invalidCountry[invalidCountry.indexOf("--country-code") + 1] = "USA";
      expect(() => invocation(invalidCountry)).toThrow(/valid city geo dimension/);
    });
  });

  describe("staging guard", () => {
    it("accepts explicit staging identities even when Node runs in production mode", () => {
      expect(() => assertSceneScoutAcceptanceStagingEnvironment({
        RESONATE_ENVIRONMENT_ID: "staging-epoch",
        DEPLOY_ENV: "staging-epoch",
        APP_ENV: "staging-epoch",
        NODE_ENV: "production",
      })).not.toThrow();

      for (const value of ["staging", "stage", "stg", "staging-epoch"]) {
        expect(() => assertSceneScoutAcceptanceStagingEnvironment({ APP_ENV: value })).not.toThrow();
      }
    });

    it("fails closed for absent, unknown, non-staging, and mixed labels", () => {
      expect(() => assertSceneScoutAcceptanceStagingEnvironment({})).toThrow(/at least one staging environment label/);
      expect(() => assertSceneScoutAcceptanceStagingEnvironment({ RESONATE_ENVIRONMENT_ID: "preview" })).toThrow(/must resolve to staging/);

      for (const value of ["production", "prod", "prd", "live", "local", "test", "testing", "integration", "dev", "development"]) {
        expect(() => assertSceneScoutAcceptanceStagingEnvironment({ RESONATE_ENVIRONMENT_ID: value })).toThrow(/non-staging environment/);
      }

      for (const conflictingLabel of ["prod-staging", "staging-prod", "live-staging", "staging-live"]) {
        expect(() => assertSceneScoutAcceptanceStagingEnvironment({
          RESONATE_ENVIRONMENT_ID: "staging-epoch",
          DEPLOY_ENV: conflictingLabel,
        })).toThrow(/non-staging environment/);
      }
      expect(() => assertSceneScoutAcceptanceStagingEnvironment({
        RESONATE_ENVIRONMENT_ID: "staging-epoch",
        APP_ENV: "unknown-environment",
      })).toThrow(/must resolve to staging/);
    });
  });

  describe("mutation guard", () => {
    it("allows preview without confirmation or a configured salt", () => {
      expect(() => assertSceneScoutAcceptanceMutationRequirements(
        { phase: "preview", confirm: false },
        {},
      )).not.toThrow();
    });

    it("allows the read-only access check without confirmation or a configured salt", () => {
      expect(() => assertSceneScoutAcceptanceMutationRequirements(
        { phase: "access-check", confirm: false },
        {},
      )).not.toThrow();
    });

    it.each(["seed", "verify", "withdraw-consent", "erase-listener", "unmet-demand", "cleanup"] as const)("requires confirmation and salt for %s", (phase) => {
      expect(() => assertSceneScoutAcceptanceMutationRequirements(
        { phase, confirm: false },
        { ANALYTICS_ACTOR_ID_SALT: "test-salt" },
      )).toThrow(/requires --confirm/);
      expect(() => assertSceneScoutAcceptanceMutationRequirements(
        { phase, confirm: true },
        {},
      )).toThrow(/ANALYTICS_ACTOR_ID_SALT is required/);
      expect(() => assertSceneScoutAcceptanceMutationRequirements(
        { phase, confirm: true },
        { ANALYTICS_ACTOR_ID_SALT: "test-salt" },
      )).not.toThrow();
    });
  });

  describe("fixture namespace", () => {
    it("binds a stable run namespace to every target and city selector", () => {
      const base = invocation();
      const prefix = sceneScoutAcceptancePrefix(base);
      expect(prefix).toMatch(/^scaccept_run-1_[0-9a-f]{12}_$/);
      expect(sceneScoutAcceptancePrefix(base)).toBe(prefix);

      const selectorChanges: Array<Partial<SceneScoutAcceptanceInvocation>> = [
        { artistId: "other_artist" },
        { releaseId: "other_release" },
        { showArtistId: "other_show_artist" },
        { trackId: "other_track" },
        { citySlug: "ottawa" },
        { countryCode: "US" },
      ];
      for (const change of selectorChanges) {
        expect(sceneScoutAcceptancePrefix({ ...base, ...change })).not.toBe(prefix);
      }
      expect(sceneScoutAcceptancePrefix({ ...base, runId: "run-2" })).not.toBe(prefix);
    });

    it("creates deterministic, ordinal-specific user and event markers", () => {
      const prefix = sceneScoutAcceptancePrefix(invocation());
      expect(sceneScoutAcceptanceUserId(prefix, 0)).toBe(`${prefix}user_00`);
      expect(sceneScoutAcceptanceUserId(prefix, 7)).toBe(`${prefix}user_07`);
      expect(sceneScoutAcceptanceEventId(prefix, 7, "playback_completed")).toBe(`${prefix}event_07_playback_completed`);
      expect(sceneScoutAcceptanceEventId(prefix, 7, "library_saved")).toBe(`${prefix}event_07_library_saved`);
      expect(sceneScoutAcceptanceMarkerEventId(prefix, 1, "erased_account")).toBe(`${prefix}marker_01_erased_account`);
      expect(sceneScoutAcceptanceCrateRequestId(prefix, 2)).toBe(`${prefix}crate_request_02`);
    });
  });
});

describe("Scene Scout acceptance unmet-demand gap planning", () => {
  const ALL_STEMS = ["bass", "drums", "guitar", "other", "piano", "vocals"];

  function facts(overrides: Partial<CrateCandidateFacts> = {}): CrateCandidateFacts {
    return {
      trackId: "track_1",
      artistId: "artist_1",
      genre: null,
      moods: [],
      aiDisclosureLevel: "none",
      tempoBpm: null,
      camelot: null,
      energy: null,
      stemTypes: ALL_STEMS,
      listedLicenseTypes: [],
      indicativePriceUsd: {},
      verifiedHuman: false,
      ...overrides,
    };
  }

  it("prefers the first stem type the track lacks, as a track-level gap", () => {
    const plan = planSceneScoutAcceptanceUnmetGap(facts({ stemTypes: ["bass"], tempoBpm: 124 }));
    expect(plan.gap).toMatchObject({ kind: "stem", targetType: "track" });
    expect(plan.gap?.filters.requiredStems).toHaveLength(1);
    expect(plan.gap?.value).toBe(plan.gap?.filters.requiredStems[0]);
  });

  it("falls back to a BPM bin excluding a fully stemmed track's tempo, as an artist-level gap", () => {
    expect(planSceneScoutAcceptanceUnmetGap(facts({ tempoBpm: 124 })).gap).toMatchObject({
      kind: "bpm",
      targetType: "artist",
      value: "180–189 BPM",
    });
    expect(planSceneScoutAcceptanceUnmetGap(facts({ tempoBpm: 185 })).gap).toMatchObject({
      kind: "bpm",
      value: "80–89 BPM",
    });
  });

  it("falls back to the opposite Camelot key, never the track's key or a neighbour, when tempo is unknown", () => {
    expect(planSceneScoutAcceptanceUnmetGap(facts({ camelot: "8A", energy: 0.5 })).gap).toMatchObject({
      kind: "key",
      targetType: "artist",
      value: "2A",
    });
    expect(planSceneScoutAcceptanceUnmetGap(facts({ camelot: "2B" })).gap).toMatchObject({ kind: "key", value: "8B" });
  });

  it("falls back to an energy band excluding the track's energy as the last categorical choice", () => {
    expect(planSceneScoutAcceptanceUnmetGap(facts({ energy: 0.7 })).gap).toMatchObject({ kind: "energy", value: "low" });
    expect(planSceneScoutAcceptanceUnmetGap(facts({ energy: 0.2 })).gap).toMatchObject({ kind: "energy", value: "high" });
  });

  it("blocks a fully stemmed track with no measured tempo, key, or energy", () => {
    const plan = planSceneScoutAcceptanceUnmetGap(facts());
    expect(plan.gap).toBeUndefined();
    expect(plan.blocked).toMatch(/every crate stem type and no measured tempo, key, or energy/);
  });

  it("blocks a fully AI-generated track even when a gap would otherwise exist", () => {
    const plan = planSceneScoutAcceptanceUnmetGap(facts({ aiDisclosureLevel: "ALL", stemTypes: [], tempoBpm: 124 }));
    expect(plan.gap).toBeUndefined();
    expect(plan.blocked).toMatch(/fully AI-generated/);
  });

  it("only plans filters the track fails alone, so exactly one near-match draft is attributed to its artist", () => {
    for (const candidate of [
      facts({ tempoBpm: 124 }),
      facts({ camelot: "8A" }),
      facts({ energy: 0.5 }),
      facts({ stemTypes: [] }),
    ]) {
      const plan = planSceneScoutAcceptanceUnmetGap(candidate);
      const gap = plan.gap;
      expect(gap).toBeDefined();
      const derivation = deriveCrateUnmetDemand({ filters: gap!.filters, considered: [candidate], coverage: gap!.coverage });
      expect(derivation.candidates).toEqual([
        { targetType: gap!.targetType, candidateTrackId: "track_1", kind: gap!.kind, value: gap!.value },
      ]);
    }
  });
});
