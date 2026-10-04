/**
 * The listener's "include explicit tracks" choice for the AI DJ (#2088).
 *
 * An explicit boolean sent with the request wins for that request; otherwise
 * the persisted `AgentConfig.allowExplicit` applies, and a listener who never
 * chose gets the safe default of excluding explicit tracks. Resolved
 * server-side so session start and every next pick agree.
 */
export function resolveAllowExplicit(
  requested: unknown,
  configValue: boolean | null | undefined,
): boolean {
  return typeof requested === "boolean" ? requested : configValue === true;
}
