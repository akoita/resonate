import { Injectable } from "@nestjs/common";
import { once } from "events";
import { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";
import {
  PersonalDataResolverService,
  ResolvedPersonalIdentifiers,
} from "../identity/personal_data_resolver.service";
import { writeStructuredLog } from "../shared/structured_logging";
import {
  EXPORTED_MODELS,
  ExportedModel,
  PersonalDataKey,
  REDACTED_FIELDS,
} from "./personal_data_export_manifest";

export const PERSONAL_DATA_EXPORT_FORMAT = "resonate-personal-data-export";
export const PERSONAL_DATA_EXPORT_FORMAT_VERSION = 1;

/**
 * Rows read and written per round trip. Small enough that peak memory is a
 * function of the batch, not of how much data a person has; large enough that
 * a person with a hundred thousand analytics events does not pay for a hundred
 * thousand round trips.
 */
const BATCH_SIZE = 500;

export interface PersonalDataExportSubject {
  userId: string;
  email: string | null;
  walletAddresses: string[];
  ownerAddresses: string[];
  artistIds: string[];
  analyticsActorId: string | null;
}

export interface PreparedPersonalDataExport {
  subject: PersonalDataExportSubject;
  /**
   * Streams the document to `out`. Everything that can fail with a status code
   * — an unknown user, above all — has already failed by the time this is
   * called, because once the first byte is written the status code is fixed.
   */
  writeTo(out: NodeJS.WritableStream): Promise<void>;
}

/**
 * Plain-language orientation shipped inside the file. The person receiving
 * this has asked what we hold about them; a wall of table names with no
 * explanation is a compliance gesture, not an answer.
 */
const READ_ME = {
  whatThisIs:
    "Everything Resonate holds that is linked to your account, exported at your request. "
    + "Under \"data\" there is one section per table we store you in, and under \"counts\" "
    + "the number of records in each.",
  howToRead:
    "This is a JSON file. Any text editor will open it, and a JSON viewer will make it easier "
    + "to read. Each record appears exactly as we store it, so some fields are internal "
    + "identifiers that only mean something inside Resonate.",
  howWeFoundIt:
    "Your data is not filed under one identifier. We looked you up by your account id, by every "
    + "wallet address linked to your account, by the address that controls those wallets, by your "
    + "artist profile ids, and by the pseudonymous id your analytics are recorded under. All of "
    + "them are listed under \"subject\", and all of them were used to build this file.",
  whatIsWithheld:
    "Security material — agent private keys, passkey key material, wallet derivation salts, "
    + "integration webhook URLs — is withheld. The records themselves are here so you can see what "
    + "exists and revoke it; their contents are not, because sending them to you would create a "
    + "second copy of the thing that protects your account.",
  howToTellItIsComplete:
    "A finished export ends with \"complete\": true. If that is missing the download was "
    + "interrupted and this file is partial — please request it again.",
  questions:
    "If something here is wrong, or you want it deleted, use the privacy settings in the app.",
} as const;

/**
 * The honest limits, in the same terms the privacy policy uses. Written as
 * statements of fact rather than reassurance: a person deciding whether to
 * trust us with more data is entitled to know what we cannot undo.
 */
const NOT_INCLUDED: ReadonlyArray<{ what: string; why: string }> = [
  {
    what: "The blockchain records themselves",
    why:
      "Purchases, mints, royalty payments and pledges are written to a public ledger that we "
      + "cannot alter or delete. This file contains our copy of those records; the ledger keeps "
      + "its own, permanently.",
  },
  {
    what: "Content published to IPFS",
    why:
      "Audio, artwork and metadata published to IPFS may be held by nodes we do not control. We "
      + "can stop serving our copy; we cannot make another node forget theirs.",
  },
  {
    what: "Analytics preserved for audit",
    why:
      "Some analytics events and the governance log that records what was deleted are retained "
      + "under our retention policy, so that a deletion stays provable. Those still linked to you "
      + "are included here.",
  },
  {
    what: "Security material",
    why:
      "Agent private keys, passkey key material and wallet derivation salts are withheld. Their "
      + "records appear in the export so you can see what is registered against your account.",
  },
  {
    what: "Audio and image files",
    why:
      "This is a data file. The tracks, stems and artwork you uploaded remain available through "
      + "the app rather than being inlined here as binary.",
  },
  {
    what: "Reports other people filed",
    why:
      "A takedown notice or moderation report written about you contains the reporter's own "
      + "personal data. That is theirs to request, not yours.",
  },
];

/**
 * Hex-shaped values are safe to compare with Prisma's case-insensitive
 * `equals`, which Postgres implements with `ILIKE`: `%` and `_` are wildcards
 * there, so a value containing either would widen the match. Every address the
 * resolver returns is hex today; anything else falls back to a case-sensitive
 * comparison rather than being trusted into a pattern match.
 */
const HEX_VALUE = /^0x[0-9a-f]+$/;

type PrismaDelegate = {
  findMany(args: Record<string, unknown>): Promise<Array<Record<string, unknown>>>;
};

/** Prisma exposes `SessionKey` as `prisma.sessionKey`. */
function delegateName(model: string): string {
  return model.charAt(0).toLowerCase() + model.slice(1);
}

const COLUMN_CACHE = new Map<string, string[]>();

/**
 * The columns of a model that may be read, derived from the generated DMMF
 * minus anything REDACTED_FIELDS names.
 *
 * Deriving the list rather than writing `select: { ... }` by hand means a new
 * column is exported automatically — which is the right default for a person's
 * own data, and is made safe by the manifest test, which forces any new column
 * with a sensitive-looking name to be classified before it can ship.
 *
 * Redacted columns are excluded from the `select`, so they are never read out
 * of the database at all. Redaction is not a filter applied to a row that has
 * already been loaded into memory and could be logged by accident.
 */
function exportableColumns(model: string): string[] {
  const cached = COLUMN_CACHE.get(model);
  if (cached) return cached;

  const definition = Prisma.dmmf.datamodel.models.find((candidate) => candidate.name === model);
  if (!definition) {
    throw new Error(`Exported model ${model} is not in the Prisma datamodel`);
  }
  const redacted = REDACTED_FIELDS[model] ?? {};
  const columns = definition.fields
    .filter((field) => field.kind === "scalar" || field.kind === "enum")
    .map((field) => field.name)
    .filter((name) => !(name in redacted));
  COLUMN_CACHE.set(model, columns);
  return columns;
}

function selectClause(model: string): Record<string, true> {
  return Object.fromEntries(exportableColumns(model).map((column) => [column, true]));
}

/**
 * Wallet-keyed tables hold the same address in more than one case. The
 * notification service lowercases on one path and passes the EIP-55
 * checksummed value straight through on four others, and
 * `SignupFaucetAttempt`'s unique constraint is case-sensitive, so the database
 * can already hold two rows that are the same address written differently.
 * `PersonalDataResolverService` returns lowercase.
 *
 * A case-sensitive `in:` would therefore match the lowercase rows, miss the
 * checksummed ones, and produce an export that looks complete. Reverting this
 * to a case-sensitive comparison to regain index usage would silently
 * under-export — the durable fix is normalizing addresses at write time and
 * backfilling, which is slice 3's first decision.
 */
function addressCondition(column: string, addresses: string[]): Record<string, unknown> | undefined {
  if (addresses.length === 0) return undefined;
  return {
    OR: addresses.map((address) => ({
      [column]: HEX_VALUE.test(address)
        ? { equals: address, mode: "insensitive" }
        : { equals: address },
    })),
  };
}

function keyCondition(
  key: PersonalDataKey,
  identifiers: ResolvedPersonalIdentifiers,
): Record<string, unknown> | undefined {
  switch (key.kind) {
    case "userId":
      return { [key.column]: identifiers.userId };
    case "artistId":
      return identifiers.artistIds.length > 0
        ? { [key.column]: { in: identifiers.artistIds } }
        : undefined;
    case "sessionId":
      return identifiers.sessionIds.length > 0
        ? { [key.column]: { in: identifiers.sessionIds } }
        : undefined;
    case "actorId":
      return identifiers.actorId ? { [key.column]: identifiers.actorId } : undefined;
    case "address":
      return addressCondition(key.column, [
        ...identifiers.walletAddresses,
        ...identifiers.ownerAddresses,
      ]);
  }
}

/**
 * The OR across a model's declared keys, or `undefined` when none of them can
 * be satisfied — a person with no wallet cannot match a wallet-keyed table, and
 * querying with an empty disjunction would be a needless round trip.
 */
export function whereForModel(
  entry: ExportedModel,
  identifiers: ResolvedPersonalIdentifiers,
): Record<string, unknown> | undefined {
  const conditions = entry.keys
    .map((key) => keyCondition(key, identifiers))
    .filter((condition): condition is Record<string, unknown> => condition !== undefined);
  if (conditions.length === 0) return undefined;
  return conditions.length === 1 ? conditions[0] : { OR: conditions };
}

/**
 * Prisma's runtime types do not all survive `JSON.stringify`: a `BigInt`
 * throws outright, and a `Decimal` or `Buffer` serializes into something a
 * reader cannot use. Because the response streams, a throw here happens after
 * the status line is long gone, so the conversion is done before the value
 * reaches the serializer rather than being left to a replacer.
 */
export function toSerializable(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Prisma.Decimal) return value.toString();
  if (Buffer.isBuffer(value)) return value.toString("base64");
  if (value instanceof Uint8Array) return Buffer.from(value).toString("base64");
  if (Array.isArray(value)) return value.map(toSerializable);
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        toSerializable(entry),
      ]),
    );
  }
  return value;
}

