import {
  assertAnalyticsActorIdSaltConfiguration,
  pseudonymousAnalyticsActorId,
  resolveAnalyticsActorIdSalt,
} from "../modules/analytics/analytics_identity";

describe("analytics actor identity salt", () => {
  const originalEnvironment = process.env;

  afterEach(() => {
    process.env = originalEnvironment;
  });

  it("uses the dedicated stable salt when configured", () => {
    expect(
      resolveAnalyticsActorIdSalt({
        NODE_ENV: "production",
        ANALYTICS_ACTOR_ID_SALT: "stable-analytics-salt",
        JWT_SECRET: "rotatable-auth-secret",
      }),
    ).toEqual({
      salt: "stable-analytics-salt",
      source: "analytics_actor_id_salt",
      insecureFallbackAllowed: false,
    });
  });

  it("fails closed in production when the dedicated salt is absent", () => {
    expect(() =>
      resolveAnalyticsActorIdSalt({
        NODE_ENV: "production",
        JWT_SECRET: "must-not-be-used-silently",
      }),
    ).toThrow("ANALYTICS_ACTOR_ID_SALT is required outside local development");
  });

  it("fails closed for a named shared environment even when NODE_ENV is not production", () => {
    expect(() =>
      resolveAnalyticsActorIdSalt({
        NODE_ENV: "development",
        RESONATE_ENVIRONMENT_ID: "staging",
        JWT_SECRET: "must-not-be-used-silently",
      }),
    ).toThrow("ANALYTICS_ACTOR_ID_SALT is required outside local development");
  });

  it("uses the canonical environment identity instead of NODE_ENV for local containers", () => {
    expect(
      resolveAnalyticsActorIdSalt({
        NODE_ENV: "production",
        RESONATE_ENVIRONMENT_ID: "local",
      }),
    ).toMatchObject({
      source: "local_default",
      insecureFallbackAllowed: false,
    });
  });

  it("allows and reports the existing fallback in local development", () => {
    const warn = jest.fn();
    const resolution = assertAnalyticsActorIdSaltConfiguration(
      { NODE_ENV: "development", JWT_SECRET: "local-auth-secret" },
      warn,
    );

    expect(resolution.source).toBe("jwt_secret");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("for local development"));
  });

  it("requires an explicit opt-out to retain the fallback in production", () => {
    const warn = jest.fn();
    const resolution = assertAnalyticsActorIdSaltConfiguration(
      {
        NODE_ENV: "production",
        ANALYTICS_ACTOR_ID_SALT_ALLOW_INSECURE_FALLBACK: "true",
        JWT_SECRET: "temporary-compatibility-secret",
      },
      warn,
    );

    expect(resolution).toMatchObject({
      source: "jwt_secret",
      insecureFallbackAllowed: true,
    });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("explicit insecure compatibility exception"),
    );
  });

  it("derives stable ids from the dedicated salt without exposing it", () => {
    process.env = {
      ...originalEnvironment,
      NODE_ENV: "production",
      ANALYTICS_ACTOR_ID_SALT: "stable-analytics-salt",
      JWT_SECRET: "first-auth-secret",
    };
    const first = pseudonymousAnalyticsActorId("0xABC");
    process.env.JWT_SECRET = "rotated-auth-secret";

    expect(pseudonymousAnalyticsActorId("0xabc")).toBe(first);
    expect(first).toMatch(/^user_[0-9a-f]{32}$/);
    expect(first).not.toContain("stable-analytics-salt");
  });
});
