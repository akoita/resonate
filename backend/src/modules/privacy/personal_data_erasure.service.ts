import { Injectable, NotFoundException } from "@nestjs/common";
import { AccountClosureRequest, Prisma } from "@prisma/client";
import { randomUUID } from "crypto";
import { prisma } from "../../db/prisma";
import { AnalyticsGovernanceService } from "../analytics/analytics_governance.service";
import {
  RELEASE_STATUS_WITHDRAWN,
  WITHDRAWABLE_RELEASE_STATUSES,
} from "../catalog/track-availability";
import {
  PersonalDataResolverService,
  ResolvedPersonalIdentifiers,
} from "../identity/personal_data_resolver.service";
import { writeStructuredLog } from "../shared/structured_logging";
import { AccountClosureService } from "./account_closure.service";
import {
  DANGLING_PERSON_COLUMNS,
  ERASURE_RULES,
  ErasureRule,
  erasedEmailFor,
} from "./personal_data_erasure_manifest";

/**
 * The engine that executes an erasure (#1771 slice 3).
 *
 * `personal_data_erasure_manifest.ts` declares what happens to every model;
 * this file does it, and nothing here decides a disposition. A model missing
 * from the manifest is a model this engine never touches, which is why the
 * manifest's coverage test — not this file — is what keeps the schema honest.
 *
 * ## Why the order below is the whole design
 *
 * **Analytics run first, outside the transaction.** The pseudonymous
 * `actorId` is derived from `User.id` by `pseudonymousAnalyticsActorId`; rotate
 * the id first and every historical actor id becomes underivable, so the
 * person's analytics can no longer be found and the erasure reports success
 * having missed all of it. That is the same failure mode the inventory
 * documents for salt rotation.
 *
 * They cannot join the transaction either: `AnalyticsGovernanceService` calls
 * out to BigQuery, and a Postgres transaction held open across a network round
 * trip to a warehouse is a lock nobody can bound. So the boundary is
 * deliberate. Warehouse mutation happens before Postgres under the same lock
 * used by warehouse loads. A temporary warehouse refusal therefore leaves the
 * source rows intact and the closure pending, so the next scheduled attempt
 * still has the event ids it needs and sign-in can still cancel the request.
 *
 * **Everything else is one transaction.** An account half-erased is worse than
 * an account not erased: it has lost the rows that made it usable and kept the
 * ones that identify the person.
 *
 * **Matching happens before rotation.** Every scrub, delete and detach below
 * matches on the identifiers resolved *before* anything changed. The id
 * rotation is the last write in the transaction, followed only by the dangling
 * columns that `ON UPDATE CASCADE` cannot reach.
 */

/** Rows read per page when a model has to be walked row by row. */
const RELEASE_PAGE_SIZE = 500;

/**
 * Generous, because this is one transaction across dozens of models and a
 * person with a long history is exactly the person most likely to ask to
 * leave. A timeout here is a rollback, not a half-erasure, so the cost of
 * being generous is a retry rather than damage.
 */
const TRANSACTION_TIMEOUT_MS = 120_000;
const TRANSACTION_MAX_WAIT_MS = 15_000;

/** Recorded on releases withdrawn by an erasure. Deliberately names nobody. */
const ERASURE_WITHDRAWAL_REASON =
  "Withdrawn from streaming because the artist account behind it was erased (#1771).";

/** The reason handed to `AnalyticsGovernanceService` and written into its lineage. */
const ANALYTICS_ERASURE_REASON = "account_erasure";

export class RetryableAnalyticsErasureError extends Error {
  constructor(readonly warehouseStatuses: string[]) {
    super(`Analytics warehouse erasure incomplete: ${warehouseStatuses.join(", ")}`);
    this.name = "RetryableAnalyticsErasureError";
  }
}

