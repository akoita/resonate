/**
 * The manifest test (#1771 slice 2).
 *
 * Everything here is driven from the generated Prisma DMMF, so the schema is
 * the source of truth and the manifest has to keep up with it — not the other
 * way round. Adding a model to `schema.prisma` fails this suite until someone
 * decides whether a person's export should contain it, and adding a column
 * whose name looks like key material fails it until someone decides whether it
 * may leave the server.
 *
 * Pure unit test: no database, no Prisma client connection — only the
 * datamodel the client was generated from.
 */
import { Prisma } from "@prisma/client";
import {
  EXPORTED_MODELS,
  NOT_EXPORTED_MODELS,
  REDACTED_FIELDS,
  REVIEWED_SAFE_FIELDS,
  SENSITIVE_FIELD_NAME_PATTERNS,
} from "../modules/privacy/personal_data_export_manifest";

const DATAMODEL = Prisma.dmmf.datamodel.models;
const MODEL_NAMES = DATAMODEL.map((model) => model.name);

function fieldsOf(model: string) {
  const definition = DATAMODEL.find((candidate) => candidate.name === model);
  if (!definition) throw new Error(`Unknown model in manifest: ${model}`);
  return definition.fields;
}

function columnNames(model: string): string[] {
  return fieldsOf(model)
    .filter((field) => field.kind === "scalar" || field.kind === "enum")
    .map((field) => field.name);
}

function looksSensitive(fieldName: string): boolean {
  return SENSITIVE_FIELD_NAME_PATTERNS.some((pattern) => pattern.test(fieldName));
}

