import { ApiRequestError, type OfficialStemUploadResponse } from "./api";

/** One reason an official stem package was refused; `stemType` is set when it is about one part. */
export type OfficialStemIssue = { stemType?: string; message: string };

/**
 * The reasons an official stem upload was refused (#1976, #2379): the server
 * answers 400 `official_stems_rejected` with one readable sentence per problem,
 * each naming its part. Empty for any other failure.
 */
export function officialStemRejectionIssues(error: unknown): OfficialStemIssue[] {
  if (!(error instanceof ApiRequestError) || error.status !== 400) return [];
  const details = error.details as { code?: unknown; issues?: unknown } | undefined;
  if (!details || details.code !== "official_stems_rejected" || !Array.isArray(details.issues)) return [];
  const issues: OfficialStemIssue[] = [];
  for (const raw of details.issues) {
    const issue = raw as { message?: unknown; stemType?: unknown } | null;
    if (!issue || typeof issue.message !== "string" || issue.message.length === 0) continue;
    issues.push(
      typeof issue.stemType === "string" && issue.stemType ? { stemType: issue.stemType, message: issue.message } : { message: issue.message },
    );
  }
  return issues;
}

/** "12.3 MB", "850 KB": a file size for the picker row. */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  const mb = bytes / (1024 * 1024);
  return `${mb >= 100 ? Math.round(mb) : mb.toFixed(1)} MB`;
}

/** "Vocals": the stem type as a chip or row label. */
export function stemTypeLabel(type: string): string {
  return type ? type[0].toUpperCase() + type.slice(1) : type;
}

/** What the artist is told after a successful upload: what was added, what was replaced, what stays on sale. */
export function describeOfficialStemUpload(result: Pick<OfficialStemUploadResponse, "stems" | "replaced" | "kept">): string {
  const added = [...new Set(result.stems.map((stem) => stem.type))];
  const parts: string[] = [`Added ${added.join(", ")}. Buyers see ${added.length === 1 ? "it" : "them"} as Official, in lossless quality.`];
  if (result.replaced > 0) {
    parts.push(`${result.replaced === 1 ? "It replaces" : "They replace"} the earlier official ${result.replaced === 1 ? "part" : "parts"} of the same type.`);
  }
  if (result.kept && result.kept.length > 0) {
    parts.push(`Your official ${result.kept.join(", ")} stay${result.kept.length === 1 ? "s" : ""} on sale.`);
  }
  return parts.join(" ");
}

/** The hint under the upload form: a partial package is fine, and a part replaces only its own type. */
export const OFFICIAL_STEMS_FORM_HINT =
  "Upload as many parts as you have: one is enough. Each part is checked on its own against the published mix, " +
  "and when you upload every part the track is sold with, together they must also sound like the mix. " +
  "A part replaces your earlier official part of the same type; the other parts stay on sale.";

/** Accepted formats and size, shown on every picker row. */
export const OFFICIAL_STEMS_ACCEPTED_FORMATS = "WAV or FLAC, up to 300 MB each";

/** The confirmation shown before an official part is withdrawn. */
export function officialStemWithdrawMessage(type: string, trackTitle: string): string {
  return (
    `Your official ${type} part of "${trackTitle}" comes off sale. Buyers who already licensed it keep their files. ` +
    `A separated (AI) ${type} stem, if the track has one, stays on sale. You can upload a new official part at any time. ` +
    "A part that has been minted cannot be withdrawn."
  );
}