/**
 * Hex-shaped values are safe to compare with Prisma's case-insensitive
 * `equals`, which Postgres implements with `ILIKE`: `%` and `_` are wildcards
 * there, so a value containing either would widen the match — and a widened
 * match in an erasure deletes somebody else's rows. Every address the resolver
 * returns is hex today; anything else falls back to a case-sensitive
 * comparison. The same guard the export service documents.
 */
const HEX_VALUE = /^0x[0-9a-f]+$/;

/**
 * How a model's rows are found for this person.
 *
 * `address` is matched case-insensitively: the wallet-keyed tables
 * (`CuratorReputation`, `Notification`, `NotificationPreference`) hold the same
 * address in several casings, and under-deleting is worse than under-exporting
 * — a missed row keeps the address forever. Normalising addresses at write time
 * plus a backfill is the durable fix and is explicitly deferred; until then
 * every address comparison in this file is case-insensitive.
 */
type PersonKeyKind = "userId" | "address" | "artistId";

interface PersonKey {
  kind: PersonKeyKind;
  column: string;
}

/**
 * Models whose person column cannot be derived from a declared `User` relation,
 * each with the reason. Everything else is derived from the datamodel, so a new
 * model with an ordinary `user` relation is handled without an edit here — and
 * a new model with neither a relation nor an entry fails loudly before any row
 * is touched rather than being silently skipped.
 *
 * `"cascade"` means the rows go with their parent's delete and must not be
 * matched directly.
 */
const PERSON_KEY_OVERRIDES: Readonly<Record<string, readonly PersonKey[] | "cascade">> = {
  // Dangling `userId`: no declared relation, so nothing derives it.
  WebAuthnCredential: [{ kind: "userId", column: "userId" }],
  // Dangling `userId` *and* the address it maps to. Matching both is the point
  // of the row: it is the address-to-account mapping erasure has to sever.
  SignupFaucetAttempt: [
    { kind: "userId", column: "userId" },
    { kind: "address", column: "walletAddress" },
  ],
  // Keyed by wallet address only; there is no user column to find them by.
  Notification: [{ kind: "address", column: "walletAddress" }],
  NotificationPreference: [{ kind: "address", column: "walletAddress" }],
  // ON DELETE CASCADE from CommunityDiscordBridge, which this engine deletes.
  CommunityDiscordRoleMapping: "cascade",
  CommunityDiscordSyncAttempt: "cascade",
};

/**
 * What one erasure did, in counts.
 *
 * **Counts, never values.** Writing the person's addresses into the record that
 * proves we removed them would create a fresh copy of the data. The rotated id
 * is included because it is a fresh UUID that names nobody; the *pre*-rotation
 * id is deliberately absent, because for a wallet or passkey account it is the
 * person's wallet address. `describeResolvedIdentifiers` is the precedent.
 */
export interface AccountErasureSummary {
  status: "erased" | "already_erased";
  /** The rotated `User.id`. Safe to log: a UUID generated during the erasure. */
  newUserId: string;
  erasedAt: string;
  identifiers: {
    hasActorId: boolean;
    walletAddressCount: number;
    ownerAddressCount: number;
    artistIdCount: number;
    sessionIdCount: number;
  };
  analytics: {
    governanceCalls: number;
    matched: number;
    deleted: number;
    redacted: number;
    warehouseStatuses: string[];
  };
  /** Model name to affected-row count, for each thing the manifest asked for. */
  detached: Record<string, number>;
  deleted: Record<string, number>;
  anonymized: Record<string, number>;
  danglingRewritten: Record<string, number>;
  releasesWithdrawn: number;
}

export interface DueAccountErasureOutcome {
  requestId: string;
  status: "erased" | "already_erased" | "failed";
  /** Present on success. Never the pre-rotation id. */
  newUserId?: string;
  /** Operator-facing detail, also written durably to the request row. */
  error?: string;
}

