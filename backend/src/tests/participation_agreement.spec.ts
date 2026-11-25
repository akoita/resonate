import {
  PLACEHOLDER_AGREEMENT_VERSION,
  loadParticipationAgreement,
  placeholderRefused,
} from "../modules/participation/participation_agreement";

/**
 * The placeholder agreement may be accepted everywhere except production.
 * Every container image sets NODE_ENV=production, so the deployment identity
 * decides, and an unlabeled production process fails closed.
 */
describe("participation agreement placeholder", () => {
  const env = (vars: Record<string, string>) => vars as NodeJS.ProcessEnv;

  it("lets artists accept the placeholder on staging, whose image runs NODE_ENV=production", () => {
    const staging = env({ NODE_ENV: "production", RESONATE_ENVIRONMENT_ID: "staging-1a2b3c4d" });
    expect(placeholderRefused(staging)).toBe(false);
    const agreement = loadParticipationAgreement(staging);
    expect(agreement.placeholder).toBe(true);
    expect(agreement.version).toBe(PLACEHOLDER_AGREEMENT_VERSION);
    expect(agreement.available).toBe(true);
  });

  it("lets artists accept it on dev and local runs", () => {
    expect(placeholderRefused(env({ NODE_ENV: "production", RESONATE_ENVIRONMENT_ID: "dev-1a2b3c4d" }))).toBe(false);
    expect(placeholderRefused(env({ NODE_ENV: "development" }))).toBe(false);
    expect(placeholderRefused(env({}))).toBe(false);
  });

  it("refuses it in a production-tier deployment", () => {
    const prod = env({ NODE_ENV: "production", RESONATE_ENVIRONMENT_ID: "prod-1a2b3c4d" });
    expect(placeholderRefused(prod)).toBe(true);
    expect(loadParticipationAgreement(prod).available).toBe(false);
  });

  it("fails closed for a production process with no deployment identity", () => {
    const unlabeled = env({ NODE_ENV: "production" });
    expect(placeholderRefused(unlabeled)).toBe(true);
    expect(loadParticipationAgreement(unlabeled).available).toBe(false);
  });
});
