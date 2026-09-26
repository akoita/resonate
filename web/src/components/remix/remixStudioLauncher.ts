import {
  createRemixProject,
  getRemixEligibility,
  listRemixProjects,
  type RemixEligibilityResponse,
  type RemixProject,
} from "../../lib/api";

/**
 * Picks the most recent existing draft for the same source instead of
 * creating a duplicate. When the CTA is stem-scoped, the draft must contain
 * every requested stem. Containment (not exact-set) matching: full-session
 * hydration (#1312) means projects hold MORE stems than the entry selection,
 * so exact matching would mint a duplicate project on every stem-page click.
 */
export function findReusableDraft(
  projects: RemixProject[],
  trackId: string,
  stemIds?: string[],
): RemixProject | null {
  const requestedSet = stemIds?.length
    ? new Set(stemIds)
    : null;
  const candidates = projects
    .filter((project) => {
      if (project.status !== "draft") return false;
      if (project.sourceTrackId !== trackId) return false;
      if (!requestedSet) return true;
      const projectSet = new Set(project.stems.map((stem) => stem.stemId));
      for (const stemId of requestedSet) {
        if (!projectSet.has(stemId)) return false;
      }
      return true;
    })
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  return candidates[0] ?? null;
}

export const REMIX_LICENSE_REQUIRED_REASON =
  "A remix license unlocks Remix Studio for this track's stems.";

/** Plain-language denial copy for an eligibility response that is not allowed. */
export function remixDenialReason(eligibility: RemixEligibilityResponse | null): string {
  if (!eligibility) return "Could not check remix availability for this track. Please try again.";
  if (eligibility.requiredLicense === "remix") return REMIX_LICENSE_REQUIRED_REASON;
  return eligibility.reasons[0]?.message || "Remixing is not available for this source.";
}

/**
 * Opens (reuses or creates) a Remix Studio draft for an eligible source and
 * returns the studio path to navigate to. The caller must already hold an
 * `allowed` eligibility response; rights are never inferred client-side.
 * Throws when the project cannot be created so the caller can surface it.
 */
export async function openRemixStudioDraft(input: {
  token: string;
  trackId: string;
  eligibility: RemixEligibilityResponse;
  stemIds?: string[];
  trackTitle?: string;
}): Promise<string> {
  const { token, trackId, eligibility, stemIds, trackTitle } = input;
  const requestedStemIds = stemIds?.length ? stemIds : undefined;

  // Reuse the most recent matching draft instead of stacking duplicates.
  const existing = findReusableDraft(
    await listRemixProjects(token).catch(() => []),
    trackId,
    requestedStemIds,
  );
  if (existing) return `/remix/studio/${existing.id}`;

  // Track-default eligibility can be a partial allowance: build the
  // project from licensed, remixable stems only.
  const projectStemIds =
    requestedStemIds ??
    eligibility.stems
      .filter((stem) => stem.licensed && stem.remixable !== false)
      .map((stem) => stem.stemId);
  const project = await createRemixProject(token, {
    sourceTrackId: trackId,
    stemIds: projectStemIds,
    title: trackTitle ? `${trackTitle} (Remix)` : "Untitled Remix",
  });
  return `/remix/studio/${project.id}`;
}

export type RemixStudioLaunchResult =
  | { kind: "opened"; path: string }
  | { kind: "not_allowed"; reason: string; eligibility: RemixEligibilityResponse | null };

/**
 * One-shot launcher for surfaces that do not render a RemixCta (e.g. the
 * player's "Remix" action): checks eligibility for the catalog track, then
 * reuses or creates the draft. Denials are returned, not thrown; project
 * creation failures still throw.
 */
export async function launchRemixStudio(input: {
  token: string;
  trackId: string;
  stemIds?: string[];
  trackTitle?: string;
}): Promise<RemixStudioLaunchResult> {
  const eligibility = await getRemixEligibility(
    input.token,
    input.trackId,
    input.stemIds?.length ? input.stemIds : undefined,
  ).catch(() => null);
  if (!eligibility?.allowed) {
    return { kind: "not_allowed", reason: remixDenialReason(eligibility), eligibility };
  }
  const path = await openRemixStudioDraft({ ...input, eligibility });
  return { kind: "opened", path };
}
