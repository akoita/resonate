/**
 * Composition details per track (#2669): writers, publisher, work code (ISWC)
 * and the cover or samples declaration. The server is the authority on every
 * rule; the checks here mirror it so the form can explain a problem before
 * sending.
 */
import { API_BASE, ApiRequestError } from "./api";

export const WRITER_ROLES = ["composer", "lyricist", "arranger"] as const;
export type WriterRole = (typeof WRITER_ROLES)[number];

export const WRITER_ROLE_LABELS: Record<WriterRole, string> = {
  composer: "Composer",
  lyricist: "Lyricist",
  arranger: "Arranger",
};

/** Same list as the backend (`composition/composition.ts`). */
export const COLLECTING_SOCIETIES = [
  "none",
  "ACUM",
  "AKM",
  "APRA AMCOS",
  "ASCAP",
  "BMI",
  "BUMA/STEMRA",
  "CISAC other",
  "GEMA",
  "GMR",
  "IMRO",
  "JASRAC",
  "KODA",
  "PRS",
  "SABAM",
  "SACEM",
  "SADAIC",
  "SAMRO",
  "SESAC",
  "SGAE",
  "SIAE",
  "SOCAN",
  "SPA",
  "STIM",
  "SUISA",
  "TEOSTO",
  "TONO",
  "UBC",
  "ZAiKS",
  "other",
] as const;
export type CollectingSociety = (typeof COLLECTING_SOCIETIES)[number];

export const MAX_WRITERS = 20;
export const MAX_WRITER_NAME = 120;
export const MAX_PUBLISHER = 200;
export const MAX_COVER_NOTE = 1000;

export interface CompositionWriter {
  name: string;
  role: WriterRole;
  share?: number;
  society?: CollectingSociety;
  ipi?: string;
}

export interface Composition {
  writers: CompositionWriter[];
  publisher: string | null;
  selfPublished: boolean;
  iswc: string | null;
  coverOrSamples: boolean;
  coverNote: string | null;
  updatedAt?: string;
}

export interface CompositionInput {
  writers: CompositionWriter[];
  publisher: string | null;
  selfPublished: boolean;
  iswc: string | null;
  coverOrSamples: boolean;
  coverNote: string | null;
}

export type ReleaseComposition =
  | {
      releaseId: string;
      access: "full";
      canEdit: boolean;
      tracks: Array<{ trackId: string; title: string; position: number; composition: Composition | null }>;
    }
  | {
      releaseId: string;
      access: "public";
      canEdit: false;
      tracks: Array<{ trackId: string; title: string; position: number; writers: Array<Pick<CompositionWriter, "name" | "role">> }>;
    };

/** Form state: everything is text so half-typed values survive. */
export interface WriterDraft {
  name: string;
  role: WriterRole;
  share: string;
  society: string;
  ipi: string;
}

export interface CompositionDraft {
  writers: WriterDraft[];
  publisher: string;
  selfPublished: boolean;
  iswc: string;
  coverOrSamples: boolean;
  coverNote: string;
}

export const EMPTY_WRITER: WriterDraft = { name: "", role: "composer", share: "", society: "", ipi: "" };

export const EMPTY_COMPOSITION_DRAFT: CompositionDraft = {
  writers: [],
  publisher: "",
  selfPublished: false,
  iswc: "",
  coverOrSamples: false,
  coverNote: "",
};

export function formatIswc(compact: string | null | undefined): string {
  if (!compact || !/^T\d{10}$/.test(compact)) return compact ?? "";
  return `T-${compact.slice(1, 4)}.${compact.slice(4, 7)}.${compact.slice(7, 10)}-${compact.slice(10)}`;
}

export function draftFromComposition(composition: Composition | null | undefined): CompositionDraft {
  if (!composition) return { ...EMPTY_COMPOSITION_DRAFT, writers: [] };
  return {
    writers: composition.writers.map((writer) => ({
      name: writer.name,
      role: writer.role,
      share: writer.share === undefined ? "" : String(writer.share),
      society: writer.society ?? "",
      ipi: writer.ipi ?? "",
    })),
    publisher: composition.publisher ?? "",
    selfPublished: composition.selfPublished,
    iswc: formatIswc(composition.iswc),
    coverOrSamples: composition.coverOrSamples,
    coverNote: composition.coverNote ?? "",
  };
}

/** True when the draft holds nothing worth sending. */
export function isDraftEmpty(draft: CompositionDraft): boolean {
  return (
    draft.writers.every((writer) => !writer.name.trim()) &&
    !draft.publisher.trim() &&
    !draft.selfPublished &&
    !draft.iswc.trim() &&
    !draft.coverOrSamples
  );
}

function iswcProblem(value: string): string | null {
  const compact = value.trim().toUpperCase().replace(/[\s.-]/g, "");
  if (!compact) return null;
  if (!/^T\d{10}$/.test(compact)) return "Use the form T-123.456.789-0.";
  const digits = compact.slice(1).split("").map(Number);
  let sum = 1;
  for (let i = 0; i < 9; i += 1) sum += digits[i] * (i + 1);
  return (10 - (sum % 10)) % 10 === digits[9] ? null : "The check digit does not match. Please check the code.";
}

function parseShare(value: string): number | null {
  const trimmed = value.trim().replace(",", ".");
  if (!trimmed) return null;
  const share = Number(trimmed);
  return Number.isFinite(share) ? share : Number.NaN;
}

export interface CompositionDraftErrors {
  writers?: string;
  writerRows?: Record<number, string>;
  iswc?: string;
  publisher?: string;
  coverNote?: string;
}

