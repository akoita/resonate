// Single source of truth for the in-app About modal and environment
// badge. Repo / builder fields are static project metadata; version,
// commit SHA, and environment are read from build-time env vars wired
// in next.config.js so a fresh build always reflects the deployed code.

export const APP_NAME = "Resonate";
export const APP_TAGLINE =
  "Decentralized music platform — artists, fans, and on-chain economics.";

export const REPO_URL = "https://github.com/akoita/resonate";
export const ISSUES_URL = `${REPO_URL}/issues`;
export const BUILDER_HANDLE = "akoita";
export const BUILDER_URL = "https://github.com/akoita";

export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "";
export const COMMIT_SHA = process.env.NEXT_PUBLIC_COMMIT_SHA ?? "";

const RAW_ENV = (process.env.NEXT_PUBLIC_ENV ?? "").trim().toLowerCase();

// Production is the implicit default — no badge, no noise. Anything
// else is surfaced so reviewers can tell at a glance which build
// they're hitting (the staging/preview footgun the user flagged).
export type AppEnvironment =
  | "production"
  | "staging"
  | "preview"
  | "development"
  | "local";

export function getEnvironment(): AppEnvironment {
  if (!RAW_ENV || RAW_ENV === "production" || RAW_ENV === "prod") {
    return "production";
  }
  if (RAW_ENV === "staging") return "staging";
  if (RAW_ENV === "preview") return "preview";
  if (RAW_ENV === "development" || RAW_ENV === "dev") return "development";
  if (RAW_ENV === "local") return "local";
  // Unknown labels still render — better to over-disclose than hide a
  // surprise environment.
  return RAW_ENV as AppEnvironment;
}

export function isProduction(): boolean {
  return getEnvironment() === "production";
}

export function getCommitUrl(): string | null {
  if (!COMMIT_SHA) return null;
  return `${REPO_URL}/commit/${COMMIT_SHA}`;
}
