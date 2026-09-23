/**
 * The erasure manifest test (#1771 slice 3).
 *
 * Driven from the generated Prisma DMMF, like its export counterpart, so the
 * schema is the source of truth and the manifest has to keep up with it.
 * Adding a model to `schema.prisma` fails this suite until someone decides what
 * erasure does to it, and — the test that matters most here — adding a column
 * that could hold a `User.id` without a declared relation fails it until
 * someone says whether `ON UPDATE CASCADE` will reach it.
 *
 * That last one exists because the failure mode it guards is silent. A dangling
 * column nobody listed keeps the person's wallet address forever, the erasure
 * reports success, and nothing anywhere throws.
 *
 * Pure unit test: no database, no Prisma client connection — only the datamodel
 * the client was generated from.
 */
import { Prisma } from "@prisma/client";
import {
  DANGLING_PERSON_COLUMNS,
  ERASURE_RULES,
  ERASURE_RULES_BY_MODEL,
  ErasureDisposition,
  PERSON_ID_COLUMN_PATTERNS,
  RETAINED_BUT_NOT_EXPORTED,
  REVIEWED_NON_PERSON_ID_COLUMNS,
  erasedEmailFor,
  ERASED_EMAIL_DOMAIN,
} from "../modules/privacy/personal_data_erasure_manifest";
import {
  EXPORTED_MODELS,
  NOT_EXPORTED_MODELS,
} from "../modules/privacy/personal_data_export_manifest";

const DATAMODEL = Prisma.dmmf.datamodel.models;
const MODEL_NAMES = DATAMODEL.map((model) => model.name);

type Field = (typeof DATAMODEL)[number]["fields"][number];

function modelDefinition(model: string) {
  const definition = DATAMODEL.find((candidate) => candidate.name === model);
  if (!definition) throw new Error(`Unknown model in erasure manifest: ${model}`);
  return definition;
}

function scalarFields(model: string): Field[] {
  return modelDefinition(model).fields.filter(
    (field) => field.kind === "scalar" || field.kind === "enum",
  );
}

function columnNames(model: string): string[] {
  return scalarFields(model).map((field) => field.name);
}

function fieldOf(model: string, column: string): Field | undefined {
  return scalarFields(model).find((field) => field.name === column);
}

/**
 * Columns backing a declared `User` relation — the ones `ON UPDATE CASCADE`
 * rewrites for free when `User.id` is rotated.
 */
function cascadingUserColumns(model: string): Set<string> {
  return new Set(
    modelDefinition(model)
      .fields.filter((field) => field.kind === "object" && field.type === "User")
      .flatMap((field) => field.relationFromFields ?? []),
  );
}

/**
 * Re-derived, not copied from the manifest: every String column whose name
 * could hold a `User.id` and which no `User` relation covers.
 */
function nonCascadingPersonIdCandidates(model: string): string[] {
  const cascading = cascadingUserColumns(model);
  return scalarFields(model)
    .filter((field) => field.kind === "scalar" && field.type === "String")
    .filter((field) => PERSON_ID_COLUMN_PATTERNS.some((pattern) => pattern.test(field.name)))
    .filter((field) => !cascading.has(field.name))
    .map((field) => field.name);
}

const DISPOSITIONS: ErasureDisposition[] = [
  "delete",
  "anonymize",
  "retain",
  "governance",
  "detach",
  "untouched",
];

function modelsWith(disposition: ErasureDisposition): string[] {
  return ERASURE_RULES.filter((rule) => rule.disposition === disposition).map((rule) => rule.model);
}

