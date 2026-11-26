/**
 * The rights check a release or track went through, in words listeners and
 * new artists understand. The internal route names describe how payouts are
 * handled ("escrow", "fast path"), which nobody reading a release page or a
 * catalog table needs to decode.
 */
export const RIGHTS_ROUTE_LABELS: Readonly<Record<string, string>> = Object.freeze({
  TRUSTED_FAST_PATH: "Trusted artist",
  STANDARD_ESCROW: "Cleared",
  LIMITED_MONITORING: "Live, monitored",
  NEEDS_HUMAN_REVIEW: "Awaiting review",
  QUARANTINED_REVIEW: "On hold for review",
  BLOCKED: "Blocked",
});

export function formatRightsRoute(route?: string | null): string {
  if (!route) return "Not checked yet";
  return (
    RIGHTS_ROUTE_LABELS[route] ??
    route
      .toLowerCase()
      .split("_")
      .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
      .join(" ")
  );
}
