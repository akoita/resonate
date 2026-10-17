/**
 * Case-variant user merge - Integration Test (Testcontainers), #2180
 *
 * Seeds groups of two users equal under lowercase (one lowercase "canonical",
 * one mixed-case "variant") that mirror what a checksummed wallet read path
 * left behind, and checks the merge script: references move, conflict policies,
 * whole-group rollback, dry-run parity, idempotence, and that logs never carry
 * an id.
 *
 * Run: npm run test:integration -- merge_case_variant_users
 */

import { mkdtempSync, readFileSync, rmSync, statSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { prisma } from "../db/prisma";
import {
  mergeCaseVariantUsers,
  parseMergeOptions,
  runMergeCaseVariantUsers,
  totalsOf,
  type GroupOutcome,
} from "../scripts/merge_case_variant_users";

const STAMP = Date.now();
const PREFIX = `cvm_${STAMP}_`;

interface Pair {
  key: string;
  canonical: string;
  variant: string;
}

function pair(name: string): Pair {
  const key = `${PREFIX}${name}`;
  return { key, canonical: key, variant: `Cvm_${STAMP}_${name.toUpperCase()}` };
}

const MOVE = pair("move"); // variant with a zero wallet + FK rows -> merged
const DROP = pair("drop"); // duplicates the policy may drop -> merged
const VALUE = pair("value"); // variant wallet holds a balance -> manual
const ADDRESS = pair("address"); // variant wallet at another address -> manual
const UNKNOWN = pair("unknown"); // unique conflict outside the policy -> rolled back
const NOLOWER = pair("nolower"); // two mixed-case ids -> manual
const NOLOWER_B = `CVM_${STAMP}_NOLOWER`;
const CROWDED = pair("crowded"); // three members -> manual
const CROWDED_C = `cVm_${STAMP}_CROWDED`;
const ERASED = pair("erased"); // canonical erased -> manual
const ALL_IDS = [
  MOVE,
  DROP,
  VALUE,
  ADDRESS,
  UNKNOWN,
  NOLOWER,
  CROWDED,
  ERASED,
]
  .flatMap((entry) => (entry === NOLOWER ? [entry.variant] : [entry.canonical, entry.variant]))
  .concat([NOLOWER_B, CROWDED_C]);

const ADDRESS_A = `0x${"a".repeat(40)}`;
const ADDRESS_A_CHECKSUMMED = `0x${"A".repeat(40)}`;
const ADDRESS_B = `0x${"b".repeat(40)}`;
const UNKNOWN_PLAYLIST = `${PREFIX}clash`;
const INDEX_NAME = `cvm_${STAMP}_unknown_idx`;

function mineOnly(outcomes: GroupOutcome[]): GroupOutcome[] {
  return outcomes.filter((outcome) => outcome.key.startsWith(PREFIX));
}

function byKey(outcomes: GroupOutcome[], key: string): GroupOutcome {
  const found = outcomes.find((outcome) => outcome.key === key);
  if (!found) throw new Error("group missing from outcomes");
  return found;
}

describe("merge_case_variant_users (integration, #2180)", () => {
  let dir: string;
  let info: jest.SpyInstance;
  let warn: jest.SpyInstance;
  let error: jest.SpyInstance;

  const logged = () =>
    [...info.mock.calls, ...warn.mock.calls, ...error.mock.calls].map((call) => String(call[0])).join("\n");

  async function snapshot() {
    return {
      users: (await prisma.user.findMany({ where: { id: { in: ALL_IDS } }, select: { id: true }, orderBy: { id: "asc" } })).map((u) => u.id),
      playlists: (await prisma.playlist.findMany({ where: { name: { startsWith: PREFIX } }, select: { name: true, userId: true }, orderBy: [{ name: "asc" }, { userId: "asc" }] })),
      wallets: (await prisma.wallet.findMany({ where: { userId: { in: ALL_IDS } }, select: { userId: true, balanceUsd: true }, orderBy: { userId: "asc" } })),
      audit: (await prisma.adminAuditEvent.findMany({ where: { actorUserId: PREFIX }, select: { targetUserId: true }, orderBy: { targetUserId: "asc" } })),
      profiles: (await prisma.communityProfile.findMany({ where: { userId: { in: ALL_IDS } }, select: { userId: true }, orderBy: { userId: "asc" } })),
      credits: (await prisma.generationCreditAccount.findMany({ where: { userId: { in: ALL_IDS } }, select: { userId: true, balanceCents: true }, orderBy: { userId: "asc" } })),
      reads: (await prisma.noticeRead.findMany({ where: { userId: { in: ALL_IDS } }, select: { userId: true }, orderBy: { userId: "asc" } })),
    };
  }

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "cvm-"));
    await prisma.user.createMany({
      data: ALL_IDS.map((id) => ({ id, email: `${id}@test.resonate` })),
    });
    // A canonical user that was erased.
    await prisma.user.update({ where: { id: ERASED.canonical }, data: { erasedAt: new Date() } });

    // MOVE: a variant with only a zero wallet and some FK rows.
    await prisma.wallet.create({ data: { userId: MOVE.variant, address: ADDRESS_A, chainId: 1 } });
    await prisma.playlist.createMany({
      data: [
        { userId: MOVE.variant, name: `${PREFIX}move_a`, trackIds: [] },
        { userId: MOVE.variant, name: `${PREFIX}move_b`, trackIds: [] },
        { userId: MOVE.canonical, name: `${PREFIX}move_c`, trackIds: [] },
      ],
    });
    await prisma.adminAuditEvent.create({
      data: { actorUserId: PREFIX, action: "user.detail_viewed", targetUserId: MOVE.variant },
    });

    // DROP: the canonical user already has each of these; the variant's are empty duplicates.
    await prisma.wallet.createMany({
      data: [
        { userId: DROP.canonical, address: ADDRESS_A, chainId: 1, balanceUsd: 5 },
        { userId: DROP.variant, address: ADDRESS_A_CHECKSUMMED, chainId: 1 },
      ],
    });
    await prisma.communityProfile.createMany({
      data: [
        { userId: DROP.canonical, displayName: "canonical" },
        { userId: DROP.variant, displayName: "variant" },
      ],
    });
    await prisma.generationCreditAccount.createMany({
      data: [
        { userId: DROP.canonical, balanceCents: 100 },
        { userId: DROP.variant, balanceCents: 0 },
      ],
    });
    const notice = await prisma.notice.create({
      data: { category: "policy", title: PREFIX, body: PREFIX, audience: "all", createdBy: PREFIX },
    });
    await prisma.noticeRead.createMany({
      data: [
        { noticeId: notice.id, userId: DROP.canonical },
        { noticeId: notice.id, userId: DROP.variant },
      ],
    });
    await prisma.playlist.create({ data: { userId: DROP.variant, name: `${PREFIX}drop`, trackIds: [] } });

    // VALUE: the variant's wallet holds a balance.
    await prisma.wallet.createMany({
      data: [
        { userId: VALUE.canonical, address: ADDRESS_A, chainId: 1 },
        { userId: VALUE.variant, address: ADDRESS_A, chainId: 1, balanceUsd: 7 },
      ],
    });
    await prisma.playlist.create({ data: { userId: VALUE.variant, name: `${PREFIX}value`, trackIds: [] } });

    // ADDRESS: a zero wallet, but not the same address.
    await prisma.wallet.createMany({
      data: [
        { userId: ADDRESS.canonical, address: ADDRESS_A, chainId: 1 },
        { userId: ADDRESS.variant, address: ADDRESS_B, chainId: 1 },
      ],
    });

    // UNKNOWN: a unique index outside the policy's reach (an expression index)
    // that the move violates. The whole group must roll back, including the
    // rows that moved before the clash.
    await prisma.$executeRawUnsafe(
      `CREATE UNIQUE INDEX "${INDEX_NAME}" ON "Playlist" (
         (CASE WHEN "name" LIKE '${UNKNOWN_PLAYLIST}%'
               THEN ("userId" ~ '^[a-z0-9_]+$')::text || "name" ELSE "id" END))`,
    );
    await prisma.playlist.createMany({
      data: [
        { userId: UNKNOWN.canonical, name: UNKNOWN_PLAYLIST, trackIds: [] },
        { userId: UNKNOWN.variant, name: UNKNOWN_PLAYLIST, trackIds: [] },
      ],
    });
    await prisma.adminAuditEvent.create({
      data: { actorUserId: PREFIX, action: "user.detail_viewed", targetUserId: UNKNOWN.variant },
    });
  });

  beforeEach(() => {
    info = jest.spyOn(console, "info").mockImplementation(() => undefined);
    warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    error = jest.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    info.mockRestore();
    warn.mockRestore();
    error.mockRestore();
  });

  afterAll(async () => {
    const safe = (work: Promise<unknown>) => work.catch(() => undefined);
    await safe(prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS "${INDEX_NAME}"`));
    await safe(prisma.noticeRead.deleteMany({ where: { userId: { in: ALL_IDS } } }));
    await safe(prisma.notice.deleteMany({ where: { createdBy: PREFIX } }));
    await safe(prisma.adminAuditEvent.deleteMany({ where: { actorUserId: PREFIX } }));
    await safe(prisma.playlist.deleteMany({ where: { userId: { in: ALL_IDS } } }));
    await safe(prisma.wallet.deleteMany({ where: { userId: { in: ALL_IDS } } }));
    await safe(prisma.communityProfile.deleteMany({ where: { userId: { in: ALL_IDS } } }));
    await safe(prisma.generationCreditAccount.deleteMany({ where: { userId: { in: ALL_IDS } } }));
    await safe(prisma.user.deleteMany({ where: { id: { in: ALL_IDS } } }));
    rmSync(dir, { recursive: true, force: true });
  });

  it("parses options: dry-run by default, --apply opt-in, bad flags rejected", () => {
    expect(parseMergeOptions([])).toEqual({ mode: "dry-run", limit: undefined, detailsFile: undefined });
    expect(parseMergeOptions(["--dry-run"]).mode).toBe("dry-run");
    expect(parseMergeOptions(["--apply", "--limit", "3", "--details-file", "/x.json"])).toEqual({
      mode: "apply",
      limit: 3,
      detailsFile: "/x.json",
    });
    expect(() => parseMergeOptions(["--apply", "--dry-run"])).toThrow(/mutually exclusive/);
    expect(() => parseMergeOptions(["--limit"])).toThrow(/positive whole number/);
    expect(() => parseMergeOptions(["--limit", "0"])).toThrow(/positive whole number/);
    expect(() => parseMergeOptions(["--limit", "x"])).toThrow(/positive whole number/);
    expect(() => parseMergeOptions(["--details-file"])).toThrow(/file path/);
  });

  it("dry-run (the default) leaves the database unchanged but reports the plan", async () => {
    const before = await snapshot();
    const { outcomes, totals } = await mergeCaseVariantUsers(parseMergeOptions([]));
    expect(totals.mode).toBe("dry-run");
    expect(await snapshot()).toEqual(before);

    const mine = mineOnly(outcomes);
    expect(byKey(mine, MOVE.key)).toMatchObject({ status: "merged" });
    expect(byKey(mine, DROP.key)).toMatchObject({ status: "merged" });
    expect(byKey(mine, VALUE.key)).toMatchObject({ status: "manual", reason: "conflict_variant_holds_value", reference: "Wallet.userId" });
  });

  it("logs counts and classes only: no user id, address or email", async () => {
    await runMergeCaseVariantUsers(["--dry-run", "--details-file", join(dir, "dry.json")]);
    const text = logged();
    expect(text).toContain("identity.case_variant_users.merge");
    expect(text).toContain("identity.case_variant_users.merge.manual");
    for (const id of ALL_IDS) expect(text).not.toContain(id);
    expect(text).not.toContain(ADDRESS_A);
    expect(text).not.toContain(ADDRESS_B);
    expect(text).not.toContain("test.resonate");
    expect(text).not.toContain(PREFIX);

    const file = join(dir, "dry.json");
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const details = JSON.parse(readFileSync(file, "utf8")) as { mode: string; groups: GroupOutcome[] };
    expect(details.mode).toBe("dry-run");
    expect(details.groups.some((group) => group.key === MOVE.key)).toBe(true);
  });

  let applied: GroupOutcome[];
  let dryRunPlan: GroupOutcome[];

  it("apply merges the safe groups and reports the same plan as the dry-run", async () => {
    dryRunPlan = mineOnly((await mergeCaseVariantUsers({ mode: "dry-run" })).outcomes);
    const before = await snapshot();

    const result = await runMergeCaseVariantUsers(["--apply"]);
    applied = mineOnly(result.outcomes);
    expect(applied).toEqual(dryRunPlan);
    expect(result.totals.mode).toBe("apply");
    expect(result.totals.manual).toBeGreaterThanOrEqual(6);
    expect(await snapshot()).not.toEqual(before);

    for (const id of ALL_IDS) expect(logged()).not.toContain(id);
  });

  it("MOVE: references move to the canonical user and the variant user is deleted", async () => {
    expect(byKey(applied, MOVE.key)).toEqual({
      key: MOVE.key,
      status: "merged",
      canonicalId: MOVE.canonical,
      variantId: MOVE.variant,
      moved: { "Playlist.userId": 2, "Wallet.userId": 1, "AdminAuditEvent.targetUserId": 1 },
      deleted: {},
    });
    expect(await prisma.user.findUnique({ where: { id: MOVE.variant } })).toBeNull();
    expect(await prisma.user.findUnique({ where: { id: MOVE.canonical } })).not.toBeNull();
    expect((await prisma.playlist.findMany({ where: { name: { startsWith: `${PREFIX}move_` } } })).map((p) => p.userId)).toEqual(
      expect.arrayContaining([MOVE.canonical]),
    );
    expect(await prisma.playlist.count({ where: { userId: MOVE.canonical, name: { startsWith: `${PREFIX}move_` } } })).toBe(3);
    expect((await prisma.wallet.findUnique({ where: { userId: MOVE.canonical } }))?.address).toBe(ADDRESS_A);
    expect(await prisma.adminAuditEvent.count({ where: { targetUserId: MOVE.canonical } })).toBe(1);
  });

  it("DROP: duplicate rows the policy allows are dropped, the canonical rows are untouched", async () => {
    const outcome = byKey(applied, DROP.key);
    expect(outcome).toMatchObject({ status: "merged" });
    if (outcome.status !== "merged") throw new Error("unreachable");
    expect(outcome.deleted).toEqual({
      Wallet: 1,
      CommunityProfile: 1,
      GenerationCreditAccount: 1,
      NoticeRead: 1,
    });
    expect(outcome.moved).toEqual({ "Playlist.userId": 1 });
    expect(await prisma.user.findUnique({ where: { id: DROP.variant } })).toBeNull();
    expect((await prisma.wallet.findUnique({ where: { userId: DROP.canonical } }))?.balanceUsd).toBe(5);
    expect((await prisma.generationCreditAccount.findUnique({ where: { userId: DROP.canonical } }))?.balanceCents).toBe(100);
    expect((await prisma.communityProfile.findUnique({ where: { userId: DROP.canonical } }))?.displayName).toBe("canonical");
    expect(await prisma.noticeRead.count({ where: { userId: { in: [DROP.canonical, DROP.variant] } } })).toBe(1);
    expect(await prisma.playlist.count({ where: { userId: DROP.canonical, name: `${PREFIX}drop` } })).toBe(1);
  });

  it("VALUE: a variant wallet with a balance is manual and the group is left untouched", async () => {
    expect(byKey(applied, VALUE.key)).toMatchObject({
      status: "manual",
      reason: "conflict_variant_holds_value",
      reference: "Wallet.userId",
    });
    expect(await prisma.user.count({ where: { id: { in: [VALUE.canonical, VALUE.variant] } } })).toBe(2);
    expect((await prisma.wallet.findUnique({ where: { userId: VALUE.variant } }))?.balanceUsd).toBe(7);
    expect(await prisma.playlist.count({ where: { userId: VALUE.variant, name: `${PREFIX}value` } })).toBe(1);
  });

  it("ADDRESS: a zero wallet at a different address is manual", async () => {
    expect(byKey(applied, ADDRESS.key)).toMatchObject({
      status: "manual",
      reason: "conflict_wallet_address_differs",
      reference: "Wallet.userId",
    });
    expect(await prisma.wallet.count({ where: { userId: ADDRESS.variant } })).toBe(1);
  });

  it("UNKNOWN: a unique conflict outside the policy rolls the whole group back", async () => {
    expect(byKey(applied, UNKNOWN.key)).toMatchObject({
      status: "manual",
      reason: "unknown_conflict",
      reference: "Playlist.userId",
    });
    expect(await prisma.user.count({ where: { id: { in: [UNKNOWN.canonical, UNKNOWN.variant] } } })).toBe(2);
    expect(await prisma.playlist.count({ where: { userId: UNKNOWN.variant, name: UNKNOWN_PLAYLIST } })).toBe(1);
    expect(await prisma.playlist.count({ where: { userId: UNKNOWN.canonical, name: UNKNOWN_PLAYLIST } })).toBe(1);
    // Even references on columns processed before the clash stayed with the variant.
    expect(await prisma.adminAuditEvent.count({ where: { targetUserId: UNKNOWN.variant } })).toBe(1);
  });

  it("group shapes the script will not decide are manual", async () => {
    expect(byKey(applied, NOLOWER.key)).toMatchObject({ status: "manual", reason: "no_lowercase_member" });
    expect(byKey(applied, CROWDED.key)).toMatchObject({ status: "manual", reason: "more_than_two_members" });
    expect(byKey(applied, ERASED.key)).toMatchObject({ status: "manual", reason: "canonical_erased" });
    expect(await prisma.user.count({ where: { id: { in: [NOLOWER.variant, NOLOWER_B, CROWDED.canonical, CROWDED.variant, CROWDED_C, ERASED.canonical, ERASED.variant] } } })).toBe(7);
  });

  it("is idempotent: a re-run finds no merged group again, only the manual ones", async () => {
    const second = await mergeCaseVariantUsers({ mode: "apply" });
    const mine = mineOnly(second.outcomes);
    expect(mine.every((outcome) => outcome.status === "manual")).toBe(true);
    expect(mine.map((outcome) => outcome.key).sort()).toEqual(
      applied.filter((outcome) => outcome.status === "manual").map((outcome) => outcome.key).sort(),
    );

    // Once the manual groups are resolved by hand, nothing is left to do.
    await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS "${INDEX_NAME}"`);
    const manualVariants = ALL_IDS.filter((id) => id !== id.toLowerCase());
    await prisma.wallet.deleteMany({ where: { userId: { in: manualVariants } } });
    await prisma.adminAuditEvent.deleteMany({ where: { actorUserId: PREFIX } });
    await prisma.playlist.deleteMany({ where: { userId: { in: ALL_IDS } } });
    await prisma.user.deleteMany({ where: { id: { in: manualVariants } } });
    const third = await mergeCaseVariantUsers({ mode: "apply" });
    expect(mineOnly(third.outcomes)).toEqual([]);
  });

  it("--limit processes only the first groups", async () => {
    const { outcomes, totals } = await mergeCaseVariantUsers({ mode: "dry-run", limit: 1 });
    expect(outcomes.length).toBeLessThanOrEqual(1);
    expect(totals.groupsProcessed).toBe(outcomes.length);
  });

  it("totals are counts per reference and per table", () => {
    const outcomes: GroupOutcome[] = [
      { key: "a", status: "merged", canonicalId: "a", variantId: "A", moved: { "T.c": 2 }, deleted: { T: 1 } },
      { key: "b", status: "merged", canonicalId: "b", variantId: "B", moved: { "T.c": 3, "U.c": 1 }, deleted: {} },
      { key: "c", status: "manual", reason: "r", reference: "T.c", memberIds: ["c", "C"] },
    ];
    expect(totalsOf("apply", 3, outcomes)).toMatchObject({
      groupsFound: 3,
      groupsProcessed: 3,
      merged: 2,
      manual: 1,
      rowsMoved: 6,
      rowsDeleted: 1,
      movedByReference: { "T.c": 5, "U.c": 1 },
      deletedByTable: { T: 1 },
      manualByReason: [{ reason: "r", reference: "T.c", groups: 1 }],
    });
  });
});
