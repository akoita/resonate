import {
  PRODUCT_SURFACES,
  PRODUCT_SURFACE_NAMES,
  SURFACE_DISABLED_CODE,
  SurfaceDisabledException,
  assertSurfaceEnabled,
  isProductionEnvironment,
  isRemixGenerationEnabled,
  isSurfaceEnabled,
  resolveProductSurfaces,
} from "../config/product_surfaces";

describe("product surface switches (#2658)", () => {
  it("defaults every surface on outside production", () => {
    for (const env of [{}, { RESONATE_ENVIRONMENT_ID: "staging" }, { RESONATE_ENVIRONMENT_ID: "local" }, { NODE_ENV: "production" }]) {
      expect(Object.values(resolveProductSurfaces(env))).toEqual(PRODUCT_SURFACE_NAMES.map(() => true));
    }
  });

  it("does not treat NODE_ENV=production as a production deployment", () => {
    expect(isProductionEnvironment({ NODE_ENV: "production", RESONATE_ENVIRONMENT_ID: "staging" })).toBe(false);
  });

  it("defaults every surface off in production", () => {
    for (const id of ["prod", "production", "resonate-prod"]) {
      expect(Object.values(resolveProductSurfaces({ RESONATE_ENVIRONMENT_ID: id }))).toEqual(
        PRODUCT_SURFACE_NAMES.map(() => false),
      );
    }
  });

  it.each(PRODUCT_SURFACE_NAMES)("lets %s be switched explicitly in either direction", (surface) => {
    const variable = PRODUCT_SURFACES[surface].env;
    expect(isSurfaceEnabled(surface, { RESONATE_ENVIRONMENT_ID: "prod", [variable]: "true" })).toBe(true);
    expect(isSurfaceEnabled(surface, { RESONATE_ENVIRONMENT_ID: "staging", [variable]: "false" })).toBe(false);
  });

  it("fails closed on an unreadable value", () => {
    expect(isSurfaceEnabled("wallet", { WALLET_ENABLED: "maybe" })).toBe(false);
  });

  it.each(PRODUCT_SURFACE_NAMES)("refuses %s with a typed 403 when off", (surface) => {
    const env = { [PRODUCT_SURFACES[surface].env]: "false" };
    let caught: unknown;
    try {
      assertSurfaceEnabled(surface, env);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(SurfaceDisabledException);
    const exception = caught as SurfaceDisabledException;
    expect(exception.getStatus()).toBe(403);
    expect(exception.getResponse()).toMatchObject({ code: SURFACE_DISABLED_CODE, surface });
  });

  it("gates prompted remix generation on both the provider and the AI surface", () => {
    expect(isRemixGenerationEnabled({ REMIX_GENERATION_ENABLED: "true" })).toBe(true);
    expect(isRemixGenerationEnabled({ REMIX_GENERATION_ENABLED: "true", AI_GENERATION_ENABLED: "false" })).toBe(false);
    expect(isRemixGenerationEnabled({ AI_GENERATION_ENABLED: "true" })).toBe(false);
    expect(isRemixGenerationEnabled({ REMIX_GENERATION_ENABLED: "true", RESONATE_ENVIRONMENT_ID: "prod" })).toBe(false);
  });
});
