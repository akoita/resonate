import { createHash } from "crypto";

const LOCAL_ANALYTICS_ACTOR_ID_SALT = "resonate-local-analytics-actor-salt";

export function pseudonymousAnalyticsActorId(userId?: string | null) {
  const normalizedUserId = userId?.trim().toLowerCase();
  if (!normalizedUserId) {
    return undefined;
  }

  const salt =
    process.env.ANALYTICS_ACTOR_ID_SALT ||
    process.env.JWT_SECRET ||
    LOCAL_ANALYTICS_ACTOR_ID_SALT;
  const digest = createHash("sha256")
    .update(`${salt}:${normalizedUserId}`)
    .digest("hex")
    .slice(0, 32);

  return `user_${digest}`;
}
