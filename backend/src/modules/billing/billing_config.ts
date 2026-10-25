/**
 * How Stripe billing is configured on this deployment (#2407,
 * `docs/rfc/artist-pro.md` §6). Every value comes from the environment
 * (secrets from the secret manager); none has a source-code default except the
 * documented localhost web address for development.
 *
 * Billing is **available** only when all of these hold:
 *   - `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
 *     `STRIPE_PRICE_ARTIST_PRO_MONTHLY` and `STRIPE_PRICE_ARTIST_PRO_ANNUAL`
 *     are set;
 *   - the key is a test key, unless `BILLING_LIVE_MODE=true`. A live key
 *     (`sk_live_…` / `rk_live_…`) with live mode off is refused, so a
 *     misplaced production key can never charge anyone from a test deployment;
 *   - a web address for the Checkout return pages is known: the first entry of
 *     `FRONTEND_URL`, or `http://localhost:3001` outside production.
 *
 * Anything missing or refused disables billing (the routes answer 503
 * `billing_unavailable`) instead of stopping the API from booting. The log
 * names variables, never their values.
 */

import { Injectable } from "@nestjs/common";
import { parseEnvList } from "../../config/env";
import { writeStructuredLog } from "../shared/structured_logging";

export type BillingInterval = "month" | "year";
export const BILLING_INTERVALS: readonly BillingInterval[] = ["month", "year"] as const;

export const BILLING_REQUIRED_ENV = [
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_PRICE_ARTIST_PRO_MONTHLY",
  "STRIPE_PRICE_ARTIST_PRO_ANNUAL",
] as const;

const LOCAL_FRONTEND_URL = "http://localhost:3001";
const LIVE_KEY = /^(sk|rk)_live_/;

function read(env: NodeJS.ProcessEnv, name: string): string {
  return (env[name] ?? "").trim();
}

export type BillingUnavailableReason = "not_configured" | "live_key_refused" | "no_frontend_url";

@Injectable()
export class BillingConfig {
  readonly secretKey: string;
  readonly webhookSecret: string;
  readonly prices: Readonly<Record<BillingInterval, string>>;
  /** `BILLING_LIVE_MODE=true`. Out of scope for #2407: keep it false. */
  readonly liveMode: boolean;
  /** `STRIPE_AUTOMATIC_TAX=true`: Stripe Tax computes VAT and sales tax at checkout. */
  readonly automaticTax: boolean;
  /** The web app base the Checkout and Portal return to (no trailing slash), or "" when unknown. */
  readonly frontendUrl: string;
  /** Names of required variables that are unset. */
  readonly missing: readonly string[];
  readonly unavailableReason: BillingUnavailableReason | null;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.secretKey = read(env, "STRIPE_SECRET_KEY");
    this.webhookSecret = read(env, "STRIPE_WEBHOOK_SECRET");
    this.prices = Object.freeze({
      month: read(env, "STRIPE_PRICE_ARTIST_PRO_MONTHLY"),
      year: read(env, "STRIPE_PRICE_ARTIST_PRO_ANNUAL"),
    });
    this.liveMode = read(env, "BILLING_LIVE_MODE").toLowerCase() === "true";
    this.automaticTax = read(env, "STRIPE_AUTOMATIC_TAX").toLowerCase() === "true";
    const production = read(env, "NODE_ENV") === "production";
    const frontend = parseEnvList(env.FRONTEND_URL)[0] ?? (production ? "" : LOCAL_FRONTEND_URL);
    this.frontendUrl = frontend.replace(/\/+$/, "");
    this.missing = BILLING_REQUIRED_ENV.filter((name) => !read(env, name));

    if (this.missing.length > 0) this.unavailableReason = "not_configured";
    else if (LIVE_KEY.test(this.secretKey) && !this.liveMode) this.unavailableReason = "live_key_refused";
    else if (!this.frontendUrl) this.unavailableReason = "no_frontend_url";
    else this.unavailableReason = null;
  }

  /** Whether checkout, the portal and the webhook can work. */
  isAvailable(): boolean {
    return this.unavailableReason === null;
  }

  /** True unless the key is a live key (allowed only with `BILLING_LIVE_MODE=true`). */
  get testMode(): boolean {
    return !LIVE_KEY.test(this.secretKey);
  }

  priceFor(interval: BillingInterval): string {
    return this.prices[interval];
  }

  /** Where Checkout and the Portal send the person back: Settings → Usage & Billing. */
  returnUrl(result: "success" | "cancel" | "portal"): string {
    return `${this.frontendUrl}/settings?section=usage&billing=${result}`;
  }

  /** One log line at boot when billing is off; names only, never values. */
  logIfUnavailable(): void {
    if (this.unavailableReason === null) return;
    writeStructuredLog({
      level: this.unavailableReason === "live_key_refused" ? "error" : "info",
      event: "billing.unavailable",
      message:
        this.unavailableReason === "live_key_refused"
          ? "Stripe billing disabled: STRIPE_SECRET_KEY is a live key and BILLING_LIVE_MODE is not true"
          : this.unavailableReason === "no_frontend_url"
            ? "Stripe billing disabled: FRONTEND_URL is required in production for the checkout return pages"
            : "Stripe billing disabled: required variables are not set",
      reason: this.unavailableReason,
      missing: this.missing.join(","),
    });
  }
}
