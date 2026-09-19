import { createHash } from "crypto";

const LOCAL_ANALYTICS_ACTOR_ID_SALT = "resonate-local-analytics-actor-salt";
const INSECURE_FALLBACK_OPT_OUT = "ANALYTICS_ACTOR_ID_SALT_ALLOW_INSECURE_FALLBACK";

type AnalyticsIdentityEnvironment = {
  [key: string]: string | undefined;
  ANALYTICS_ACTOR_ID_SALT?: string;
  ANALYTICS_ACTOR_ID_SALT_ALLOW_INSECURE_FALLBACK?: string;
  JWT_SECRET?: string;
  NODE_ENV?: string;
  RESONATE_ENVIRONMENT_ID?: string;
  DEPLOY_ENV?: string;
  APP_ENV?: string;
};

export type AnalyticsActorIdSaltResolution = {
  salt: string;
  source: "analytics_actor_id_salt" | "jwt_secret" | "local_default";
  insecureFallbackAllowed: boolean;
};

function normalized(value: string | undefined) {
  return value?.trim() || undefined;
}

function isLocalDevelopment(env: AnalyticsIdentityEnvironment) {
  const nodeEnvironment = normalized(env.NODE_ENV)?.toLowerCase();
  const deploymentEnvironment = normalized(
    env.RESONATE_ENVIRONMENT_ID || env.DEPLOY_ENV || env.APP_ENV,
  )?.toLowerCase();

  // RESONATE_ENVIRONMENT_ID is the deployment identity. NODE_ENV is
  // "production" in every container image, including non-production ones, so
  // it is only a fallback for unlabeled local/test processes.
  if (deploymentEnvironment) {
    return ["local", "test", "integration"].includes(deploymentEnvironment);
  }
  return nodeEnvironment !== "production";
}

export function resolveAnalyticsActorIdSalt(
  env: AnalyticsIdentityEnvironment = process.env,
): AnalyticsActorIdSaltResolution {
  const configuredSalt = normalized(env.ANALYTICS_ACTOR_ID_SALT);
  if (configuredSalt) {
    return {
      salt: configuredSalt,
      source: "analytics_actor_id_salt",
      insecureFallbackAllowed: false,
    };
  }

  const insecureFallbackAllowed =
    normalized(env.ANALYTICS_ACTOR_ID_SALT_ALLOW_INSECURE_FALLBACK)?.toLowerCase() === "true";
  if (!isLocalDevelopment(env) && !insecureFallbackAllowed) {
    throw new Error(
      `ANALYTICS_ACTOR_ID_SALT is required outside local development. ` +
        `Set it to a stable, non-rotating secret, or set ${INSECURE_FALLBACK_OPT_OUT}=true ` +
        `only as a deliberate temporary compatibility exception.`,
    );
  }

  const jwtSecret = normalized(env.JWT_SECRET);
  return {
    salt: jwtSecret || LOCAL_ANALYTICS_ACTOR_ID_SALT,
    source: jwtSecret ? "jwt_secret" : "local_default",
    insecureFallbackAllowed,
  };
}

export function assertAnalyticsActorIdSaltConfiguration(
  env: AnalyticsIdentityEnvironment = process.env,
  warn: (message: string) => void = console.warn,
) {
  const resolution = resolveAnalyticsActorIdSalt(env);
  if (resolution.source !== "analytics_actor_id_salt") {
    const scope = resolution.insecureFallbackAllowed
      ? "explicit insecure compatibility exception"
      : "local development";
    warn(
      `[AnalyticsIdentity] ANALYTICS_ACTOR_ID_SALT is not set; using ${resolution.source} ` +
        `for ${scope}. Analytics identity continuity is not protected against JWT secret rotation.`,
    );
  }
  return resolution;
}

export function pseudonymousAnalyticsActorId(userId?: string | null) {
  const normalizedUserId = userId?.trim().toLowerCase();
  if (!normalizedUserId) {
    return undefined;
  }

  const { salt } = resolveAnalyticsActorIdSalt();
  const digest = createHash("sha256")
    .update(`${salt}:${normalizedUserId}`)
    .digest("hex")
    .slice(0, 32);

  return `user_${digest}`;
}
