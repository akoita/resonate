import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { prisma } from "../../db/prisma";
import { resolveCreditedArtistName } from "../shared/artist_attribution";
import { CrateEntitlementsService } from "./crate-entitlements";
import {
  assignStemFileNames,
  bestExportLicense,
  buildRekordboxXml,
  buildSeratoCrate,
  CRATE_EXPORT_UNKNOWN_ARTIST,
  crateFileName,
  exportFeatures,
  isCrateExportFormat,
  parseExportFolder,
  stemTypeRank,
  type CrateExportEntry,
  type CrateExportFormat,
  type CrateExportSkipReason,
} from "./crate_export";
import type {
  CrateExportEntryDto,
  CrateExportFile,
  CrateExportManifestDto,
  CrateExportSkippedDto,
} from "./crate_export.dto";

/**
 * Crate export (#1965, docs/features/crate_digger.md): the stems a DJ already
 * owns for a crate's tracks, as a rekordbox XML or a Serato crate.
 *
 * An entry is a CURRENT stem of a crate track that a purchase by the caller's
 * wallet covers under a personal, remix or commercial license (the standard
 * tiers all include the full-quality stem download). The ownership rule is the
 * one `POST /encryption/download` applies (a StemPurchase of the wallet for the
 * stem), so every exported file can be downloaded through that same licensed
 * path. Export never grants a right and never buys: it reads purchases and
 * writes a file. A line with no purchased stem is skipped `not_purchased`; a
 * line whose only purchases are sync, sample or broadcast licenses (no
 * standard terms) is skipped `no_export_right`.
 *
 * PRIVACY: the folder is the DJ's own path (it can contain a username). It goes
 * into the generated file and nowhere else: it is not stored, not logged and
 * not put in any error message. This service has no logger on purpose.
 *
 * Business model: ADR-BM-6 Line 3, phase 2 (export makes buying useful for a
 * working DJ); no fee change.
 */

/** Fixed codes for 4xx responses; never echo the input. */
export const CRATE_EXPORT_ERROR_CODES = {
  invalidFormat: "invalid_format",
  invalidFolder: "invalid_folder",
  noWallet: "no_wallet",
  nothingToExport: "nothing_to_export",
  proRequired: "pro_required",
} as const;

/** Stem types that are not a stem a DJ plays: the full mix and the master. */
const NON_STEM_TYPES = new Set(["original", "master"]);

type ExportPlan = {
  crateTitle: string | null;
  entries: CrateExportEntry[];
  skipped: CrateExportSkippedDto[];
  /** Owned stems left out because their only licenses have no standard terms. */
  droppedStems: number;
};

@Injectable()
export class CrateExportService {
  constructor(private readonly entitlements: CrateEntitlementsService) {}

  // -------------------------------------------------------------------------
  // GET /crates/:id/export/manifest
  // -------------------------------------------------------------------------

  async getManifest(userId: string, crateId: string): Promise<CrateExportManifestDto> {
    await this.requireEntitlement(userId);
    const plan = await this.buildPlan(userId, crateId);
    return {
      entries: plan.entries.map(toEntryDto),
      skipped: plan.skipped,
      notes: exportNotes(plan),
    };
  }

  // -------------------------------------------------------------------------
  // POST /crates/:id/export  { format, folder }
  // -------------------------------------------------------------------------

  async exportFile(
    userId: string,
    crateId: string,
    input: { format?: unknown; folder?: unknown },
  ): Promise<CrateExportFile> {
    if (!isCrateExportFormat(input.format)) {
      throw new BadRequestException({
        code: CRATE_EXPORT_ERROR_CODES.invalidFormat,
        message: "format must be rekordbox or serato",
      });
    }
    const format: CrateExportFormat = input.format;
    const folder = parseExportFolder(input.folder);
    if (!folder) {
      // Never echo the folder back.
      throw new BadRequestException({
        code: CRATE_EXPORT_ERROR_CODES.invalidFolder,
        message:
          "folder must be an absolute path, such as /Users/you/Music or C:\\Users\\you\\Music (at most 400 characters)",
      });
    }

    await this.requireEntitlement(userId);
    const plan = await this.buildPlan(userId, crateId);
    if (plan.entries.length === 0) {
      throw new ConflictException({
        code: CRATE_EXPORT_ERROR_CODES.nothingToExport,
        message: "No stem in this crate is owned under a license that includes export",
      });
    }

    if (format === "rekordbox") {
      const xml = buildRekordboxXml({ crateTitle: plan.crateTitle, folder, entries: plan.entries });
      return {
        fileName: crateFileName(plan.crateTitle, "xml"),
        contentType: "application/xml; charset=utf-8",
        body: Buffer.from(xml, "utf8"),
      };
    }
    return {
      fileName: crateFileName(plan.crateTitle, "crate"),
      contentType: "application/octet-stream",
      body: buildSeratoCrate({ folder, entries: plan.entries }),
    };
  }

  // -------------------------------------------------------------------------

  private async requireEntitlement(userId: string): Promise<void> {
    const decision = await this.entitlements.export(userId);
    if (!decision.allowed) {
      throw new ForbiddenException({
        code: CRATE_EXPORT_ERROR_CODES.proRequired,
        message: "Exporting a crate needs Crate Digger Pro",
      });
    }
  }

