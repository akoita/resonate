/**
 * Composition details for a track (#2669): who wrote the work, who publishes
 * it, its work code (ISWC) and whether the recording is a cover or contains
 * samples. Everything is optional; this module turns untrusted input into the
 * stored shape or throws `CompositionValidationError` with a plain message.
 *
 * Kept free of Nest and Prisma so the upload path, the editor route and the
 * tests share one set of rules.
 */

export const WRITER_ROLES = ["composer", "lyricist", "arranger"] as const;
export type WriterRole = (typeof WRITER_ROLES)[number];

/**
 * Collecting societies an artist can pick for a writer. "none" means the
 * writer is not a member; "other" covers a society not listed here.
 */
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
  /** Percent of the work, 0 < share <= 100, at most two decimals. */
  share?: number;
  society?: CollectingSociety;
  /** IPI name number, 9 to 11 digits. */
  ipi?: string;
}

export interface CompositionData {
  writers: CompositionWriter[];
  publisher: string | null;
  selfPublished: boolean;
  /** Compact form, "T" followed by ten digits. */
  iswc: string | null;
  coverOrSamples: boolean;
  coverNote: string | null;
}

export class CompositionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompositionValidationError";
  }
}

function fail(message: string): never {
  throw new CompositionValidationError(message);
}

function optionalText(value: unknown, field: string, max: number): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") fail(`${field} must be text.`);
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (!trimmed) return null;
  if (trimmed.length > max) fail(`${field} must be at most ${max} characters.`);
  return trimmed;
}

/**
 * ISWC: "T" plus nine digits plus a check digit, written with or without the
 * usual punctuation (T-123.456.789-C). The check digit is
 * (10 - (1 + sum of digit_i * i for i = 1..9) mod 10) mod 10.
 */
export function normalizeIswc(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") fail("The work code (ISWC) must be text.");
  const compact = value.trim().toUpperCase().replace(/[\s.\-]/g, "");
  if (!compact) return null;
  if (!/^T\d{10}$/.test(compact)) {
    fail("The work code (ISWC) must look like T-123.456.789-0.");
  }
  const digits = compact.slice(1).split("").map(Number);
  let sum = 1;
  for (let i = 0; i < 9; i += 1) sum += digits[i] * (i + 1);
  const check = (10 - (sum % 10)) % 10;
  if (check !== digits[9]) fail("The work code (ISWC) has a wrong check digit. Please check it.");
  return compact;
}

/** Formats a compact ISWC for display: T-123.456.789-0. */
export function formatIswc(compact: string | null | undefined): string {
  if (!compact || !/^T\d{10}$/.test(compact)) return compact ?? "";
  return `T-${compact.slice(1, 4)}.${compact.slice(4, 7)}.${compact.slice(7, 10)}-${compact.slice(10)}`;
}

/** IPI name number: 9 to 11 digits, spaces and dots ignored. */
export function normalizeIpi(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" && typeof value !== "number") fail("An IPI number must be digits.");
  const compact = String(value).replace(/[\s.]/g, "");
  if (!compact) return undefined;
  if (!/^\d{9,11}$/.test(compact)) fail("An IPI number has 9 to 11 digits.");
  return compact;
}

function normalizeShare(value: unknown, writer: string): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const share = typeof value === "string" ? Number(value.replace(",", ".")) : value;
  if (typeof share !== "number" || !Number.isFinite(share)) fail(`The share for ${writer} must be a number.`);
  if (share <= 0 || share > 100) fail(`The share for ${writer} must be more than 0 and at most 100.`);
  if (Math.abs(share * 100 - Math.round(share * 100)) > 1e-6) fail(`The share for ${writer} can have at most two decimals.`);
  return share;
}

function normalizeWriter(value: unknown, index: number): CompositionWriter {
  if (!value || typeof value !== "object") fail(`Writer ${index + 1} is not valid.`);
  const raw = value as Record<string, unknown>;
  const name = optionalText(raw.name, `Writer ${index + 1}'s name`, MAX_WRITER_NAME);
  if (!name) fail(`Writer ${index + 1} needs a name.`);
  const role = raw.role;
  if (typeof role !== "string" || !(WRITER_ROLES as readonly string[]).includes(role)) {
    fail(`Choose composer, lyricist or arranger for ${name}.`);
  }
  const writer: CompositionWriter = { name, role: role as WriterRole };
  const share = normalizeShare(raw.share, name);
  if (share !== undefined) writer.share = share;
  if (raw.society !== undefined && raw.society !== null && raw.society !== "") {
    if (typeof raw.society !== "string" || !(COLLECTING_SOCIETIES as readonly string[]).includes(raw.society)) {
      fail(`Choose ${name}'s society from the list.`);
    }
    writer.society = raw.society as CollectingSociety;
  }
  const ipi = normalizeIpi(raw.ipi);
  if (ipi) writer.ipi = ipi;
  return writer;
}

/**
 * Validates and normalizes composition input. Returns null when nothing was
 * entered, so callers can skip storing an empty record.
 *
 * Shares are all-or-nothing: once any writer has a share, every writer needs
 * one and they must total 100.
 */
export function normalizeCompositionInput(input: unknown): CompositionData | null {
  if (input === undefined || input === null) return null;
  if (typeof input !== "object" || Array.isArray(input)) fail("Composition details are not valid.");
  const raw = input as Record<string, unknown>;

  const rawWriters = raw.writers ?? [];
  if (!Array.isArray(rawWriters)) fail("Writers must be a list.");
  if (rawWriters.length > MAX_WRITERS) fail(`A track can list at most ${MAX_WRITERS} writers.`);
  const writers = rawWriters.map(normalizeWriter);

  const withShare = writers.filter((writer) => writer.share !== undefined);
  if (withShare.length > 0) {
    if (withShare.length !== writers.length) fail("When you enter shares, give every writer a share.");
    const totalHundredths = withShare.reduce((sum, writer) => sum + Math.round((writer.share ?? 0) * 100), 0);
    if (totalHundredths !== 10000) {
      fail(`Writer shares must add up to 100%. They add up to ${totalHundredths / 100}%.`);
    }
  }

  const selfPublished = raw.selfPublished === true;
  const publisher = selfPublished ? null : optionalText(raw.publisher, "The publisher", MAX_PUBLISHER);
  const iswc = normalizeIswc(raw.iswc);
  const coverOrSamples = raw.coverOrSamples === true;
  const coverNote = coverOrSamples ? optionalText(raw.coverNote, "The cover or samples note", MAX_COVER_NOTE) : null;

  const data: CompositionData = { writers, publisher, selfPublished, iswc, coverOrSamples, coverNote };
  return isEmptyComposition(data) ? null : data;
}

export function isEmptyComposition(data: CompositionData): boolean {
  return (
    data.writers.length === 0 &&
    !data.publisher &&
    !data.selfPublished &&
    !data.iswc &&
    !data.coverOrSamples
  );
}

/** Reads a stored `writers` JSON value back; drops anything malformed. */
export function readStoredWriters(value: unknown): CompositionWriter[] {
  if (!Array.isArray(value)) return [];
  const writers: CompositionWriter[] = [];
  value.forEach((entry, index) => {
    try {
      writers.push(normalizeWriter(entry, index));
    } catch {
      // A stored row that no longer validates is left out of reads.
    }
  });
  return writers;
}

/** The public view: writer names and roles only. */
export function publicWriters(writers: CompositionWriter[]): Array<Pick<CompositionWriter, "name" | "role">> {
  return writers.map(({ name, role }) => ({ name, role }));
}
