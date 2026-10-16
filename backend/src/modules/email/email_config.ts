import { randomBytes } from "crypto";
import { Injectable } from "@nestjs/common";
import { writeStructuredLog } from "../shared/structured_logging";

export type EmailTransportKind = "log" | "smtp";

/** Variables `EMAIL_TRANSPORT=smtp` cannot work without (#2169). */
export const SMTP_REQUIRED_ENV = [
  "EMAIL_FROM",
  "EMAIL_SMTP_URL",
  "EMAIL_LINK_SIGNING_SECRET",
  "FRONTEND_URL",
  "PUBLIC_API_URL",
] as const;

const LOCAL_FRONTEND_URL = "http://localhost:3001";
const LOCAL_API_URL = "http://localhost:3000";
const LOCAL_FROM = "Resonate <notices@localhost>";

function read(env: NodeJS.ProcessEnv, name: string): string {
  return (env[name] ?? "").trim();
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

/**
 * How platform email is configured on this deployment (#2169).
 *
 * - `EMAIL_TRANSPORT` unset: `log` outside production, email **disabled** in
 *   production.
 * - `log` (development and test only): nothing leaves the process. Non-secret
 *   settings fall back to documented localhost values and, if no signing
 *   secret is set, an ephemeral per-process one is generated (never a
 *   source-code default).
 * - `smtp`: needs every name in {@link SMTP_REQUIRED_ENV}. If any is missing
 *   email is disabled and one error-level log names the missing variable
 *   NAMES, never their values.
 *
 * Anything that cannot be configured disables email rather than throwing, so a
 * mistake never stops the API from booting. `isAvailable()` is what the
 * `/me/contact-email` state reports as `available`.
 */
@Injectable()
export class EmailConfig {
  readonly transportKind: EmailTransportKind | null;
  /** Names of required variables that are unset (empty when available). */
  readonly missing: readonly string[];
  readonly from: string;
  readonly smtpUrl: string;
  readonly linkSigningSecret: string;
  readonly webhookSecret: string;
  readonly frontendUrl: string;
  readonly publicApiUrl: string;
  /** Why email is off, as a short code that carries no values. */
  readonly disabledReason: "not_configured" | "invalid_transport" | "log_in_production" | "missing_variables" | null;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    const requested = read(env, "EMAIL_TRANSPORT").toLowerCase();
    const production = env.NODE_ENV === "production";

    let kind: EmailTransportKind | null = null;
    let reason: EmailConfig["disabledReason"] = null;
    if (requested === "") {
      if (production) reason = "not_configured";
      else kind = "log";
    } else if (requested === "log") {
      if (production) reason = "log_in_production";
      else kind = "log";
    } else if (requested === "smtp") {
      kind = "smtp";
    } else {
      reason = "invalid_transport";
    }

    this.webhookSecret = read(env, "EMAIL_WEBHOOK_SECRET");
    const isLog = kind === "log";
    this.from = read(env, "EMAIL_FROM") || (isLog ? LOCAL_FROM : "");
    this.smtpUrl = read(env, "EMAIL_SMTP_URL");
    this.linkSigningSecret =
      read(env, "EMAIL_LINK_SIGNING_SECRET") || (isLog ? randomBytes(32).toString("hex") : "");
    this.frontendUrl = stripTrailingSlash(read(env, "FRONTEND_URL") || (isLog ? LOCAL_FRONTEND_URL : ""));
    this.publicApiUrl = stripTrailingSlash(read(env, "PUBLIC_API_URL") || (isLog ? LOCAL_API_URL : ""));

    const missing: string[] = [];
    if (kind === "smtp") {
      const values: Record<(typeof SMTP_REQUIRED_ENV)[number], string> = {
        EMAIL_FROM: this.from,
        EMAIL_SMTP_URL: this.smtpUrl,
        EMAIL_LINK_SIGNING_SECRET: this.linkSigningSecret,
        FRONTEND_URL: this.frontendUrl,
        PUBLIC_API_URL: this.publicApiUrl,
      };
      for (const name of SMTP_REQUIRED_ENV) if (!values[name]) missing.push(name);
      if (missing.length > 0) {
        kind = null;
        reason = "missing_variables";
      }
    }

    this.transportKind = kind;
    this.missing = missing;
    this.disabledReason = kind ? null : reason;
  }

  isAvailable(): boolean {
    return this.transportKind !== null;
  }

  /** One structured line explaining why email is off. Names only, never values. */
  logIfDisabled(): void {
    if (this.isAvailable()) return;
    if (this.disabledReason === "not_configured") {
      writeStructuredLog({
        level: "warn",
        event: "email.disabled",
        message: "Email notices are disabled: EMAIL_TRANSPORT is not set in production",
        reason: this.disabledReason,
      });
      return;
    }
    writeStructuredLog({
      level: "error",
      event: "email.misconfigured",
      message:
        this.disabledReason === "missing_variables"
          ? `Email notices are disabled: missing ${this.missing.join(", ")}`
          : this.disabledReason === "log_in_production"
            ? "Email notices are disabled: EMAIL_TRANSPORT=log is not allowed in production"
            : "Email notices are disabled: EMAIL_TRANSPORT must be log or smtp",
      reason: this.disabledReason,
      missingVariables: [...this.missing],
    });
  }
}
