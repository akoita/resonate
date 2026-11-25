import { createHash } from "crypto";
import { readFileSync } from "fs";
import { isProductionEnvironment } from "../../config/product_surfaces";

/**
 * The artist participation agreement (#2666). The operator supplies the text:
 * `PARTICIPATION_AGREEMENT_FILE` names a Markdown file and
 * `PARTICIPATION_AGREEMENT_VERSION` its version. Until both are set, a clearly
 * marked placeholder is served; production refuses to let artists accept it,
 * so artist onboarding stays closed there (deployment wiring lives outside
 * this repository).
 *
 * "Production" is the deployment identity, not `NODE_ENV`: every container
 * image sets `NODE_ENV=production`, staging included, so reading it alone
 * closed artist onboarding on staging too. A production-tier
 * `RESONATE_ENVIRONMENT_ID` closes it, and so does a `NODE_ENV=production`
 * process with no identity at all, so an unlabeled deployment fails closed.
 */
export function placeholderRefused(env: NodeJS.ProcessEnv = process.env): boolean {
  if (isProductionEnvironment(env)) return true;
  const labeled = Boolean(env.RESONATE_ENVIRONMENT_ID?.trim());
  return !labeled && env.NODE_ENV?.trim().toLowerCase() === "production";
}
export const PLACEHOLDER_AGREEMENT_VERSION = "placeholder";

export const PLACEHOLDER_AGREEMENT_TEXT = `# Artist participation agreement (placeholder)

**This is a placeholder.** The operator has not published the participation
agreement yet. On a test or staging deployment you may accept it to try the
onboarding flow; it binds no one. A production deployment does not let
artists accept it.

The real agreement will explain, in plain words:

- what Resonate does with the music you upload, and what it never does;
- how you are paid, and that you keep at least 85% of each sale;
- how remixing and AI features may use your work, and how your choices below
  control that;
- how you can change your choices, withdraw your work, and leave.
`;

export type ParticipationAgreement = {
  version: string;
  text: string;
  /** SHA-256 of the text, hex. */
  textHash: string;
  placeholder: boolean;
  /** False when artists may not accept it here (the placeholder in production). */
  available: boolean;
};

export function hashAgreementText(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

let cached: { key: string; agreement: ParticipationAgreement } | null = null;

export function loadParticipationAgreement(env: NodeJS.ProcessEnv = process.env): ParticipationAgreement {
  const file = (env.PARTICIPATION_AGREEMENT_FILE ?? "").trim();
  const version = (env.PARTICIPATION_AGREEMENT_VERSION ?? "").trim().slice(0, 64);
  const production = placeholderRefused(env);
  const key = `${file}\u0000${version}\u0000${production}`;
  if (cached?.key === key) return cached.agreement;

  let text = PLACEHOLDER_AGREEMENT_TEXT;
  let placeholder = true;
  if (file && version) {
    try {
      const loaded = readFileSync(file, "utf8");
      if (loaded.trim()) {
        text = loaded;
        placeholder = false;
      }
    } catch {
      // An unreadable file leaves the placeholder in place (and production closed).
    }
  }
  const agreement: ParticipationAgreement = {
    version: placeholder ? PLACEHOLDER_AGREEMENT_VERSION : version,
    text,
    textHash: hashAgreementText(text),
    placeholder,
    available: !(placeholder && production),
  };
  cached = { key, agreement };
  return agreement;
}

/**
 * Whether uploads need the current agreement accepted. On by default; off
 * with `PARTICIPATION_AGREEMENT_REQUIRED=false`. Test runs default to off so
 * upload suites that predate the agreement keep working; the gate's own
 * tests set `PARTICIPATION_AGREEMENT_REQUIRED=true`.
 */
export function participationAgreementRequired(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = (env.PARTICIPATION_AGREEMENT_REQUIRED ?? "").trim().toLowerCase();
  if (value === "false") return false;
  if (value === "true") return true;
  return env.NODE_ENV !== "test";
}

export const PARTICIPATION_AGREEMENT_REQUIRED_CODE = "participation_agreement_required";
export const PARTICIPATION_AGREEMENT_UNAVAILABLE_CODE = "participation_agreement_unavailable";
