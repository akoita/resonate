import type { IncomingRemixApproval } from "./api";

/** The status line on an artist's approval card (#2682). */
export function approvalStatusLabel(
  item: Pick<IncomingRemixApproval, "status" | "versionAvailable">,
): string {
  if (item.status === "approved") return "Approved";
  if (item.status === "declined") return "Declined";
  return item.versionAvailable ? "Waiting for you" : "Replaced by the creator";
}