/** Returns the problems in a draft; an empty object means it can be sent. */
export function validateCompositionDraft(draft: CompositionDraft): CompositionDraftErrors {
  const errors: CompositionDraftErrors = {};
  const rows: Record<number, string> = {};
  const writers = draft.writers.filter((writer) => writer.name.trim() || writer.share.trim() || writer.ipi.trim());
  if (writers.length > MAX_WRITERS) errors.writers = `List at most ${MAX_WRITERS} writers.`;

  let withShare = 0;
  let totalHundredths = 0;
  draft.writers.forEach((writer, index) => {
    const touched = writer.name.trim() || writer.share.trim() || writer.ipi.trim();
    if (!touched) return;
    if (!writer.name.trim()) {
      rows[index] = "Add the writer's name.";
      return;
    }
    if (writer.name.trim().length > MAX_WRITER_NAME) {
      rows[index] = `A name can have at most ${MAX_WRITER_NAME} characters.`;
      return;
    }
    const share = parseShare(writer.share);
    if (share !== null) {
      if (Number.isNaN(share) || share <= 0 || share > 100) {
        rows[index] = "A share is a number above 0 and at most 100.";
        return;
      }
      if (Math.abs(share * 100 - Math.round(share * 100)) > 1e-6) {
        rows[index] = "A share can have at most two decimals.";
        return;
      }
      withShare += 1;
      totalHundredths += Math.round(share * 100);
    }
    const ipi = writer.ipi.replace(/[\s.]/g, "");
    if (ipi && !/^\d{9,11}$/.test(ipi)) rows[index] = "An IPI number has 9 to 11 digits.";
  });
  if (Object.keys(rows).length) errors.writerRows = rows;

  if (!errors.writers && withShare > 0) {
    if (withShare !== writers.length) errors.writers = "When you enter shares, give every writer a share.";
    else if (totalHundredths !== 10000) {
      errors.writers = `Shares must add up to 100%. They add up to ${totalHundredths / 100}%.`;
    }
  }

  const iswc = iswcProblem(draft.iswc);
  if (iswc) errors.iswc = iswc;
  if (!draft.selfPublished && draft.publisher.trim().length > MAX_PUBLISHER) {
    errors.publisher = `At most ${MAX_PUBLISHER} characters.`;
  }
  if (draft.coverOrSamples && draft.coverNote.trim().length > MAX_COVER_NOTE) {
    errors.coverNote = `At most ${MAX_COVER_NOTE} characters.`;
  }
  return errors;
}

export function hasCompositionErrors(errors: CompositionDraftErrors): boolean {
  return Boolean(errors.writers || errors.iswc || errors.publisher || errors.coverNote || errors.writerRows);
}

/** The body the server expects, or null when nothing was entered. */
export function toCompositionInput(draft: CompositionDraft): CompositionInput | null {
  if (isDraftEmpty(draft)) return null;
  return {
    writers: draft.writers
      .filter((writer) => writer.name.trim())
      .map((writer) => {
        const out: CompositionWriter = { name: writer.name.trim(), role: writer.role };
        const share = parseShare(writer.share);
        if (share !== null && !Number.isNaN(share)) out.share = share;
        if (writer.society) out.society = writer.society as CollectingSociety;
        const ipi = writer.ipi.replace(/[\s.]/g, "");
        if (ipi) out.ipi = ipi;
        return out;
      }),
    publisher: draft.selfPublished ? null : draft.publisher.trim() || null,
    selfPublished: draft.selfPublished,
    iswc: draft.iswc.trim() || null,
    coverOrSamples: draft.coverOrSamples,
    coverNote: draft.coverOrSamples ? draft.coverNote.trim() || null : null,
  };
}

/** "Ada Lovelace (composer), Grace Hopper (lyricist)". */
export function formatWriterCredits(writers: Array<Pick<CompositionWriter, "name" | "role">>): string {
  return writers.map((writer) => `${writer.name} (${WRITER_ROLE_LABELS[writer.role]?.toLowerCase() ?? writer.role})`).join(", ");
}

async function call<T>(path: string, init: RequestInit, token?: string | null): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body) headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(`${API_BASE}${path}`, { cache: "no-store", ...init, headers });
  const text = await response.text().catch(() => "");
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = undefined;
  }
  if (!response.ok) {
    const message =
      body && typeof body === "object" && "message" in body && typeof (body as { message: unknown }).message === "string"
        ? (body as { message: string }).message
        : `Request failed with status ${response.status}`;
    throw new ApiRequestError(message, response.status, body);
  }
  return body as T;
}

const releasePath = (releaseId: string) => `/catalog/releases/${encodeURIComponent(releaseId)}`;

export function getReleaseComposition(releaseId: string, token?: string | null) {
  return call<ReleaseComposition>(`${releasePath(releaseId)}/composition`, { method: "GET" }, token);
}

export function saveTrackComposition(
  releaseId: string,
  trackId: string,
  token: string,
  input: CompositionInput | null,
) {
  return call<{ trackId: string; composition: Composition | null }>(
    `${releasePath(releaseId)}/tracks/${encodeURIComponent(trackId)}/composition`,
    { method: "PUT", body: JSON.stringify(input ?? {}) },
    token,
  );
}

export function copyCompositionToRelease(releaseId: string, trackId: string, token: string) {
  return call<{ copiedTo: number }>(
    `${releasePath(releaseId)}/tracks/${encodeURIComponent(trackId)}/composition/copy`,
    { method: "POST" },
    token,
  );
}

export interface UsageReport {
  csv: string;
  rows: number;
  truncated: boolean;
  from: string;
  to: string;
}

export function getCompositionUsageReport(token: string, from: string, to: string) {
  const query = new URLSearchParams({ from, to });
  return call<UsageReport>(`/admin/composition/usage-export?${query.toString()}`, { method: "GET" }, token);
}

export function usageReportFileName(from: string, to: string): string {
  return `resonate-usage-${from}-to-${to}.csv`;
}