  /** The exportable stems and the skipped lines of the caller's crate. */
  private async buildPlan(userId: string, crateId: string): Promise<ExportPlan> {
    // Someone else's crate and an unknown id look identical: 404, never 403.
    const crate = await prisma.crate.findFirst({
      where: { id: crateId, userId },
      include: { items: { orderBy: [{ position: "asc" }, { id: "asc" }] } },
    });
    if (!crate) throw new NotFoundException("Crate not found");

    const wallet = await prisma.wallet.findUnique({ where: { userId } });
    if (!wallet?.address) {
      throw new ConflictException({
        code: CRATE_EXPORT_ERROR_CODES.noWallet,
        message: "A wallet is needed to export; create one first",
      });
    }

    const tracks = await prisma.track.findMany({
      where: { id: { in: crate.items.map((item) => item.trackId) } },
      select: {
        id: true,
        title: true,
        artist: true,
        release: {
          select: { primaryArtist: true, artist: { select: { displayName: true } } },
        },
        stems: {
          where: { isCurrent: true },
          select: { id: true, type: true, audioFeatures: true },
        },
      },
    });
    const trackById = new Map(tracks.map((track) => [track.id, track]));

    // The ownership rule of POST /encryption/download: a purchase by the
    // wallet whose listing sells the stem.
    const stemIds = tracks.flatMap((track) => track.stems.map((stem) => stem.id));
    const purchases =
      stemIds.length === 0
        ? []
        : await prisma.stemPurchase.findMany({
            where: {
              buyerAddress: wallet.address.toLowerCase(),
              listing: { stemId: { in: stemIds } },
            },
            select: { licenseType: true, listing: { select: { stemId: true } } },
          });
    const licensesByStem = new Map<string, string[]>();
    for (const purchase of purchases) {
      const stemId = purchase.listing.stemId;
      if (!stemId) continue;
      const owned = licensesByStem.get(stemId) ?? [];
      owned.push(purchase.licenseType);
      licensesByStem.set(stemId, owned);
    }

    type Draft = Omit<CrateExportEntry, "fileName">;
    const drafts: Draft[] = [];
    const skipped: CrateExportSkippedDto[] = [];
    const seenStems = new Set<string>();
    let droppedStems = 0;

    for (const item of crate.items) {
      const track = trackById.get(item.trackId);
      if (!track) continue;

      const original = track.stems.find((stem) => stem.type.toLowerCase() === "original");
      const artistName =
        resolveCreditedArtistName({
          trackArtist: track.artist,
          primaryArtist: track.release.primaryArtist,
          accountDisplayName: track.release.artist?.displayName ?? null,
        }) ?? CRATE_EXPORT_UNKNOWN_ARTIST;

      const stems = track.stems
        .filter((stem) => !NON_STEM_TYPES.has(stem.type.toLowerCase()))
        .sort(
          (a, b) =>
            stemTypeRank(a.type) - stemTypeRank(b.type) ||
            a.type.toLowerCase().localeCompare(b.type.toLowerCase()) ||
            a.id.localeCompare(b.id),
        );

      let ownedAny = false;
      let exported = 0;
      for (const stem of stems) {
        const licenses = licensesByStem.get(stem.id);
        if (!licenses || licenses.length === 0) continue;
        ownedAny = true;
        const licenseType = bestExportLicense(licenses);
        if (licenseType === null) {
          droppedStems += 1;
          continue;
        }
        if (seenStems.has(stem.id)) continue;
        seenStems.add(stem.id);
        exported += 1;

        const features = exportFeatures(stem.audioFeatures, original?.audioFeatures);
        drafts.push({
          position: item.position,
          trackId: track.id,
          stemId: stem.id,
          stemType: stem.type.toLowerCase(),
          title: track.title,
          artistName,
          licenseType,
          ...features,
        });
      }

      if (exported === 0) {
        const reason: CrateExportSkipReason = ownedAny ? "no_export_right" : "not_purchased";
        skipped.push({
          position: item.position,
          trackId: track.id,
          title: track.title,
          reason,
        });
      }
    }

    const fileNames = assignStemFileNames(drafts);
    return {
      crateTitle: crate.title,
      entries: drafts.map((draft, index) => ({ ...draft, fileName: fileNames[index] })),
      skipped,
      droppedStems,
    };
  }
}

function toEntryDto(entry: CrateExportEntry): CrateExportEntryDto {
  return {
    position: entry.position,
    trackId: entry.trackId,
    stemId: entry.stemId,
    stemType: entry.stemType,
    title: entry.title,
    artistName: entry.artistName,
    licenseType: entry.licenseType,
    fileName: entry.fileName,
    bpm: entry.bpm,
    key: entry.key,
    camelot: entry.camelot,
    firstBeatSec: entry.firstBeatSec,
    hasCue: entry.bpm !== null && entry.firstBeatSec !== null,
  };
}

/** Plain-language limits of the export, shown next to the manifest. */
function exportNotes(plan: ExportPlan): string[] {
  const notes = [
    "Only stems you own under a personal, remix or commercial license are exported. Exporting never grants a license.",
    "The files point at the folder you type, so save the downloaded stems there under the names listed here.",
    "The rekordbox file carries each stem's measured tempo and key, and a First beat cue where the first beat was measured.",
    "The Serato crate lists the files only: Serato reads tempo, key and cues from its own analysis or the file's tags, so the crate carries none of them.",
  ];
  const unmeasured = plan.entries.filter((entry) => entry.bpm === null).length;
  if (unmeasured > 0) {
    notes.push(
      `${unmeasured} ${unmeasured === 1 ? "stem has" : "stems have"} no measured tempo; your DJ software will analyze ${unmeasured === 1 ? "it" : "them"} on import.`,
    );
  }
  if (plan.droppedStems > 0) {
    notes.push(
      `${plan.droppedStems} purchased ${plan.droppedStems === 1 ? "stem is" : "stems are"} left out because the license has no standard terms (sync, sample or broadcast); the artist sets those terms.`,
    );
  }
  return notes;
}