export interface RunDueAccountErasuresResult {
  status: "ok" | "failures";
  ranAt: string;
  due: number;
  erased: number;
  failed: number;
  results: DueAccountErasureOutcome[];
}

type ErasureDelegate = {
  findMany(args: Record<string, unknown>): Promise<Array<Record<string, unknown>>>;
  update(args: Record<string, unknown>): Promise<unknown>;
  updateMany(args: Record<string, unknown>): Promise<{ count: number }>;
  deleteMany(args: Record<string, unknown>): Promise<{ count: number }>;
};

type TransactionClient = Omit<
  typeof prisma,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

/** Prisma exposes `SessionKey` as `prisma.sessionKey`. */
function delegateName(model: string): string {
  return model.charAt(0).toLowerCase() + model.slice(1);
}

function delegateFor(client: TransactionClient | typeof prisma, model: string): ErasureDelegate {
  const delegate = (client as unknown as Record<string, ErasureDelegate>)[delegateName(model)];
  if (!delegate) {
    throw new Error(`No Prisma delegate for erasure model ${model}`);
  }
  return delegate;
}

function modelDefinition(model: string) {
  const definition = Prisma.dmmf.datamodel.models.find((candidate) => candidate.name === model);
  if (!definition) {
    throw new Error(`Erasure model ${model} is not in the Prisma datamodel`);
  }
  return definition;
}

function fieldDefinition(model: string, column: string) {
  const field = modelDefinition(model).fields.find((candidate) => candidate.name === column);
  if (!field) {
    throw new Error(`Erasure column ${model}.${column} is not in the Prisma datamodel`);
  }
  return field;
}

/**
 * The kind of identifier a column holds, from its name and its relations.
 *
 * Address columns are the ones that cannot be found any other way — they are
 * the person themselves rather than a pointer to them.
 */
export function personKeyForColumn(model: string, column: string): PersonKey {
  const definition = modelDefinition(model);
  const relation = definition.fields.find(
    (field) =>
      field.kind === "object"
      && (field.relationFromFields ?? []).includes(column),
  );
  if (relation?.type === "Artist") return { kind: "artistId", column };
  if (relation?.type === "User") return { kind: "userId", column };
  if (/address$/i.test(column)) return { kind: "address", column };
  return { kind: "userId", column };
}

/**
 * Every column a model's rows can be found by for one person.
 *
 * Derived from the datamodel — a declared `User` relation first, then an
 * `Artist` relation for artist-scoped rows — and overridden only where neither
 * exists. Throws rather than returning an empty list: a `delete` rule whose
 * rows cannot be found is an erasure that silently keeps them.
 */
export function personKeysForModel(model: string): readonly PersonKey[] | "cascade" {
  const override = PERSON_KEY_OVERRIDES[model];
  if (override) return override;

  const definition = modelDefinition(model);
  const userColumns = definition.fields
    .filter((field) => field.kind === "object" && field.type === "User")
    .flatMap((field) => field.relationFromFields ?? []);
  if (userColumns.length > 0) {
    return userColumns.map((column) => ({ kind: "userId" as const, column }));
  }

  const artistColumns = definition.fields
    .filter((field) => field.kind === "object" && field.type === "Artist")
    .flatMap((field) => field.relationFromFields ?? []);
  if (artistColumns.length > 0) {
    return artistColumns.map((column) => ({ kind: "artistId" as const, column }));
  }

  throw new Error(
    `No person key for erasure model ${model}: add it to PERSON_KEY_OVERRIDES with a reason`,
  );
}

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
  key: PersonKey,
  identifiers: ResolvedPersonalIdentifiers,
): Record<string, unknown> | undefined {
  switch (key.kind) {
    case "userId":
      return { [key.column]: identifiers.userId };
    case "artistId":
      return identifiers.artistIds.length > 0
        ? { [key.column]: { in: identifiers.artistIds } }
        : undefined;
    case "address":
      return addressCondition(key.column, [
        ...identifiers.walletAddresses,
        ...identifiers.ownerAddresses,
      ]);
  }
}

