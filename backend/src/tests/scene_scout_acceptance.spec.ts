import {
  assertSceneScoutAcceptanceMutationRequirements,
  assertSceneScoutAcceptanceStagingEnvironment,
  parseSceneScoutAcceptanceArgs,
  sceneScoutAcceptanceEventId,
  sceneScoutAcceptancePrefix,
  sceneScoutAcceptanceUserId,
  type SceneScoutAcceptanceInvocation,
} from "../scripts/scene_scout_acceptance_support";

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

    it.each(["seed", "verify", "cleanup"] as const)("requires confirmation and salt for %s", (phase) => {
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
    });
  });
});
