/**
 * The parts of the erasure engine that must be provably correct *before* a
 * transaction opens (#1771 slice 3).
 *
 * Erasure is irreversible, so every decision that can be made without touching
 * the database is made here and fails here: which column a model's rows are
 * found by, and what value each scrubbed column is overwritten with. A scrub
 * payload that Prisma rejects at run time would throw at the last step of an
 * operation that has already deleted rows.
 */
import { Prisma } from "@prisma/client";
import {
  personKeyForColumn,
  personKeysForModel,
  scrubPayloadFor,
  scrubValueFor,
  whereForKeys,
} from "../modules/privacy/personal_data_erasure.service";
import {
  ERASURE_RULES,
  ErasureRule,
} from "../modules/privacy/personal_data_erasure_manifest";
import { ResolvedPersonalIdentifiers } from "../modules/identity/personal_data_resolver.service";

const rulesWith = (disposition: ErasureRule["disposition"]) =>
  ERASURE_RULES.filter((rule) => rule.disposition === disposition);

const IDENTIFIERS: ResolvedPersonalIdentifiers = {
  userId: "0xabc0000000000000000000000000000000000001",
  actorId: "pseudonymous-actor",
  walletAddresses: ["0xabc0000000000000000000000000000000000001"],
  ownerAddresses: [],
  artistIds: ["artist-1"],
  sessionIds: ["session-1"],
};

function field(model: string, column: string) {
  const definition = Prisma.dmmf.datamodel.models.find((candidate) => candidate.name === model);
  return definition?.fields.find((candidate) => candidate.name === column);
}

describe("erasure engine, before any row is touched", () => {
  it("can find the rows of every model it deletes", () => {
    for (const rule of rulesWith("delete")) {
      // Throws rather than returning nothing: a delete rule whose rows cannot
      // be found is an erasure that silently keeps them.
      const keys = personKeysForModel(rule.model);
      if (keys === "cascade") continue;
      expect(keys.length).toBeGreaterThan(0);
      for (const key of keys) {
        expect(field(rule.model, key.column)).toBeDefined();
      }
    }
  });

  it("matches wallet-keyed models on the address, not on a user id they do not have", () => {
    expect(personKeysForModel("Notification")).toEqual([
      { kind: "address", column: "walletAddress" },
    ]);
    expect(personKeysForModel("NotificationPreference")).toEqual([
      { kind: "address", column: "walletAddress" },
    ]);
    // The address-to-account mapping is matched both ways, because severing it
    // is the point of deleting the row.
    expect(personKeysForModel("SignupFaucetAttempt")).toEqual([
      { kind: "userId", column: "userId" },
      { kind: "address", column: "walletAddress" },
    ]);
  });

  it("builds a scrub payload for every anonymize rule, of a type the column accepts", () => {
    for (const rule of rulesWith("anonymize")) {
      expect(rule.matchOn).toBeDefined();
      const payload = scrubPayloadFor(rule);
      expect(Object.keys(payload).sort()).toEqual([...(rule.scrub ?? [])].sort());

      for (const [column, value] of Object.entries(payload)) {
        const definition = field(rule.model, column);
        expect(definition).toBeDefined();
        if (!definition) continue;
        if (!definition.isRequired) {
          // A nullable Json column is SQL NULL, which Prisma spells `DbNull`;
          // a bare `null` there is a runtime error, mid-erasure.
          expect(value).toBe(definition.type === "Json" ? Prisma.DbNull : null);
        } else {
          expect(value).not.toBeNull();
        }
      }
    }
  });

  it("empties a required column rather than leaving the person's words in it", () => {
    // Required, no default: the only safe value is the type's empty one.
    expect(scrubValueFor("CommunityMessage", "body")).toBe("");
    expect(scrubValueFor("CommunityProfile", "displayName")).toBe("");
    // Required with a default: back to what a fresh row holds.
    expect(scrubValueFor("CuratorReputation", "verifiedHuman")).toBe(false);
    expect(scrubValueFor("CuratorReputation", "humanVerificationStatus")).toBe("unverified");
    // Optional: null.
    expect(scrubValueFor("Artist", "payoutAddress")).toBeNull();
    expect(scrubValueFor("LibraryTrack", "sourcePath")).toBeNull();
    // Optional Json.
    expect(scrubValueFor("AgentConfig", "learnedTasteProfile")).toBe(Prisma.DbNull);
  });

  it("refuses to scrub a column the datamodel does not have", () => {
    expect(() => scrubValueFor("CommunityMessage", "notAColumn")).toThrow(/datamodel/);
    expect(() => scrubValueFor("NotAModel", "body")).toThrow(/datamodel/);
  });

  it("reads the kind of identifier a column holds from the schema, not from its name alone", () => {
    expect(personKeyForColumn("CommunityMessage", "authorId")).toEqual({
      kind: "userId",
      column: "authorId",
    });
    expect(personKeyForColumn("CuratorReputation", "walletAddress")).toEqual({
      kind: "address",
      column: "walletAddress",
    });
    // Dangling: no relation behind it, and not an address.
    expect(personKeyForColumn("KeyAuditLog", "userId")).toEqual({
      kind: "userId",
      column: "userId",
    });
  });

  it("never produces a where clause that matches every row", () => {
    // A person with no wallet cannot match a wallet-keyed table. An empty
    // disjunction would become `where: {}` — a deleteMany over the whole table.
    const noWallet: ResolvedPersonalIdentifiers = {
      ...IDENTIFIERS,
      walletAddresses: [],
      ownerAddresses: [],
    };
    expect(whereForKeys([{ kind: "address", column: "walletAddress" }], noWallet)).toBeUndefined();
    expect(whereForKeys([{ kind: "artistId", column: "artistId" }], {
      ...IDENTIFIERS,
      artistIds: [],
    })).toBeUndefined();
    expect(whereForKeys([], IDENTIFIERS)).toBeUndefined();
  });

  it("matches a hex address case-insensitively and anything else exactly", () => {
    // Postgres implements `mode: "insensitive"` with ILIKE, where `%` and `_`
    // are wildcards — and a widened match in an erasure deletes somebody
    // else's rows. Only hex-shaped values take that path.
    expect(whereForKeys([{ kind: "address", column: "walletAddress" }], IDENTIFIERS)).toEqual({
      OR: [
        {
          walletAddress: {
            equals: "0xabc0000000000000000000000000000000000001",
            mode: "insensitive",
          },
        },
      ],
    });
    expect(
      whereForKeys([{ kind: "address", column: "walletAddress" }], {
        ...IDENTIFIERS,
        walletAddresses: ["not_a%hex_address"],
      }),
    ).toEqual({ OR: [{ walletAddress: { equals: "not_a%hex_address" } }] });
  });

  it("leaves retained and untouched models with no code path at all", () => {
    // The assertion is the absence: every model the engine acts on comes from
    // one of these four lists, so a `retain` or `untouched` model cannot be
    // reached even by accident.
    const acted = new Set(
      ERASURE_RULES.filter((rule) =>
        ["delete", "anonymize", "detach"].includes(rule.disposition)).map((rule) => rule.model),
    );
    for (const rule of rulesWith("retain")) expect(acted.has(rule.model)).toBe(false);
    for (const rule of rulesWith("untouched")) expect(acted.has(rule.model)).toBe(false);
    for (const rule of rulesWith("governance")) expect(acted.has(rule.model)).toBe(false);
  });
});
