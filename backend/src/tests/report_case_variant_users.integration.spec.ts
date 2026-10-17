/**
 * Case-variant user report - Integration Test (Testcontainers), #2180
 *
 * Seeds two `User` ids that are equal under lowercase, with rows referencing
 * each, and checks the read-only report: grouping, per-table reference counts
 * (declared foreign keys and the erasure manifest's relation-less person
 * columns), the owner-only details file, and that logs carry counts only.
 *
 * Run: npm run test:integration -- report_case_variant_users
 */

import { mkdtempSync, readFileSync, rmSync, statSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { prisma } from "../db/prisma";
import {
  casingClassOf,
  parseDetailsFile,
  runCaseVariantReport,
  summarizeReport,
  type CaseVariantReport,
} from "../scripts/report_case_variant_users";

const STAMP = Date.now();
const LOWER = `cvr_${STAMP}_user`;
const MIXED = `Cvr_${STAMP}_User`;
const SOLO = `cvr_${STAMP}_solo`;

describe("report_case_variant_users (integration, #2180)", () => {
  let dir: string;
  let info: jest.SpyInstance;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "cvr-"));
    await prisma.user.createMany({
      data: [
        { id: LOWER, email: `${LOWER}@test.resonate` },
        { id: MIXED, email: `${MIXED}@test.resonate` },
        { id: SOLO, email: `${SOLO}@test.resonate` },
      ],
    });
    // Rows referencing each variant: declared foreign keys...
    await prisma.playlist.createMany({
      data: [
        { userId: LOWER, name: "a", trackIds: [] },
        { userId: LOWER, name: "b", trackIds: [] },
        { userId: MIXED, name: "c", trackIds: [] },
      ],
    });
    await prisma.wallet.create({
      data: { userId: MIXED, address: `0x${"1".repeat(40)}`, chainId: 1 },
    });
    // ...and a person-id column that has no relation (erasure manifest).
    await prisma.adminAuditEvent.create({
      data: { actorUserId: SOLO, action: "user.detail_viewed", targetUserId: MIXED },
    });
    await prisma.playlist.create({ data: { userId: SOLO, name: "solo", trackIds: [] } });
  });

  beforeEach(() => {
    info = jest.spyOn(console, "info").mockImplementation(() => undefined);
  });

  afterEach(() => {
    info.mockRestore();
  });

  afterAll(async () => {
    const ids = [LOWER, MIXED, SOLO];
    await prisma.adminAuditEvent.deleteMany({ where: { actorUserId: SOLO } }).catch(() => {});
    await prisma.playlist.deleteMany({ where: { userId: { in: ids } } }).catch(() => {});
    await prisma.wallet.deleteMany({ where: { userId: { in: ids } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { in: ids } } }).catch(() => {});
    rmSync(dir, { recursive: true, force: true });
  });

  it("finds the case-variant group, not the solo user, and counts references per table", async () => {
    const { report } = await runCaseVariantReport([]);
    const group = report.groups.find((entry) => entry.key === LOWER);
    expect(group).toBeDefined();
    expect(report.groups.some((entry) => entry.variants.some((v) => v.id === SOLO))).toBe(false);

    const lower = group!.variants.find((variant) => variant.id === LOWER)!;
    const mixed = group!.variants.find((variant) => variant.id === MIXED)!;
    expect(lower.casing).toBe("lowercase");
    expect(mixed.casing).toBe("mixed");
    expect(lower.references).toEqual({ "Playlist.userId": 2 });
    expect(lower.referenceTotal).toBe(2);
    expect(mixed.references).toEqual({
      "Playlist.userId": 1,
      "Wallet.userId": 1,
      "AdminAuditEvent.targetUserId": 1,
    });
    expect(mixed.referenceTotal).toBe(3);
  });

  it("logs counts only: no user ids", async () => {
    const { summary } = await runCaseVariantReport([]);
    expect(summary.groups).toBeGreaterThanOrEqual(1);
    expect(summary.mixedVariants).toBeGreaterThanOrEqual(1);

    const logged = info.mock.calls.map((call) => String(call[0])).join("\n");
    expect(logged).toContain("identity.case_variant_users.report");
    expect(logged).not.toContain(LOWER);
    expect(logged).not.toContain(MIXED);
    expect(logged).not.toContain(SOLO);
  });

  it("writes the per-group detail to an owner-only --details-file, never to the log", async () => {
    const file = join(dir, "details.json");
    await runCaseVariantReport(["--details-file", file]);

    const parsed = JSON.parse(readFileSync(file, "utf8")) as CaseVariantReport;
    const group = parsed.groups.find((entry) => entry.key === LOWER);
    expect(group?.variants.map((variant) => variant.id).sort()).toEqual([MIXED, LOWER].sort());
    expect(statSync(file).mode & 0o777).toBe(0o600);

    const logged = info.mock.calls.map((call) => String(call[0])).join("\n");
    expect(logged).not.toContain(MIXED);
    expect(logged).toContain('"detailsFileWritten":true');
  });

  it("is read-only: the users and rows are untouched afterwards", async () => {
    await runCaseVariantReport([]);
    expect(await prisma.user.count({ where: { id: { in: [LOWER, MIXED, SOLO] } } })).toBe(3);
    expect(await prisma.playlist.count({ where: { userId: { in: [LOWER, MIXED] } } })).toBe(3);
  });

  it("--summary logs rows per referencing column, split by lowercase vs mixed-case variants, without ids", async () => {
    const { referencesByCasing } = await runCaseVariantReport(["--summary"]);
    const byReference = new Map(referencesByCasing.map((entry) => [entry.reference, entry]));
    expect(byReference.get("Playlist.userId")).toMatchObject({ lowercase: 2, mixed: 1 });
    expect(byReference.get("Wallet.userId")).toMatchObject({ lowercase: 0, mixed: 1 });
    expect(byReference.get("AdminAuditEvent.targetUserId")).toMatchObject({ lowercase: 0, mixed: 1 });

    const lines = info.mock.calls
      .map((call) => String(call[0]))
      .filter((line) => line.includes("identity.case_variant_users.report.reference"));
    expect(lines.length).toBeGreaterThanOrEqual(3);
    expect(lines.some((line) => line.includes('"reference":"Playlist.userId"'))).toBe(true);
    const logged = info.mock.calls.map((call) => String(call[0])).join("\n");
    expect(logged).not.toContain(LOWER);
    expect(logged).not.toContain(MIXED);
    expect(logged).not.toContain(SOLO);
  });

  it("emits no per-column lines without --summary", async () => {
    const { referencesByCasing } = await runCaseVariantReport([]);
    expect(referencesByCasing).toEqual([]);
    expect(info.mock.calls.some((call) => String(call[0]).includes("report.reference"))).toBe(false);
  });

  it("parses --details-file and rejects a missing value", () => {
    expect(parseDetailsFile([])).toBeUndefined();
    expect(parseDetailsFile(["--details-file", "/x/y.json"])).toBe("/x/y.json");
    expect(() => parseDetailsFile(["--details-file"])).toThrow(/file path/);
    expect(() => parseDetailsFile(["--details-file", "--other"])).toThrow(/file path/);
  });

  it("classifies casing and summarises an empty report", () => {
    expect(casingClassOf("0xabc")).toBe("lowercase");
    expect(casingClassOf("0xAbc")).toBe("mixed");
    expect(summarizeReport({ generatedAt: "t", groups: [] }, 0)).toEqual({
      groups: 0,
      users: 0,
      lowercaseVariants: 0,
      mixedVariants: 0,
      referenceColumnsScanned: 0,
      referencingRows: 0,
      tablesWithReferences: 0,
    });
  });
});