/**
 * The OR across a model's person keys, or `undefined` when none of them can be
 * satisfied — a person with no wallet cannot match a wallet-keyed table, and
 * an empty disjunction would be a `where: {}` that matches every row in it.
 */
export function whereForKeys(
  keys: readonly PersonKey[],
  identifiers: ResolvedPersonalIdentifiers,
): Record<string, unknown> | undefined {
  const conditions = keys
    .map((key) => keyCondition(key, identifiers))
    .filter((condition): condition is Record<string, unknown> => condition !== undefined);
  if (conditions.length === 0) return undefined;
  return conditions.length === 1 ? conditions[0] : { OR: conditions };
}

function isFunctionDefault(value: unknown): boolean {
  return (
    typeof value === "object"
    && value !== null
    && !Array.isArray(value)
    && "name" in (value as Record<string, unknown>)
  );
}

/**
 * What a scrubbed column is set to: null where the schema allows it, the
 * column's own default where it does not, and a typed empty value where there
 * is neither.
 *
 * Derived from the datamodel rather than written out per column, so a column
 * added to a `scrub` list cannot be scrubbed with a value its type rejects at
 * the last step of an irreversible operation. A type with no safe empty value
 * throws — before the transaction opens, because every scrub payload is built
 * up front.
 */
export function scrubValueFor(model: string, column: string): unknown {
  const field = fieldDefinition(model, column);
  if (!field.isRequired) {
    // A nullable Json column is SQL NULL, which Prisma spells `DbNull`;
    // passing a bare `null` there is a runtime error.
    return field.type === "Json" ? Prisma.DbNull : null;
  }
  if (field.hasDefaultValue && !isFunctionDefault(field.default)) {
    return field.default;
  }
  if (field.isList) return [];
  switch (field.type) {
    case "String":
      return "";
    case "Boolean":
      return false;
    case "Int":
    case "Float":
      return 0;
    case "BigInt":
      return BigInt(0);
    case "Json":
      return {};
    default:
      throw new Error(
        `Cannot scrub ${model}.${column}: ${field.type} is required with no default and no safe empty value`,
      );
  }
}

/** The `data` payload that scrubs one rule's declared columns. */
export function scrubPayloadFor(rule: ErasureRule): Record<string, unknown> {
  return Object.fromEntries(
    (rule.scrub ?? []).map((column) => [column, scrubValueFor(rule.model, column)]),
  );
}

function rulesWith(disposition: ErasureRule["disposition"]): ErasureRule[] {
  return ERASURE_RULES.filter((rule) => rule.disposition === disposition);
}

@Injectable()
export class PersonalDataErasureService {
  constructor(
    private readonly resolver: PersonalDataResolverService,
    private readonly analyticsGovernance: AnalyticsGovernanceService,
    private readonly closures: AccountClosureService,
  ) {}