/** Writes to a stream while respecting backpressure, so a slow client cannot force the whole export into memory. */
async function writeChunk(out: NodeJS.WritableStream, chunk: string): Promise<void> {
  if (!out.write(chunk)) {
    await once(out, "drain");
  }
}

@Injectable()
export class PersonalDataExportService {
  constructor(private readonly resolver: PersonalDataResolverService) {}

  /**
   * Resolve the person, then hand back something that can stream their file.
   *
   * The two steps are separate on purpose: `resolve` throws `NotFoundException`
   * for an unknown user, and that has to happen before the caller sets a
   * `200 OK` and an attachment header it can no longer take back.
   */
  async prepare(userId: string): Promise<PreparedPersonalDataExport> {
    const identifiers = await this.resolver.resolve(userId);
    const account = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });

    const subject: PersonalDataExportSubject = {
      userId: identifiers.userId,
      email: account?.email ?? null,
      walletAddresses: identifiers.walletAddresses,
      ownerAddresses: identifiers.ownerAddresses,
      artistIds: identifiers.artistIds,
      analyticsActorId: identifiers.actorId ?? null,
    };

    return {
      subject,
      writeTo: (out) => this.writeDocument(identifiers, subject, out),
    };
  }

  private async writeDocument(
    identifiers: ResolvedPersonalIdentifiers,
    subject: PersonalDataExportSubject,
    out: NodeJS.WritableStream,
  ): Promise<void> {
    const counts: Record<string, number> = {};

    await writeChunk(
      out,
      `{"format":${JSON.stringify(PERSONAL_DATA_EXPORT_FORMAT)}`
        + `,"formatVersion":${PERSONAL_DATA_EXPORT_FORMAT_VERSION}`
        + `,"exportedAt":${JSON.stringify(new Date().toISOString())}`
        + `,"subject":${JSON.stringify(subject)}`
        + `,"readMe":${JSON.stringify(READ_ME)}`
        + `,"notIncluded":${JSON.stringify(NOT_INCLUDED)}`
        + `,"data":{`,
    );

    let model = "";
    try {
      let first = true;
      for (const entry of EXPORTED_MODELS) {
        model = entry.model;
        await writeChunk(out, `${first ? "" : ","}${JSON.stringify(entry.model)}:[`);
        first = false;
        counts[entry.model] = await this.writeModelRows(entry, identifiers, out);
        await writeChunk(out, "]");
      }
      await writeChunk(
        out,
        `},"counts":${JSON.stringify(counts)}`
          // Written last, and only on the success path. The status code was
          // sent with the first byte and cannot be revised, so the absence of
          // this flag is the only signal a reader has that the file is partial.
          + `,"complete":true}`,
      );
    } catch (error) {
      // Deliberately not rethrown: the response is already in flight, so a
      // thrown exception would only produce a "headers already sent" error on
      // top of a truncated body. The body stops mid-document, `complete` never
      // appears, and the reason is recorded here rather than shown to the user.
      writeStructuredLog({
        level: "error",
        event: "privacy.personal_data_export.failed",
        message: "Personal data export failed mid-stream and was left incomplete",
        userId: subject.userId,
        model,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Cursor-paginate one model, writing each batch as it is read. Nothing
   * accumulates across batches, so peak memory is bounded by BATCH_SIZE rather
   * than by the size of the person's history.
   */
  private async writeModelRows(
    entry: ExportedModel,
    identifiers: ResolvedPersonalIdentifiers,
    out: NodeJS.WritableStream,
  ): Promise<number> {
    const where = whereForModel(entry, identifiers);
    if (!where) return 0;

    const delegate = (prisma as unknown as Record<string, PrismaDelegate>)[
      delegateName(entry.model)
    ];
    if (!delegate) {
      throw new Error(`No Prisma delegate for exported model ${entry.model}`);
    }

    const select = selectClause(entry.model);
    let cursor: string | undefined;
    let written = 0;

    for (;;) {
      const rows = await delegate.findMany({
        where,
        select,
        orderBy: { [entry.primaryKey]: "asc" },
        take: BATCH_SIZE,
        ...(cursor === undefined ? {} : { cursor: { [entry.primaryKey]: cursor }, skip: 1 }),
      });
      if (rows.length === 0) break;

      const batch = rows
        .map((row) => JSON.stringify(toSerializable(row)))
        .join(",");
      await writeChunk(out, `${written === 0 ? "" : ","}${batch}`);
      written += rows.length;

      if (rows.length < BATCH_SIZE) break;
      const last = rows[rows.length - 1][entry.primaryKey];
      if (typeof last !== "string") {
        throw new Error(
          `Cannot paginate ${entry.model}: primary key ${entry.primaryKey} is not a string`,
        );
      }
      cursor = last;
    }

    return written;
  }
}
