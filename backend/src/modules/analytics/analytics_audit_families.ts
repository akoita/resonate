/**
 * Event families retained under a legal obligation: redacted in place rather
 * than deleted, by both retention (#1789) and erasure (#1771).
 *
 * A leaf module on purpose. The governance service that applies this rule
 * imports Prisma, and the staging validation harness that builds fixtures from
 * it must stay free of a database to remain unit-testable — so the rule lives
 * where both can reach it and neither has to restate it.
 *
 * A validator holding its own copy of this list stops covering a family the
 * moment one is added, and does so silently. That is precisely the failure a
 * validator exists to prevent, which is why this is shared rather than
 * duplicated.
 */
export const FINANCIAL_AUDIT_EVENT_FAMILIES = new Set(["commerce", "payment", "rights", "license"]);

export function shouldPreserveForAudit(eventName: string) {
  return FINANCIAL_AUDIT_EVENT_FAMILIES.has(eventName.split(".")[0]);
}