  /**
   * Erase one person, in the order the file header explains.
   *
   * Irreversible. The only early exit is an account already erased, which is
   * how a re-run of a half-finished request becomes a no-op instead of an
   * error: the id has already rotated, so the second pass is handed the new id
   * and finds `erasedAt` set.
   */
  async eraseAccount(userId: string): Promise<AccountErasureSummary> {
    const account = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, erasedAt: true },
    });
    if (!account) {
      throw new NotFoundException(`User ${userId} not found`);
    }
    if (account.erasedAt) {
      // Already done. Not an error: the scheduler re-running a request whose
      // completion never got written must find a no-op here, not a throw.
      return alreadyErasedSummary(account.id, account.erasedAt);
    }

    // 1. Every identifier, captured before anything changes. `oldUserId` is the
    //    value the analytics store and the dangling columns hold, and after the
    //    rotation nothing can derive it again.
    const identifiers = await this.resolver.resolve(userId);

    // 2. Analytics, before the rotation makes the actor id underivable, and
    //    outside the transaction because this reaches BigQuery.
    const analytics = await this.eraseAnalytics(identifiers);

    const newUserId = randomUUID();
    const erasedAt = new Date();

    // 3. Everything else, atomically.
    const counts = await prisma.$transaction(
      async (tx) => this.applyManifest(tx, identifiers, newUserId, erasedAt),
      { timeout: TRANSACTION_TIMEOUT_MS, maxWait: TRANSACTION_MAX_WAIT_MS },
    );

    const summary: AccountErasureSummary = {
      status: "erased",
      newUserId,
      erasedAt: erasedAt.toISOString(),
      identifiers: describeErasedIdentifiers(identifiers),
      analytics,
      ...counts,
    };

    // 4. The governance record. Counts, never values: the person's addresses
    //    must not be written into the log that proves we removed them. The old
    //    user id is not here for exactly that reason.
    writeStructuredLog({
      level: "info",
      event: "privacy.account_erasure.completed",
      message: "Account erased: personal data removed, retained records anonymized in place",
      newUserId,
      erasedAt: summary.erasedAt,
      identifiers: summary.identifiers,
      analytics: summary.analytics,
      detached: summary.detached,
      deleted: summary.deleted,
      anonymized: summary.anonymized,
      danglingRewritten: summary.danglingRewritten,
      releasesWithdrawn: summary.releasesWithdrawn,
    });

    return summary;
  }

  /**
   * Run the erasures whose 30-day window has elapsed.
   *
   * This is the scheduler's entry point: there is no `@Cron` anywhere in this
   * codebase, scheduled work is driven externally by hitting the maintenance
   * routes. Each request is settled independently, so one person's failure does
   * not strand the queue behind it.
   */
  async runDueErasures(options?: { now?: Date; limit?: number }): Promise<RunDueAccountErasuresResult> {
    const now = options?.now ?? new Date();
    const due = await this.closures.listDue(now, options?.limit);
    const results: DueAccountErasureOutcome[] = [];

    for (const request of due) {
      results.push(await this.runOneDueErasure(request));
    }

    const failed = results.filter((result) => result.status === "failed").length;
    return {
      status: failed === 0 ? "ok" : "failures",
      ranAt: now.toISOString(),
      due: due.length,
      erased: results.length - failed,
      failed,
      results,
    };
  }

  private async runOneDueErasure(request: AccountClosureRequest): Promise<DueAccountErasureOutcome> {
    try {
      const summary = await this.eraseAccount(request.userId);
      await this.closures.markCompleted(request.id);
      return { requestId: request.id, status: summary.status, newUserId: summary.newUserId };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Durable before visible: the message is written onto the request row, so
      // a failure survives the process that logged it and is readable from the
      // database rather than only from a log search.
      try {
        if (error instanceof RetryableAnalyticsErasureError) {
          await this.closures.recordAttemptFailure(request.id, message);
        } else {
          await this.closures.markFailed(request.id, message);
        }
      } catch (settleError) {
        writeStructuredLog({
          level: "error",
          event: "privacy.account_erasure.unsettled",
          message: "Account erasure failed and the request could not be marked failed",
          requestIdRef: request.id,
          error: settleError instanceof Error ? settleError.message : String(settleError),
        });
      }
      writeStructuredLog({
        level: "error",
        event: "privacy.account_erasure.failed",
        message: "Account erasure failed; the closure request records the reason",
        requestIdRef: request.id,
        error: message,
      });
      return { requestId: request.id, status: "failed", error: message };
    }
  }

  /**
   * Hand the person's analytics to `AnalyticsGovernanceService` (#1770), which
   * owns the event store, the warehouse mirror and the deletion lineage. None
   * of that is reimplemented here.
   *
   * Three identifier shapes have to be driven, not one:
   *
   * - the **pseudonymous actor id**, which most events are keyed by;
   * - the **raw pre-rotation user id**, because
   *   `analytics_domain_event_bridge.service.ts` declares `actorIdKeys: ["userId"]`
   *   and `subjectIdKeys: ["userId"]` for around twenty event types and nothing
   *   on the ingest path pseudonymizes it — for a wallet account that column
   *   holds the wallet address verbatim;
   * - the **wallet and owner addresses**, which two bridge configs write as an
   *   actor id outright (`sellerAddress`, `resolverAddress`).
   *
   * The exact stored values are discovered first, case-insensitively, and then
   * handed back to the governance service one by one. `propagateDeletion`
   * matches exactly, so an address stored checksummed while the resolver
   * returns lowercase would otherwise survive both the event store and the
   * warehouse. Discovery is a read; the deletion is entirely the service's.
   */
  private async eraseAnalytics(identifiers: ResolvedPersonalIdentifiers) {
    const candidates = unique([
      identifiers.actorId,
      identifiers.userId,
      ...identifiers.walletAddresses,
      ...identifiers.ownerAddresses,
    ]);

    const [actorIds, subjects] = await Promise.all([
      this.storedAnalyticsActorIds(candidates),
      this.storedAnalyticsSubjects(candidates),
    ]);

    const totals = { governanceCalls: 0, matched: 0, deleted: 0, redacted: 0 };
    const warehouseStatuses: string[] = [];

    const record = (outcome: Awaited<ReturnType<AnalyticsGovernanceService["propagateDeletion"]>>) => {
      totals.governanceCalls += 1;
      totals.matched += outcome.matched;
      totals.deleted += outcome.deleted;
      totals.redacted += outcome.redacted;
      warehouseStatuses.push(outcome.warehouse.status);
    };

    for (const actorId of actorIds) {
      record(
        await this.analyticsGovernance.propagateDeletion({
          actorId,
          reason: ANALYTICS_ERASURE_REASON,
        }),
      );
    }
    for (const subject of subjects) {
      record(
        await this.analyticsGovernance.propagateDeletion({
          subjectType: subject.subjectType,
          subjectId: subject.subjectId,
          reason: ANALYTICS_ERASURE_REASON,
        }),
      );
    }

    const statuses = unique(warehouseStatuses);
    if (statuses.includes("failed")) throw new RetryableAnalyticsErasureError(statuses);
    return { ...totals, warehouseStatuses: statuses };
  }

  private async storedAnalyticsActorIds(candidates: string[]): Promise<string[]> {
    if (candidates.length === 0) return [];
    const rows = await prisma.analyticsEvent.findMany({
      where: { OR: candidates.map((value) => ({ actorId: caseTolerant(value) })) },
      select: { actorId: true },
      distinct: ["actorId"],
    });
    return unique(rows.map((row) => row.actorId));
  }

  private async storedAnalyticsSubjects(
    candidates: string[],
  ): Promise<Array<{ subjectType: string; subjectId: string }>> {
    if (candidates.length === 0) return [];
    const rows = await prisma.analyticsEvent.findMany({
      where: {
        subjectType: { not: null },
        OR: candidates.map((value) => ({ subjectId: caseTolerant(value) })),
      },
      select: { subjectType: true, subjectId: true },
      distinct: ["subjectType", "subjectId"],
    });
    return rows
      .filter((row): row is { subjectType: string; subjectId: string } =>
        typeof row.subjectType === "string" && typeof row.subjectId === "string")
      .map((row) => ({ subjectType: row.subjectType, subjectId: row.subjectId }));
  }

  /**
   * Everything the manifest asks for that is not analytics, in one transaction.
   *
   * `retain` and `untouched` models appear nowhere below. That is the assertion:
   * they are not touched because no code touches them, not because a no-op
   * branch decided not to.
   */
  private async applyManifest(
    tx: TransactionClient,
    identifiers: ResolvedPersonalIdentifiers,
    newUserId: string,
    erasedAt: Date,
  ) {
    const oldUserId = identifiers.userId;
    const detached: Record<string, number> = {};
    const deleted: Record<string, number> = {};
    const anonymized: Record<string, number> = {};
    const danglingRewritten: Record<string, number> = {};

    // --- detach: the artist survives, unowned -----------------------------
    // `Artist.userId` is nullable by design. Nulling it detaches the whole
    // artist-scoped subtree at once, which is why no other `detach` model needs
    // a write of its own: they are keyed by `artistId`, and the artist keeps its
    // id. `Release` is the exception, because a withdrawn release is a status
    // change rather than a re-pointing.
    const artistRule = ruleFor("Artist");
    const artistDetached = await delegateFor(tx, "Artist").updateMany({
      where: { userId: oldUserId },
      data: { userId: null, ...scrubPayloadFor(artistRule) },
    });
    detached.Artist = artistDetached.count;

    const releasesWithdrawn = await this.withdrawArtistReleases(tx, identifiers.artistIds, erasedAt);
    detached.Release = releasesWithdrawn;

    // --- delete ------------------------------------------------------------
    // Includes the three address-to-person mappings — `Wallet`,
    // `PasskeyIdentity` and `SignupFaucetAttempt`. Deleting them is what severs
    // the wallet address in the retained financial rows from any account: the
    // address stays on the payment, and nothing in this database resolves it
    // back to a person.
    for (const rule of rulesWith("delete")) {
      const keys = personKeysForModel(rule.model);
      if (keys === "cascade") continue;
      const where = whereForKeys(keys, identifiers);
      if (!where) continue;
      const result = await delegateFor(tx, rule.model).deleteMany({ where });
      deleted[rule.model] = result.count;
    }

    // --- anonymize ---------------------------------------------------------
    // Matched on the rule's own `matchOn` column, never on whichever person
    // column happens to exist: scrubbing `ShowCampaignDispute.reason` on a row
    // matched by `resolvedByUserId` would erase the initiator's words rather
    // than this person's.
    for (const rule of rulesWith("anonymize")) {
      // The account row is rotated and re-emailed below, not scrubbed here.
      if (rule.model === "User") continue;
      if (!rule.matchOn) {
        throw new Error(`Anonymize rule for ${rule.model} has no matchOn column`);
      }
      const where = whereForKeys([personKeyForColumn(rule.model, rule.matchOn)], identifiers);
      if (!where) continue;
      const data = scrubPayloadFor(rule);
      if (rule.model === "Playlist") {
        // A kept playlist must not stay publicly browsable under an erased
        // account, as the manifest's note requires.
        data.visibility = "private";
      }
      if (Object.keys(data).length === 0) continue;
      const result = await delegateFor(tx, rule.model).updateMany({ where, data });
      anonymized[rule.model] = result.count;
    }

    // --- rotate the id, then chase what the cascade cannot reach ------------
    // For a wallet or passkey account `User.id` *is* the person's wallet
    // address, so it is itself personal data. Every foreign key is
    // `ON UPDATE CASCADE` (103 of 103), so this one write reaches every
    // relation-linked table.
    await delegateFor(tx, "User").update({
      where: { id: oldUserId },
      data: {
        id: newUserId,
        // `email` is @unique, so the placeholder is derived from the new id: a
        // constant would let exactly one account in the database ever be erased.
        email: erasedEmailFor(newUserId),
        closedAt: erasedAt,
        erasedAt,
      },
    });

    // The columns that hold a user id without a declared relation. These are
    // the rows the cascade does not reach, and a column missing from the
    // manifest's list keeps the wallet address forever without failing.
    for (const dangling of DANGLING_PERSON_COLUMNS) {
      if (dangling.action !== "rewrite") continue;
      const result = await delegateFor(tx, dangling.model).updateMany({
        where: { [dangling.column]: oldUserId },
        data: { [dangling.column]: newUserId },
      });
      const key = `${dangling.model}.${dangling.column}`;
      danglingRewritten[key] = result.count;
    }

    return { detached, deleted, anonymized, danglingRewritten, releasesWithdrawn };
  }

  /**
   * Withdraw the detached artist's releases through the #1793 mechanism rather
   * than deleting a catalogue other people bought from.
   *
   * The fields are written here rather than through
   * `CatalogService.withdrawRelease` for two reasons that are both structural:
   * that method authorizes ownership from `Artist.userId`, which this erasure
   * has just set to null, and it writes through the global client, so it cannot
   * join this transaction. The semantics are copied exactly — only a
   * withdrawable status is touched, and each release records the status it held
   * so a restore puts it back where it was.
   */
  private async withdrawArtistReleases(
    tx: TransactionClient,
    artistIds: string[],
    withdrawnAt: Date,
  ): Promise<number> {
    if (artistIds.length === 0) return 0;

    const releases = await delegateFor(tx, "Release").findMany({
      where: {
        artistId: { in: artistIds },
        status: { in: [...WITHDRAWABLE_RELEASE_STATUSES] },
      },
      select: { id: true, status: true },
      take: RELEASE_PAGE_SIZE,
    });

    let withdrawn = 0;
    // Row by row, because `statusBeforeWithdrawal` is per-release: restoring a
    // published release to "ready" would silently unpublish it.
    for (const release of releases) {
      await delegateFor(tx, "Release").update({
        where: { id: release.id as string },
        data: {
          status: RELEASE_STATUS_WITHDRAWN,
          statusBeforeWithdrawal: release.status as string,
          withdrawnAt,
          withdrawalReason: ERASURE_WITHDRAWAL_REASON,
        },
      });
      withdrawn += 1;
    }

    if (releases.length === RELEASE_PAGE_SIZE) {
      // More than one page of withdrawable releases: recurse, because the next
      // page is now a different set (the ones just withdrawn no longer match).
      return withdrawn + (await this.withdrawArtistReleases(tx, artistIds, withdrawnAt));
    }
    return withdrawn;
  }
}

