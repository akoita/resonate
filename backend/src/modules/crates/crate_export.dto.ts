import { IsOptional } from "class-validator";
import type { CrateExportLicenseType, CrateExportSkipReason } from "./crate_export";

/**
 * HTTP contracts for exporting a crate to rekordbox or Serato (#1965,
 * docs/features/crate_digger.md).
 *
 * `POST /crates/:id/export` with `{ format: "rekordbox" | "serato", folder:
 * "<absolute path>" }` answers with the file itself (the folder is in the body,
 * not the URL, because proxies and load balancers log URLs; the issue text said
 * GET); `GET /crates/:id/export/manifest` answers with
 * {@link CrateExportManifestDto}. The file route validates `format` and
 * `folder` in the service, so every bad value (missing, wrong type, repeated)
 * answers with the fixed codes below rather than a generic pipe error. The folder is the DJ's own path on
 * their disk: it is written into the file and nowhere else, never stored and
 * never logged.
 */

/**
 * Body of `POST /crates/:id/export`. The fields are deliberately untyped for
 * the pipe (`unknown`): the service checks them and answers `invalid_format` /
 * `invalid_folder`.
 */
export class ExportCrateDto {
  @IsOptional()
  format?: unknown;

  /** The DJ's own path; never stored, never logged, never echoed. */
  @IsOptional()
  folder?: unknown;
}

/** One stem the DJ owns under a standard license, in crate order. */
export type CrateExportEntryDto = {
  /** 0-based position of the crate line. */
  position: number;
  trackId: string;
  stemId: string;
  stemType: string;
  title: string;
  artistName: string;
  /** The highest standard license the DJ owns for the stem. */
  licenseType: CrateExportLicenseType;
  /** The name to save the downloaded stem under; the files point at it. */
  fileName: string;
  /** Measured tempo, or null. */
  bpm: number | null;
  /** Key name such as "Am", or null. */
  key: string | null;
  camelot: string | null;
  /** Measured first beat in seconds, or null. */
  firstBeatSec: number | null;
  /** True when the rekordbox export carries a "First beat" cue for the stem. */
  hasCue: boolean;
};

/** A crate line with nothing to export, and why. */
export type CrateExportSkippedDto = {
  position: number;
  trackId: string;
  title: string;
  reason: CrateExportSkipReason;
};

export type CrateExportManifestDto = {
  entries: CrateExportEntryDto[];
  skipped: CrateExportSkippedDto[];
  notes: string[];
};

/** A generated export file, ready to send. */
export type CrateExportFile = {
  fileName: string;
  contentType: string;
  body: Buffer;
};
