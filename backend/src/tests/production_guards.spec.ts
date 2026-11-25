import {
  ProductionConfigError,
  assertProductionConfiguration,
  productionConfigViolations,
} from "../config/production_guards";
import { runConfigCheck } from "../scripts/config_check";

/** A production configuration that breaks no rule. */
const GOOD: Record<string, string> = {
  RESONATE_ENVIRONMENT_ID: "prod-1a2b3c4d",
  NODE_ENV: "production",
  JWT_SECRET: "jwt-secret",
  HUMAN_VERIFICATION_PROVIDER: "passport",
  ENCRYPTION_SECRET: "encryption-secret",
  PRIVATE_KEY: "0xaaaa",
  MINT_AUTHORIZER_PRIVATE_KEY: "0xbbbb",
  KMS_PROVIDER: "gcp-kms",
  GCP_KMS_KEY_NAME: "projects/p/locations/l/keyRings/r/cryptoKeys/k",
  STORAGE_PROVIDER: "gcs",
};

function variables(env: Record<string, string | undefined>) {
  return productionConfigViolations(env).map((violation) => violation.variable);
}

describe("production start-up guards (#2660)", () => {
  it("lets a correct production configuration boot", () => {
    expect(productionConfigViolations(GOOD)).toEqual([]);
    expect(() => assertProductionConfiguration(GOOD)).not.toThrow();
  });

  it.each([
    ["no JWT secret", { JWT_SECRET: undefined }, "JWT_SECRET"],
    ["no human verification provider", { HUMAN_VERIFICATION_PROVIDER: undefined }, "HUMAN_VERIFICATION_PROVIDER"],
    ["the mock human verification provider", { HUMAN_VERIFICATION_PROVIDER: "mock" }, "HUMAN_VERIFICATION_PROVIDER"],
    ["no dedicated encryption secret", { ENCRYPTION_SECRET: undefined }, "ENCRYPTION_SECRET"],
    ["an encryption secret equal to the JWT secret", { ENCRYPTION_SECRET: "jwt-secret" }, "ENCRYPTION_SECRET"],
    ["no mint signer, falling back to the deployer key", { MINT_AUTHORIZER_PRIVATE_KEY: undefined }, "MINT_AUTHORIZER_PRIVATE_KEY"],
    ["a mint signer equal to the deployer key", { MINT_AUTHORIZER_PRIVATE_KEY: "AAAA" }, "MINT_AUTHORIZER_PRIVATE_KEY"],
    ["a local agent key provider", { KMS_PROVIDER: "local" }, "KMS_PROVIDER"],
    ["no agent key provider (local by default)", { KMS_PROVIDER: undefined }, "KMS_PROVIDER"],
    ["a managed key service with no key", { GCP_KMS_KEY_NAME: undefined }, "GCP_KMS_KEY_NAME"],
    ["the development login", { AUTH_DEV_LOGIN_ENABLED: "true" }, "AUTH_DEV_LOGIN_ENABLED"],
    ["the development wipe", { ENABLE_DEV_WIPE: "true" }, "ENABLE_DEV_WIPE"],
    ["the sign-up faucet", { SIGNUP_FAUCET_ENABLED: "yes" }, "SIGNUP_FAUCET_ENABLED"],
    ["the legacy sign-up faucet switch", { SIGNUP_SEPOLIA_FAUCET_ENABLED: "1" }, "SIGNUP_SEPOLIA_FAUCET_ENABLED"],
    ["mock authentication", { NEXT_PUBLIC_MOCK_AUTH: "true" }, "NEXT_PUBLIC_MOCK_AUTH"],
    ["plaintext agent keys", { ALLOW_PLAINTEXT_AGENT_KEYS: "true" }, "ALLOW_PLAINTEXT_AGENT_KEYS"],
    ["storage that cannot delete", { STORAGE_PROVIDER: "ipfs" }, "STORAGE_PROVIDER"],
    ["filecoin storage", { STORAGE_PROVIDER: "filecoin" }, "STORAGE_PROVIDER"],
    ["local disk storage (the default)", { STORAGE_PROVIDER: undefined }, "STORAGE_PROVIDER"],
  ])("stops the boot on %s, naming the variable", (_label, change, variable) => {
    const env = { ...GOOD, ...change };
    expect(variables(env)).toEqual([variable]);
    expect(() => assertProductionConfiguration(env)).toThrow(ProductionConfigError);
    expect(() => assertProductionConfiguration(env)).toThrow(new RegExp(`- ${variable} `));
  });

  it("does not require an encryption secret when content encryption is off or not AES", () => {
    expect(variables({ ...GOOD, ENCRYPTION_SECRET: undefined, ENCRYPTION_ENABLED: "false" })).toEqual([]);
    expect(variables({ ...GOOD, ENCRYPTION_SECRET: undefined, ENCRYPTION_PROVIDER: "lit" })).toEqual([]);
  });

  it("lists every problem at once", () => {
    const env = { ...GOOD, JWT_SECRET: undefined, STORAGE_PROVIDER: "local", AUTH_DEV_LOGIN_ENABLED: "true" };
    expect(variables(env)).toEqual(["JWT_SECRET", "AUTH_DEV_LOGIN_ENABLED", "STORAGE_PROVIDER"]);
    expect(() => assertProductionConfiguration(env)).toThrow(/3 configuration problems/);
  });

  it("keeps today's behaviour outside production, staging included", () => {
    const developmentDefaults = { NODE_ENV: "production", AUTH_DEV_LOGIN_ENABLED: "true" };
    expect(() => assertProductionConfiguration({ ...developmentDefaults, RESONATE_ENVIRONMENT_ID: "staging-1a2b3c4d" })).not.toThrow();
    expect(() => assertProductionConfiguration({ ...developmentDefaults, RESONATE_ENVIRONMENT_ID: "dev-1a2b3c4d" })).not.toThrow();
    expect(() => assertProductionConfiguration({ NODE_ENV: "test" })).not.toThrow();
    expect(() => assertProductionConfiguration({})).not.toThrow();
  });
});

describe("config:check script (#2660)", () => {
  it("checks the production rules when asked, whatever the current tier", () => {
    const result = runConfigCheck(["--env", "production"], { RESONATE_ENVIRONMENT_ID: "staging-x" });
    expect(result.code).toBe(1);
    expect(result.output).toMatch(/- HUMAN_VERIFICATION_PROVIDER /);
    expect(runConfigCheck(["--env", "production"], GOOD)).toEqual({ code: 0, output: "Production configuration check passed." });
  });

  it("follows the deployment tier without a flag", () => {
    expect(runConfigCheck([], { RESONATE_ENVIRONMENT_ID: "staging-x" }).code).toBe(0);
    expect(runConfigCheck([], { RESONATE_ENVIRONMENT_ID: "prod-x" }).code).toBe(1);
  });
});