function ruleFor(model: string): ErasureRule {
  const rule = ERASURE_RULES.find((candidate) => candidate.model === model);
  if (!rule) throw new Error(`No erasure rule for ${model}`);
  return rule;
}

/** Case-insensitive only for hex-shaped values; see `HEX_VALUE`. */
function caseTolerant(value: string) {
  return HEX_VALUE.test(value) ? { equals: value, mode: "insensitive" as const } : { equals: value };
}

function unique(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === "string" && value.length > 0))];
}

/**
 * Counts, not values — the same rule and the same reason as
 * `describeResolvedIdentifiers`, minus the user id, which at this point in an
 * erasure is the thing being removed.
 */
function describeErasedIdentifiers(resolved: ResolvedPersonalIdentifiers) {
  return {
    hasActorId: Boolean(resolved.actorId),
    walletAddressCount: resolved.walletAddresses.length,
    ownerAddressCount: resolved.ownerAddresses.length,
    artistIdCount: resolved.artistIds.length,
    sessionIdCount: resolved.sessionIds.length,
  };
}

function alreadyErasedSummary(userId: string, erasedAt: Date): AccountErasureSummary {
  return {
    status: "already_erased",
    newUserId: userId,
    erasedAt: erasedAt.toISOString(),
    identifiers: {
      hasActorId: false,
      walletAddressCount: 0,
      ownerAddressCount: 0,
      artistIdCount: 0,
      sessionIdCount: 0,
    },
    analytics: { governanceCalls: 0, matched: 0, deleted: 0, redacted: 0, warehouseStatuses: [] },
    detached: {},
    deleted: {},
    anonymized: {},
    danglingRewritten: {},
    releasesWithdrawn: 0,
  };
}