describe("personal data export manifest", () => {
  describe("total coverage", () => {
    it("classifies every model in the Prisma datamodel exactly once", () => {
      const exported = EXPORTED_MODELS.map((entry) => entry.model);
      const notExported = Object.keys(NOT_EXPORTED_MODELS);

      const unclassified = MODEL_NAMES.filter(
        (name) => !exported.includes(name) && !notExported.includes(name),
      );
      // A new model is personal data until someone says otherwise. If this
      // fails, add it to EXPORTED_MODELS or give NOT_EXPORTED_MODELS a reason.
      expect(unclassified).toEqual([]);

      const classifiedTwice = exported.filter((name) => notExported.includes(name));
      expect(classifiedTwice).toEqual([]);
    });

    it("exports management grants and transfers for either user party", () => {
      const grant = EXPORTED_MODELS.find((entry) => entry.model === "ManagementGrant");
      expect(grant).toMatchObject({
        primaryKey: "id",
        keys: [
          { kind: "userId", column: "granteeUserId" },
          { kind: "userId", column: "inviterUserId" },
        ],
      });

      const transfer = EXPORTED_MODELS.find((entry) => entry.model === "ManagementTransfer");
      expect(transfer).toMatchObject({
        primaryKey: "id",
        keys: [
          { kind: "userId", column: "proposerUserId" },
          { kind: "userId", column: "recipientUserId" },
        ],
      });

      const recovery = EXPORTED_MODELS.find((entry) => entry.model === "ManagementTransferRecoveryRequest");
      expect(recovery).toMatchObject({
        primaryKey: "id",
        keys: [{ kind: "userId", column: "requesterUserId" }],
      });
      expect(REDACTED_FIELDS.ManagementTransferRecoveryRequest).toHaveProperty("reviewerUserId");
    });

    it("lists each exported model only once", () => {
      const exported = EXPORTED_MODELS.map((entry) => entry.model);
      expect(exported.length).toBe(new Set(exported).size);
    });

    it("gives every not-exported model a reason a reviewer can check", () => {
      for (const [model, reason] of Object.entries(NOT_EXPORTED_MODELS)) {
        expect(typeof reason).toBe("string");
        // One sentence, not a shrug.
        expect(reason.trim().length).toBeGreaterThan(30);
      }
    });

    it("accounts for the whole datamodel", () => {
      expect(EXPORTED_MODELS.length + Object.keys(NOT_EXPORTED_MODELS).length).toBe(
        MODEL_NAMES.length,
      );
    });
  });

  describe("no secret escapes", () => {
    it("classifies every sensitive-looking field on an exported model", () => {
      const undecided: string[] = [];

      for (const entry of EXPORTED_MODELS) {
        const redacted = REDACTED_FIELDS[entry.model] ?? {};
        const reviewedSafe = REVIEWED_SAFE_FIELDS[entry.model] ?? {};
        for (const column of columnNames(entry.model)) {
          if (!looksSensitive(column)) continue;
          if (column in redacted || column in reviewedSafe) continue;
          undecided.push(`${entry.model}.${column}`);
        }
      }

      // Either redact it, or record in REVIEWED_SAFE_FIELDS why it is not a
      // secret. On-chain vocabulary (`tokenId`, `paymentToken`) is legitimate
      // and belongs in the reviewed-safe list — explicitly, per field, rather
      // than exempted by loosening the pattern.
      expect(undecided).toEqual([]);
    });

    it("refuses to export the agent private key, whatever else changes", () => {
      // The single worst outcome this whole slice exists to prevent: a raw
      // ECDSA private key leaving the backend through a user-triggered
      // download. Named explicitly so a refactor of the generic rules above
      // cannot quietly drop it.
      expect(REDACTED_FIELDS.SessionKey?.agentPrivateKey).toBeTruthy();
      expect(EXPORTED_MODELS.some((entry) => entry.model === "SessionKey")).toBe(true);
    });

    it.each([
      ["SessionKey", "approvalData"],
      ["AgentConfig", "identityCredential"],
      ["WebAuthnCredential", "publicKey"],
      ["WebAuthnCredential", "counter"],
      ["PasskeyIdentity", "publicKeyHash"],
      ["Wallet", "salt"],
      ["CommunityDiscordBridge", "webhookUrl"],
    ])("redacts %s.%s", (model, field) => {
      expect(REDACTED_FIELDS[model]?.[field]).toBeTruthy();
    });

    it("gives every redacted and reviewed-safe field a written reason", () => {
      for (const entries of [REDACTED_FIELDS, REVIEWED_SAFE_FIELDS]) {
        for (const fields of Object.values(entries)) {
          for (const reason of Object.values(fields)) {
            expect(typeof reason).toBe("string");
            expect(reason.trim().length).toBeGreaterThan(20);
          }
        }
      }
    });

    it("never lists the same field as both redacted and reviewed-safe", () => {
      for (const [model, redacted] of Object.entries(REDACTED_FIELDS)) {
        const reviewedSafe = REVIEWED_SAFE_FIELDS[model] ?? {};
        for (const field of Object.keys(redacted)) {
          expect(field in reviewedSafe).toBe(false);
        }
      }
    });

    it("keeps REVIEWED_SAFE_FIELDS to fields the patterns actually flag", () => {
      // An entry that no pattern matches is dead weight that makes the review
      // list look more thorough than it is.
      const unnecessary: string[] = [];
      for (const [model, fields] of Object.entries(REVIEWED_SAFE_FIELDS)) {
        for (const field of Object.keys(fields)) {
          if (!looksSensitive(field)) unnecessary.push(`${model}.${field}`);
        }
      }
      expect(unnecessary).toEqual([]);
    });
  });

  describe("no stale entries", () => {
    it("names only models that exist in the datamodel", () => {
      for (const entry of EXPORTED_MODELS) {
        expect(MODEL_NAMES).toContain(entry.model);
      }
      for (const model of Object.keys(NOT_EXPORTED_MODELS)) {
        expect(MODEL_NAMES).toContain(model);
      }
      for (const model of [...Object.keys(REDACTED_FIELDS), ...Object.keys(REVIEWED_SAFE_FIELDS)]) {
        expect(MODEL_NAMES).toContain(model);
      }
    });

    it("names only fields that exist on their model", () => {
      for (const entries of [REDACTED_FIELDS, REVIEWED_SAFE_FIELDS]) {
        for (const [model, fields] of Object.entries(entries)) {
          const columns = columnNames(model);
          for (const field of Object.keys(fields)) {
            expect(columns).toContain(field);
          }
        }
      }
    });

    it("only redacts fields on models that are actually exported", () => {
      const exported = new Set(EXPORTED_MODELS.map((entry) => entry.model));
      for (const model of [...Object.keys(REDACTED_FIELDS), ...Object.keys(REVIEWED_SAFE_FIELDS)]) {
        // A redaction rule for a model nobody exports is a rule nobody runs.
        expect(exported.has(model)).toBe(true);
      }
    });

    it("declares key columns that exist on their model", () => {
      for (const entry of EXPORTED_MODELS) {
        const columns = columnNames(entry.model);
        expect(entry.keys.length).toBeGreaterThan(0);
        for (const key of entry.keys) {
          expect(columns).toContain(key.column);
        }
      }
    });

    it("never keys a model by a column it also redacts", () => {
      for (const entry of EXPORTED_MODELS) {
        const redacted = REDACTED_FIELDS[entry.model] ?? {};
        for (const key of entry.keys) {
          // Redacted columns are dropped from the `select`, but the `where`
          // still needs them; keying on one would be confusing rather than
          // broken, so flag it here instead of leaving it to a reader.
          expect(key.column in redacted).toBe(false);
        }
      }
    });

    it("declares a single-column string primary key that the datamodel agrees is the id", () => {
      for (const entry of EXPORTED_MODELS) {
        const field = fieldsOf(entry.model).find((candidate) => candidate.name === entry.primaryKey);
        expect(field).toBeDefined();
        // Cursor pagination needs a unique, orderable, string-typed key.
        expect(field?.isId || field?.isUnique).toBe(true);
        expect(field?.type).toBe("String");
      }
    });
  });
});
