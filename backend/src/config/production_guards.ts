import { isProductionEnvironment } from "./product_surfaces";

/**
 * Production start-up guards (#2660).
 *
 * Several modules fall back to a development default when a setting is
 * missing: a mock human-verification provider, an encryption key derived from
 * the JWT secret, the deployer key signing mint authorisations, agent keys
 * wrapped by a key held in the environment, development tools left on, or a
 * storage provider that cannot delete audio. That is convenient locally and
 * wrong in production, where the service must refuse to start and say why.
 *
 * The check runs only in a production-tier deployment (`RESONATE_ENVIRONMENT_ID`
 * names a `prod` tier), so staging, development and tests keep today's
 * behaviour. The same rules back `npm run config:check -- --env production`,
 * which a deploy pipeline can run before rollout.
 */
export type ConfigViolation = {
  /** The variable to set or change. */
  variable: string;
  message: string;
};

type Env = Record<string, string | undefined>;

function value(env: Env, key: string): string {
  return (env[key] ?? "").trim();
}

function isOn(raw: string): boolean {
  return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
}

function normalizeKey(raw: string): string {
  const key = raw.toLowerCase();
  return key.startsWith("0x") ? key.slice(2) : key;
}

/** Human verification providers that check a real person. */
const REAL_HUMAN_VERIFICATION_PROVIDERS = ["passport", "worldcoin"];

/** Development tools that must be off in production. */
const DEVELOPMENT_SWITCHES: Array<{ variable: string; what: string }> = [
  { variable: "AUTH_DEV_LOGIN_ENABLED", what: "the development login" },
  { variable: "ENABLE_DEV_WIPE", what: "the development data wipe" },
  { variable: "SIGNUP_FAUCET_ENABLED", what: "the sign-up test-token faucet" },
  { variable: "SIGNUP_SEPOLIA_FAUCET_ENABLED", what: "the sign-up test-token faucet" },
  { variable: "NEXT_PUBLIC_MOCK_AUTH", what: "mock authentication" },
  { variable: "ALLOW_PLAINTEXT_AGENT_KEYS", what: "plaintext agent keys" },
];

/**
 * Every rule a production configuration breaks, in a stable order. Pure: it
 * reads only the given variables and never the deployment tier.
 */
export function productionConfigViolations(env: Env = process.env): ConfigViolation[] {
  const violations: ConfigViolation[] = [];

  if (!value(env, "JWT_SECRET")) {
    violations.push({ variable: "JWT_SECRET", message: "is not set; sessions would be signed with a development secret." });
  }

  const humanVerification = value(env, "HUMAN_VERIFICATION_PROVIDER").toLowerCase();
  if (!REAL_HUMAN_VERIFICATION_PROVIDERS.includes(humanVerification)) {
    violations.push({
      variable: "HUMAN_VERIFICATION_PROVIDER",
      message: humanVerification
        ? `is "${humanVerification}"; set it to ${REAL_HUMAN_VERIFICATION_PROVIDERS.join(" or ")}.`
        : `is not set, so the mock provider passes everyone; set it to ${REAL_HUMAN_VERIFICATION_PROVIDERS.join(" or ")}.`,
    });
  }

  const encryptionOn = value(env, "ENCRYPTION_ENABLED").toLowerCase() !== "false";
  const encryptionProvider = (value(env, "ENCRYPTION_PROVIDER") || "aes").toLowerCase();
  if (encryptionOn && encryptionProvider === "aes") {
    const secret = value(env, "ENCRYPTION_SECRET");
    if (!secret) {
      violations.push({
        variable: "ENCRYPTION_SECRET",
        message: "is not set, so content keys would be derived from JWT_SECRET; set a dedicated secret.",
      });
    } else if (secret === value(env, "JWT_SECRET")) {
      violations.push({ variable: "ENCRYPTION_SECRET", message: "equals JWT_SECRET; use a dedicated secret." });
    }
  }

  const authorizer = value(env, "MINT_AUTHORIZER_PRIVATE_KEY");
  const deployer = value(env, "PRIVATE_KEY");
  if (!authorizer) {
    violations.push({
      variable: "MINT_AUTHORIZER_PRIVATE_KEY",
      message: deployer
        ? "is not set, so mint and attestation vouchers would be signed with the deployer key (PRIVATE_KEY); set a dedicated signer."
        : "is not set; mint and attestation vouchers need a dedicated signer.",
    });
  } else if (deployer && normalizeKey(authorizer) === normalizeKey(deployer)) {
    violations.push({
      variable: "MINT_AUTHORIZER_PRIVATE_KEY",
      message: "is the deployer key (PRIVATE_KEY); use a dedicated signer.",
    });
  }

  const kmsProvider = (value(env, "KMS_PROVIDER") || "local").toLowerCase();
  if (kmsProvider !== "gcp-kms") {
    violations.push({
      variable: "KMS_PROVIDER",
      message: `is "${kmsProvider}"; agent keys must be wrapped by a managed key service (gcp-kms with GCP_KMS_KEY_NAME).`,
    });
  } else if (!value(env, "GCP_KMS_KEY_NAME")) {
    violations.push({ variable: "GCP_KMS_KEY_NAME", message: "is not set for KMS_PROVIDER=gcp-kms." });
  }

  for (const { variable, what } of DEVELOPMENT_SWITCHES) {
    if (isOn(value(env, variable))) {
      violations.push({ variable, message: `turns on ${what}; remove it or set it to false.` });
    }
  }

  const storage = (value(env, "STORAGE_PROVIDER") || "local").toLowerCase();
  if (storage === "ipfs" || storage === "filecoin") {
    violations.push({
      variable: "STORAGE_PROVIDER",
      message: `is "${storage}", which cannot delete audio (takedowns, withdrawals, erasure); use gcs.`,
    });
  } else if (storage !== "gcs") {
    violations.push({
      variable: "STORAGE_PROVIDER",
      message: `is "${storage}", which keeps audio on the instance's disk; use gcs.`,
    });
  }

  return violations;
}

export function formatConfigViolations(violations: ConfigViolation[]): string {
  return violations.map((violation) => `- ${violation.variable} ${violation.message}`).join("\n");
}

export class ProductionConfigError extends Error {
  constructor(readonly violations: ConfigViolation[]) {
    super(
      `Refusing to start: this production deployment has ${violations.length} configuration problem${violations.length === 1 ? "" : "s"}:\n${formatConfigViolations(violations)}`,
    );
    this.name = "ProductionConfigError";
  }
}

/**
 * Throw when a production-tier deployment breaks any rule; do nothing
 * elsewhere. Called first thing at boot.
 */
export function assertProductionConfiguration(env: Env = process.env): void {
  if (!isProductionEnvironment(env as NodeJS.ProcessEnv)) return;
  const violations = productionConfigViolations(env);
  if (violations.length > 0) throw new ProductionConfigError(violations);
}
