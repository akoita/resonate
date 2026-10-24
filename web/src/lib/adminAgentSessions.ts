import type { AdminAgentCoverage, AdminAgentSessionEvent } from "./api";

/** #2259: helpers for the operator view of a session's raw agent events. */

/** The same shape the server accepts; anything else is refused before a request is made. */
export const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/;

export function validateSessionId(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return "Enter a session id.";
  if (!SESSION_ID_PATTERN.test(trimmed)) {
    return "A session id has letters, numbers, dashes, dots, colons or underscores only, and no spaces.";
  }
  return null;
}

const EVENT_LABELS: Record<string, string> = {
  "agent.selection": "Candidates selected",
  "agent.decision_made": "Decision",
  "agent.track_selected": "Track selected",
  "agent.mix_planned": "Transition planned",
  "agent.evaluated": "Track evaluated",
  "agent.negotiated": "License negotiated",
  "agent.evaluation_completed": "Evaluation completed",
  "agent.purchase_completed": "Purchase completed",
  "agent.purchase_failed": "Purchase failed",
  "agent.generation_triggered": "Generation triggered (retired)",
  "agent.session_started": "Session started",
  "agent.session_stopped": "Session stopped",
  "agent.next_pick_requested": "Next pick requested",
  "agent.up_next_action": "Up next action",
  "agent.intent_selected": "Intent selected",
};

/** A plain label for an event name; unknown names are shown as recorded. */
export function agentEventLabel(eventName: string): string {
  return EVENT_LABELS[eventName] ?? eventName;
}

/** `no_tracks` -> `no tracks`. Codes are shown as words, never reinterpreted. */
export function codeLabel(code: string): string {
  return code.replaceAll("_", " ");
}

const FILTER_LABELS: Record<AdminAgentCoverage["gaps"][number]["filter"], string> = {
  genres: "genres",
  moods: "moods",
  energy: "energy",
  bpm: "tempo",
};

/** What the picks matched of the listener's request, from counts alone. */
export function coverageLines(coverage: AdminAgentCoverage): string[] {
  const lines: string[] = [];
  if (coverage.gaps.length === 0) {
    lines.push(`All ${coverage.picks} picks match the request`);
  } else {
    for (const gap of coverage.gaps) {
      lines.push(`${gap.matched} of ${coverage.picks} picks match ${FILTER_LABELS[gap.filter]}`);
    }
  }
  if (coverage.heldBack) {
    const { variety, explicit } = coverage.heldBack;
    if (variety > 0) lines.push(`${variety} strong match${variety === 1 ? "" : "es"} held back for variety`);
    if (explicit > 0) lines.push(`${explicit} strong match${explicit === 1 ? "" : "es"} held back by the explicit preference`);
  }
  if (coverage.capRelaxed) {
    const { artists } = coverage.capRelaxed;
    lines.push(`Per-artist cap relaxed for ${artists} artist${artists === 1 ? "" : "s"}`);
  }
  if (coverage.shortfallReason === "catalog_short") lines.push("Shorter than the target: the catalog has no more matching tracks");
  return lines;
}

/** The decision details of one event, in reading order. */
export function eventDetails(event: AdminAgentSessionEvent): string[] {
  const details: string[] = [];
  if (event.pickIndex !== undefined) {
    details.push(event.pickCount !== undefined ? `Pick ${event.pickIndex + 1} of ${event.pickCount}` : `Pick ${event.pickIndex + 1}`);
  }
  if (event.reason) details.push(`Reason: ${codeLabel(event.reason)}`);
  if (event.curatedBy) details.push(`Curated by: ${event.curatedBy === "llm" ? "the AI model" : event.curatedBy}`);
  if (event.runtimeFallback) {
    details.push(`Model unavailable (${codeLabel(event.runtimeFallback.reason)}), rules used instead`);
  }
  if (event.strategy) details.push(`Strategy: ${codeLabel(event.strategy)}`);
  if (event.transition) details.push(`Transition: ${codeLabel(event.transition)}`);
  if (event.licenseType) details.push(`License: ${event.licenseType}`);
  if (event.status) details.push(`Status: ${codeLabel(event.status)}`);
  if (event.runtimeStatus) details.push(`Runtime status: ${codeLabel(event.runtimeStatus)}`);
  if (event.action) details.push(`Action: ${codeLabel(event.action)}`);
  if (event.source) details.push(`Source: ${codeLabel(event.source)}`);
  if (event.seedKind) details.push(`Seed: ${event.seedKind}`);
  if (event.mode) details.push(`Mode: ${codeLabel(event.mode)}`);
  if (event.candidateCount !== undefined) details.push(`${event.candidateCount} candidates`);
  if (event.count !== undefined) details.push(`${event.count} selected`);
  if (event.trackCount !== undefined) details.push(`${event.trackCount} tracks`);
  if (event.shortfall !== undefined) details.push(`Short by ${event.shortfall}`);
  if (event.unmetIntent?.length) details.push(`Could not fill: ${event.unmetIntent.join(", ")}`);
  if (event.latencyMs !== undefined) details.push(`Took ${event.latencyMs} ms`);
  if (event.priceUsd !== undefined) details.push(`Price: $${event.priceUsd}`);
  return details;
}

/** Identifiers an event names, labelled. */
export function eventIdentifiers(event: AdminAgentSessionEvent): Array<{ label: string; value: string }> {
  const fields: Array<[string, string | undefined]> = [
    ["Track", event.trackId],
    ["Artist", event.artistId],
    ["Release", event.releaseId],
    ["Listing", event.listingId],
    ["Token", event.tokenId],
  ];
  return fields.flatMap(([label, value]) => (value ? [{ label, value }] : []));
}
