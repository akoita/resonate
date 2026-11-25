import { ForbiddenException } from "@nestjs/common";
import { resolveAnalyticsEnvironment } from "../modules/analytics/analytics_event";

/**
 * Product surface switches (#2658).
 *
 * One named switch per surface where money moves or where generative AI runs.
 * A deployment turns a surface off without a code change, and the backend
 * refuses the matching routes, so hiding a button is never the only
 * protection. The web app reads the resolved values from
 * `GET /config/surfaces` and hides the entry points.
 *
 * Defaults: every surface is on, except in a production environment
 * (`RESONATE_ENVIRONMENT_ID` names a `prod` tier), where every surface is off
 * unless its variable says `true`. `NODE_ENV` is deliberately not the signal:
 * every container image sets it to `production`, staging included.
 *
 * Values are read on every call, so a new revision with a changed variable
 * takes effect without new code.
 */
export const PRODUCT_SURFACES = {
  showsPledging: {
    env: "SHOWS_PLEDGING_ENABLED",
    label: "Shows pledging",
  },
  paidCollects: {
    env: "PAID_COLLECTS_ENABLED",
    label: "Paid collects",
  },
  stemPurchases: {
    env: "STEM_PURCHASES_ENABLED",
    label: "Stem and licence buying",
  },
  wallet: {
    env: "WALLET_ENABLED",
    label: "Wallet",
  },
  agentPayments: {
    env: "AGENT_PAYMENTS_ENABLED",
    label: "Agent payments",
  },
  aiGeneration: {
    env: "AI_GENERATION_ENABLED",
    label: "AI generation",
  },
} as const;

export type ProductSurface = keyof typeof PRODUCT_SURFACES;

export const PRODUCT_SURFACE_NAMES = Object.keys(PRODUCT_SURFACES) as ProductSurface[];

export type ProductSurfaceState = Record<ProductSurface, boolean>;

export const SURFACE_DISABLED_CODE = "surface_disabled";

/** True when the deployment identity names a production tier. */
export function isProductionEnvironment(env: NodeJS.ProcessEnv = process.env): boolean {
  return resolveAnalyticsEnvironment(env) === "prod";
}

function parseSwitch(raw: string | undefined): boolean | undefined {
  const value = raw?.trim().toLowerCase();
  if (!value) return undefined;
  if (["true", "1", "on", "yes"].includes(value)) return true;
  if (["false", "0", "off", "no"].includes(value)) return false;
  // An unreadable value fails closed: a typo must not open a money surface.
  return false;
}

export function isSurfaceEnabled(
  surface: ProductSurface,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const explicit = parseSwitch(env[PRODUCT_SURFACES[surface].env]);
  if (explicit !== undefined) return explicit;
  return !isProductionEnvironment(env);
}

export function resolveProductSurfaces(env: NodeJS.ProcessEnv = process.env): ProductSurfaceState {
  return Object.fromEntries(
    PRODUCT_SURFACE_NAMES.map((surface) => [surface, isSurfaceEnabled(surface, env)]),
  ) as ProductSurfaceState;
}

/** The typed refusal every switched-off route answers with (HTTP 403). */
export class SurfaceDisabledException extends ForbiddenException {
  constructor(readonly surface: ProductSurface) {
    super({
      statusCode: 403,
      error: "Forbidden",
      code: SURFACE_DISABLED_CODE,
      surface,
      message: `${PRODUCT_SURFACES[surface].label} is not available on this deployment.`,
    });
  }
}

export function assertSurfaceEnabled(
  surface: ProductSurface,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (!isSurfaceEnabled(surface, env)) {
    throw new SurfaceDisabledException(surface);
  }
}

/**
 * Prompted AI remix generation runs only when the provider is configured
 * (`REMIX_GENERATION_ENABLED=true`) and the AI generation surface is on.
 * Stem-mix renders are pure DSP and stay outside this gate.
 */
export function isRemixGenerationEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.REMIX_GENERATION_ENABLED === "true" && isSurfaceEnabled("aiGeneration", env);
}