describe("personal data erasure manifest", () => {
  describe("total coverage", () => {
    it("gives every model in the Prisma datamodel exactly one disposition", () => {
      const classified = ERASURE_RULES.map((rule) => rule.model);

      // A new model has an undecided fate until someone writes it down. If this
      // fails, add an ERASURE_RULES entry saying what erasure does to it.
      const unclassified = MODEL_NAMES.filter((name) => !classified.includes(name));
      expect(unclassified).toEqual([]);

      expect(classified.length).toBe(new Set(classified).size);
      expect(classified.length).toBe(MODEL_NAMES.length);
    });

    it("names only models that exist in the datamodel", () => {
      for (const rule of ERASURE_RULES) {
        expect(MODEL_NAMES).toContain(rule.model);
      }
    });

    it("uses only the declared dispositions", () => {
      for (const rule of ERASURE_RULES) {
        expect(DISPOSITIONS).toContain(rule.disposition);
      }
    });

    it("gives every model a reason a reviewer can check", () => {
      for (const rule of ERASURE_RULES) {
        expect(typeof rule.reason).toBe("string");
        // One sentence, not a shrug.
        expect(rule.reason.trim().length).toBeGreaterThan(30);
      }
    });

    it("indexes every rule by model", () => {
      expect(Object.keys(ERASURE_RULES_BY_MODEL).sort()).toEqual(
        ERASURE_RULES.map((rule) => rule.model).sort(),
      );
      for (const rule of ERASURE_RULES) {
        expect(ERASURE_RULES_BY_MODEL[rule.model]).toBe(rule);
      }
    });
  });

  describe("no model is in two categories at once", () => {
    it("keeps the disposition sets disjoint", () => {
      const seen = new Map<string, ErasureDisposition>();
      for (const rule of ERASURE_RULES) {
        expect(seen.has(rule.model)).toBe(false);
        seen.set(rule.model, rule.disposition);
      }
    });

    it("never both deletes and scrubs a model", () => {
      for (const rule of ERASURE_RULES) {
        if (rule.disposition === "delete") {
          // Naming columns to scrub on a row that is about to be removed reads
          // like a second, contradictory instruction to the engine.
          expect(rule.scrub ?? []).toEqual([]);
        }
      }
    });

    it("never scrubs a model it also declares untouched or governed", () => {
      for (const rule of ERASURE_RULES) {
        if (rule.disposition === "untouched" || rule.disposition === "governance") {
          expect(rule.scrub ?? []).toEqual([]);
        }
      }
    });
  });

  describe("scrub columns are real and scrubbable", () => {
    it("names only columns that exist on their model", () => {
      const missing: string[] = [];
      for (const rule of ERASURE_RULES) {
        for (const column of rule.scrub ?? []) {
          if (!columnNames(rule.model).includes(column)) missing.push(`${rule.model}.${column}`);
        }
      }
      // A stale entry makes the manifest look more thorough than it is: the
      // engine would skip a column that quietly got renamed.
      expect(missing).toEqual([]);
    });

    it("only names columns with a safe value to write", () => {
      const unscrubbable: string[] = [];
      for (const rule of ERASURE_RULES) {
        for (const column of rule.scrub ?? []) {
          const field = fieldOf(rule.model, column);
          if (!field) continue;
          // A column can be scrubbed when some non-identifying value exists to
          // put in it: null if it is optional, its default if it has one, or an
          // empty/placeholder value for free text and JSON.
          const scrubbable =
            !field.isRequired
            || field.hasDefaultValue
            || ["String", "Json", "Bytes"].includes(field.type);
          if (!scrubbable) unscrubbable.push(`${rule.model}.${column}:${field.type}`);
        }
      }
      expect(unscrubbable).toEqual([]);
    });

    it("never scrubs a primary key or a foreign key", () => {
      const structural: string[] = [];
      for (const rule of ERASURE_RULES) {
        const relationColumns = new Set(
          modelDefinition(rule.model)
            .fields.filter((field) => field.kind === "object")
            .flatMap((field) => field.relationFromFields ?? []),
        );
        for (const column of rule.scrub ?? []) {
          const field = fieldOf(rule.model, column);
          if (field?.isId || relationColumns.has(column)) {
            structural.push(`${rule.model}.${column}`);
          }
        }
      }
      // Scrubbing a key does not anonymize a row, it breaks it.
      expect(structural).toEqual([]);
    });

    it("declares the column a scrub is matched on, and it exists", () => {
      for (const rule of ERASURE_RULES) {
        if (!(rule.scrub ?? []).length) continue;
        // Several models carry two person columns. Without matchOn, an engine
        // could scrub an operator's note on a dispute this person merely
        // resolved, as if the words were theirs.
        expect(typeof rule.matchOn).toBe("string");
        expect(columnNames(rule.model)).toContain(rule.matchOn as string);
      }
    });

    it("derives the erased email from the new user id, because User.email is unique", () => {
      const userRule = ERASURE_RULES_BY_MODEL.User;
      expect(userRule.disposition).toBe("anonymize");
      expect(userRule.scrub).toContain("email");
      expect(fieldOf("User", "email")?.isUnique).toBe(true);

      // A constant placeholder would let exactly one account in the database
      // ever be erased; every later erasure would fail on the unique index at
      // the last step of an irreversible operation.
      const first = erasedEmailFor("11111111-1111-1111-1111-111111111111");
      const second = erasedEmailFor("22222222-2222-2222-2222-222222222222");
      expect(first).not.toEqual(second);
      expect(first.endsWith(`@${ERASED_EMAIL_DOMAIN}`)).toBe(true);
      // Must not collide with the live wallet-account placeholder in auth.service.ts.
      expect(ERASED_EMAIL_DOMAIN).not.toBe("wallet.resonate");
    });
  });

  describe("every non-cascading person column is listed", () => {
    it("lists or explicitly clears every column ON UPDATE CASCADE will not reach", () => {
      const listed = new Set(
        DANGLING_PERSON_COLUMNS.map((entry) => `${entry.model}.${entry.column}`),
      );
      const undecided: string[] = [];

      for (const model of MODEL_NAMES) {
        for (const column of nonCascadingPersonIdCandidates(model)) {
          const key = `${model}.${column}`;
          if (listed.has(key)) continue;
          if (REVIEWED_NON_PERSON_ID_COLUMNS[model]?.[column]) continue;
          undecided.push(key);
        }
      }

      // THE test of this file. Every entry here is a column that could hold a
      // `User.id` and that the id rotation will not touch — which, for a wallet
      // or passkey account, means the person's wallet address stays in the
      // database after an erasure reports success. Either add it to
      // DANGLING_PERSON_COLUMNS with what the engine must do, or record in
      // REVIEWED_NON_PERSON_ID_COLUMNS why it does not hold a user id.
      expect(undecided).toEqual([]);
    });

    it("names only real model/column pairs", () => {
      for (const entry of DANGLING_PERSON_COLUMNS) {
        expect(MODEL_NAMES).toContain(entry.model);
        expect(columnNames(entry.model)).toContain(entry.column);
      }
      for (const [model, columns] of Object.entries(REVIEWED_NON_PERSON_ID_COLUMNS)) {
        expect(MODEL_NAMES).toContain(model);
        for (const column of Object.keys(columns)) {
          expect(columnNames(model)).toContain(column);
        }
      }
    });

    it("never lists a column that a User relation already cascades", () => {
      const redundant: string[] = [];
      for (const entry of DANGLING_PERSON_COLUMNS) {
        if (cascadingUserColumns(entry.model).has(entry.column)) {
          redundant.push(`${entry.model}.${entry.column}`);
        }
      }
      // A hand-written rewrite of a column the database already rewrote is at
      // best noise and at worst a second, conflicting update.
      expect(redundant).toEqual([]);
    });

    it("lists each dangling column once, with a written reason", () => {
      const keys = DANGLING_PERSON_COLUMNS.map((entry) => `${entry.model}.${entry.column}`);
      expect(keys.length).toBe(new Set(keys).size);
      for (const entry of DANGLING_PERSON_COLUMNS) {
        expect(entry.reason.trim().length).toBeGreaterThan(30);
        expect(["rewrite", "scrubbed", "deleted-with-row", "governance"]).toContain(entry.action);
      }
    });

    it("agrees with the disposition about which rows survive", () => {
      for (const entry of DANGLING_PERSON_COLUMNS) {
        const rule = ERASURE_RULES_BY_MODEL[entry.model];
        expect(rule).toBeDefined();
        if (entry.action === "deleted-with-row") {
          expect(rule.disposition).toBe("delete");
        }
        if (entry.action === "rewrite") {
          // A rewrite only makes sense on a row that is still there.
          expect(rule.disposition).not.toBe("delete");
        }
        if (entry.action === "scrubbed") {
          // The row survives, but this personal identifier is cleared directly.
          expect(rule.disposition).not.toBe("delete");
        }
        if (entry.action === "governance") {
          expect(rule.disposition).toBe("governance");
        }
      }
    });

    it("scrubs a credit review's dangling reviewer identity and note", () => {
      expect(DANGLING_PERSON_COLUMNS).toContainEqual(expect.objectContaining({
        model: "ReleaseArtistCredit",
        column: "identityReviewerUserId",
        action: "scrubbed",
      }));
    });

    it("keeps the reviewed-clear list to columns the patterns actually flag", () => {
      const unnecessary: string[] = [];
      for (const [model, columns] of Object.entries(REVIEWED_NON_PERSON_ID_COLUMNS)) {
        for (const [column, reason] of Object.entries(columns)) {
          expect(reason.trim().length).toBeGreaterThan(30);
          if (!nonCascadingPersonIdCandidates(model).includes(column)) {
            unnecessary.push(`${model}.${column}`);
          }
        }
      }
      // An entry no pattern flags is dead weight that makes the review look
      // more thorough than it was.
      expect(unnecessary).toEqual([]);
    });

    it("still catches the columns the inventory missed", () => {
      const listed = DANGLING_PERSON_COLUMNS.map((entry) => `${entry.model}.${entry.column}`);
      // `resolvedByUserId` sits on a model that *does* have a User relation, so
      // a per-model check would have cleared ShowCampaignDispute and moved on.
      expect(listed).toContain("ShowCampaignDispute.resolvedByUserId");
      // The inventory's own category 2a, in full.
      expect(listed).toContain("SignupFaucetAttempt.userId");
      expect(listed).toContain("AgentTransaction.userId");
      expect(listed).toContain("WebAuthnCredential.userId");
      expect(listed).toContain("KeyAuditLog.userId");
      expect(listed).toContain("ShowEscrowReconciliationAcknowledgement.acknowledgedByUserId");
      expect(listed).toContain("ShowEscrowReconciliationAcknowledgement.revokedByUserId");
    });
  });

  describe("agreement with the export manifest", () => {
    const exported = new Set(EXPORTED_MODELS.map((entry) => entry.model));

    it("keeps everything it retains visible to the person, or says why not", () => {
      const invisible: string[] = [];
      for (const model of modelsWith("retain")) {
        if (exported.has(model)) continue;
        if (RETAINED_BUT_NOT_EXPORTED[model]) continue;
        invisible.push(model);
      }
      // If we keep it, the person should be able to see it. The two exceptions
      // are rows a person cannot be queried out of at all, and each carries a
      // written reason.
      expect(invisible).toEqual([]);
    });

    it("keeps the detached artist records visible too", () => {
      for (const model of modelsWith("detach")) {
        expect(exported.has(model)).toBe(true);
      }
    });

    it("records a reason for each retained-but-unexportable model", () => {
      for (const [model, reason] of Object.entries(RETAINED_BUT_NOT_EXPORTED)) {
        expect(MODEL_NAMES).toContain(model);
        expect(modelsWith("retain")).toContain(model);
        expect(exported.has(model)).toBe(false);
        expect(reason.trim().length).toBeGreaterThan(30);
      }
    });

    it("treats a model the export says names nobody as untouched, deleted or governed", () => {
      // The export leaves a model out when no column of its own names the
      // person. Such a model cannot be anonymized or detached — there is
      // nothing in it to scrub and nobody to detach it from.
      const offenders: string[] = [];
      for (const model of Object.keys(NOT_EXPORTED_MODELS)) {
        const disposition = ERASURE_RULES_BY_MODEL[model]?.disposition;
        if (disposition === "anonymize" || disposition === "detach") offenders.push(model);
      }
      expect(offenders).toEqual([]);
    });

    it("never reuses the export list as a deletion list", () => {
      // The whole point of this file existing separately. On-chain mirrors are
      // exported deliberately and retained deliberately.
      for (const model of ["StemPurchase", "RoyaltyPayment", "X402Settlement", "ShowPledge"]) {
        expect(exported.has(model)).toBe(true);
        expect(ERASURE_RULES_BY_MODEL[model].disposition).toBe("retain");
      }
    });
  });

  describe("the decisions that must not drift", () => {
    it("keeps the account row rather than deleting it", () => {
      expect(ERASURE_RULES_BY_MODEL.User.disposition).toBe("anonymize");
    });

    it("retains management audit rows while revoking active authority", () => {
      for (const model of ["ManagementGrant", "ManagementTransfer"]) {
        expect(ERASURE_RULES_BY_MODEL[model].disposition).toBe("retain");
      }
      expect(ERASURE_RULES_BY_MODEL.ManagementGrant.reason).toContain("grantee or inviter");
      expect(ERASURE_RULES_BY_MODEL.ManagementTransfer.reason).toContain("proposer or recipient");
    });

    it("deletes every credential and address-to-account mapping", () => {
      for (const model of [
        "Wallet",
        "PasskeyIdentity",
        "WebAuthnCredential",
        "SessionKey",
        "SignupFaucetAttempt",
      ]) {
        expect(ERASURE_RULES_BY_MODEL[model].disposition).toBe("delete");
      }
    });

    it("detaches the artist instead of deleting the catalogue", () => {
      expect(ERASURE_RULES_BY_MODEL.Artist.disposition).toBe("detach");
      expect(ERASURE_RULES_BY_MODEL.Release.disposition).toBe("detach");
      // Nullable by design — this is what makes detaching possible at all.
      expect(fieldOf("Artist", "userId")?.isRequired).toBe(false);
      expect(ERASURE_RULES_BY_MODEL.Artist.note).toContain("managementOwnerUserId");
      expect(ERASURE_RULES_BY_MODEL.Release.note).toContain("managementOwnerUserId");
    });

    it("leaves analytics to the governance service", () => {
      expect(ERASURE_RULES_BY_MODEL.AnalyticsEvent.disposition).toBe("governance");
      expect(ERASURE_RULES_BY_MODEL.AnalyticsGovernanceLog.disposition).toBe("governance");
    });

    it("decides third-party text in both directions, and differently", () => {
      // Written BY this person ABOUT somebody else: the safety record stays.
      const report = ERASURE_RULES_BY_MODEL.CommunityModerationReport;
      expect(report.disposition).toBe("retain");
      expect(report.scrub ?? []).toEqual([]);

      // Written by somebody else ABOUT this person: not theirs to withdraw, so
      // the dispute's operator note is not in the scrub list even though the
      // initiator's own words are.
      const dispute = ERASURE_RULES_BY_MODEL.ShowCampaignDispute;
      expect(dispute.scrub).toContain("reason");
      expect(dispute.scrub).not.toContain("operatorNote");
      expect(dispute.matchOn).toBe("initiatorUserId");

      // A report somebody else filed carries the reporter's data, not this
      // person's, and is left alone entirely.
      expect(ERASURE_RULES_BY_MODEL.DmcaReport.disposition).toBe("untouched");

      // Feedback is matched on the submitter, so feedback about this person's
      // agent — another person's statement — is never scrubbed.
      expect(ERASURE_RULES_BY_MODEL.AgentReputationFeedback.matchOn).toBe("submitterUserId");
    });

    it("does not delete rows other people's rows cascade from", () => {
      // Each of these would take somebody else's data with it: SavedPlaylist
      // cascades from Playlist, and AgentReputationFeedback from AgentConfig.
      expect(ERASURE_RULES_BY_MODEL.Playlist.disposition).toBe("anonymize");
      expect(ERASURE_RULES_BY_MODEL.AgentConfig.disposition).toBe("anonymize");
      expect(ERASURE_RULES_BY_MODEL.CommunityMessage.disposition).toBe("anonymize");
    });
  });
});
