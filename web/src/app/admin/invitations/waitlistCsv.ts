import type { WaitlistEntry } from "../../../lib/api";

function cell(value: string) {
  // Quote every cell, double inner quotes, and neutralize spreadsheet formulas.
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

/** #2662: the waiting list as CSV for the operator, one row per entry. */
export function waitlistToCsv(entries: WaitlistEntry[]): string {
  const header = ["email", "kind", "joined_waitlist_at", "consent_version", "consented_at", "invited_at", "signed_up"];
  const rows = entries.map((entry) => [
    entry.email,
    entry.kind,
    entry.createdAt,
    entry.consentVersion,
    entry.consentedAt,
    entry.invitedAt ?? "",
    entry.joined ? "yes" : "no",
  ]);
  return [header, ...rows].map((row) => row.map(cell).join(",")).join("\r\n") + "\r\n";
}
