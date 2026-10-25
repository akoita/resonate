/**
 * One entitlement service and operator grants (#2406), against Postgres.
 *
 * Grants are created, listed and revoked through the real service; the
 * decision for a person with no grant, an active, an expired and a revoked
 * grant is read back; the Remix, Crate and Scene Scout adapters keep their
 * shapes and answers (policy `everyone`); and erasure scrubs the admin's note
 * and stops naming an erased admin.
 */
import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { prisma } from "../db/prisma";
import { EntitlementGrantsService } from "../modules/entitlements/entitlement_grants.service";
import { EntitlementsService } from "../modules/entitlements/entitlements.service";
import { RemixEntitlementsService } from "../modules/remix/remix-entitlements";
import { CrateEntitlementsService } from "../modules/crates/crate-entitlements";
import { SceneScoutEntitlementsService } from "../modules/scene_scout/scene_scout.service";
import { AnalyticsGovernanceService } from "../modules/analytics/analytics_governance.service";
import { PersonalDataResolverService } from "../modules/identity/personal_data_resolver.service";
import { AccountClosureService } from "../modules/privacy/account_closure.service";
import { PersonalDataErasureService } from "../modules/privacy/personal_data_erasure.service";

const TEST_PREFIX = `entitlements_${Date.now()}_`;
const ADMIN = `${TEST_PREFIX}admin`;
const NONE = `${TEST_PREFIX}none`;
const ACTIVE = `${TEST_PREFIX}active`;
const EXPIRED = `${TEST_PREFIX}expired`;
const REVOKED = `${TEST_PREFIX}revoked`;
const ERASED = `${TEST_PREFIX}erased`;
const ARTIST_OWNER = `${TEST_PREFIX}artist_owner`;
const ARTIST_ID = `${TEST_PREFIX}artist`;
const USERS = [ADMIN, NONE, ACTIVE, EXPIRED, REVOKED, ERASED, ARTIST_OWNER];
const DAY = 24 * 60 * 60 * 1000;
const NOTE = "Founding artist programme";

const grants = new EntitlementGrantsService();
const entitlements = new EntitlementsService(grants);
const inDays = (days: number) => new Date(Date.now() + days * DAY).toISOString();

describe("Entitlements (integration, #2406)", () => {
  const erasedIds: string[] = [];

  beforeAll(async () => {
    for (const id of USERS) {
      await prisma.user.create({ data: { id, email: `${id}@test.resonate` } });
    }
    await prisma.artist.create({ data: { id: ARTIST_ID, userId: ARTIST_OWNER, displayName: `${TEST_PREFIX}Artist` } });
  });

  afterAll(async () => {
    const ids = [...USERS, ...erasedIds];
    await prisma.entitlementGrant.deleteMany({ where: { userId: { in: ids } } });
    await prisma.artist.deleteMany({ where: { id: ARTIST_ID } });
    await prisma.accountClosureRequest.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  });

  describe("grants", () => {
    it("creates an active grant with the admin as author and lists it", async () => {
      const created = await grants.create(ADMIN, { userId: ACTIVE, validUntil: inDays(30), reason: `  ${NOTE}  ` });
      expect(created).toMatchObject({
        userId: ACTIVE,
        plan: "pro",
        source: "operator_grant",
        reason: NOTE,
        createdByUserId: ADMIN,
        revokedAt: null,
        status: "active",
      });
      await expect(grants.listForUser(ACTIVE)).resolves.toEqual([created]);
    });

    it("refuses an unknown person (404) and an end in the past or before the start (400)", async () => {
      await expect(grants.create(ADMIN, { userId: `${TEST_PREFIX}ghost`, reason: NOTE })).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(grants.create(ADMIN, { userId: NONE, validUntil: inDays(-1), reason: NOTE })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(
        grants.create(ADMIN, { userId: NONE, validFrom: inDays(10), validUntil: inDays(5), reason: NOTE }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(grants.create(ADMIN, { userId: NONE, reason: "   " })).rejects.toBeInstanceOf(BadRequestException);
      expect(await prisma.entitlementGrant.count({ where: { userId: NONE } })).toBe(0);
    });

    it("revokes once, keeps the row, then answers 409; an unknown id is 404", async () => {
      const created = await grants.create(ADMIN, { userId: REVOKED, validUntil: inDays(30), reason: NOTE });
      const revoked = await grants.revoke(ADMIN, created.id);
      expect(revoked).toMatchObject({ id: created.id, status: "revoked", revokedByUserId: ADMIN });
      expect(revoked.revokedAt).not.toBeNull();
      await expect(grants.revoke(ADMIN, created.id)).rejects.toBeInstanceOf(ConflictException);
      await expect(grants.revoke(ADMIN, `${TEST_PREFIX}missing`)).rejects.toBeInstanceOf(NotFoundException);
      expect(await prisma.entitlementGrant.count({ where: { id: created.id } })).toBe(1);
    });
  });

  describe("decisions: no grant, active, expired, revoked", () => {
    beforeAll(async () => {
      await prisma.entitlementGrant.create({
        data: {
          userId: EXPIRED,
          validFrom: new Date(Date.now() - 40 * DAY),
          validUntil: new Date(Date.now() - DAY),
          reason: NOTE,
          createdByUserId: ADMIN,
        },
      });
    });

    it("everyone is allowed with the old reason; only the active grant reads pro", async () => {
      const decide = (userId: string) => entitlements.decide(userId, "remix.pro");
      await expect(decide(NONE)).resolves.toEqual({
        allowed: true,
        reason: "free_for_everyone",
        plan: "free",
        policyVersion: "entitlements/v1",
      });
      const active = await decide(ACTIVE);
      expect(active).toMatchObject({ allowed: true, reason: "free_for_everyone", plan: "pro", source: "operator_grant" });
      expect(Date.parse(active.validUntil!)).toBeGreaterThan(Date.now());
      await expect(decide(EXPIRED)).resolves.toMatchObject({ allowed: true, plan: "free" });
      await expect(decide(REVOKED)).resolves.toMatchObject({ allowed: true, plan: "free" });
      await expect(entitlements.resolvePlan(EXPIRED)).resolves.toEqual({ plan: "free" });
      const statuses = (await grants.listForUser(EXPIRED)).map((grant) => grant.status);
      expect(statuses).toEqual(["expired"]);
    });

    it("the adapters keep their DTO shape and answer for a granted person too", async () => {
      const remix = new RemixEntitlementsService(entitlements);
      const crate = new CrateEntitlementsService(entitlements);
      for (const userId of [NONE, ACTIVE]) {
        await expect(remix.forProject(userId)).resolves.toEqual({
          pro: { allowed: true, reason: "free_for_everyone", policyVersion: "remix-pro-policy/v1" },
        });
        const free = { allowed: true, reason: "free_for_everyone", policyVersion: "crate-pro-policy/v1" };
        await expect(crate.forCrate(userId)).resolves.toEqual({ pro: free, export: free, watch: free });
      }
    });

    it("the cockpit demand cards stay readable for every artist, known or not", async () => {
      const scout = new SceneScoutEntitlementsService(entitlements);
      const spy = jest.spyOn(entitlements, "decide");
      await expect(scout.canRead(ARTIST_ID)).resolves.toBe(true);
      expect(spy).toHaveBeenLastCalledWith(ARTIST_OWNER, "cockpit.demand");
      await expect(scout.canRead(`${TEST_PREFIX}no_artist`)).resolves.toBe(true);
      spy.mockRestore();
    });
  });

  describe("erasure", () => {
    const erasure = new PersonalDataErasureService(
      new PersonalDataResolverService(),
      new AnalyticsGovernanceService(),
      new AccountClosureService(),
    );

    it("scrubs the note on the person's grant and stops naming an erased admin", async () => {
      const otherAdmin = `${TEST_PREFIX}admin_two`;
      await prisma.user.create({ data: { id: otherAdmin, email: `${otherAdmin}@test.resonate` } });
      const kept = await grants.create(otherAdmin, { userId: NONE, validUntil: inDays(10), reason: NOTE });
      const own = await grants.create(ADMIN, { userId: ERASED, validUntil: inDays(10), reason: NOTE });

      const person = await erasure.eraseAccount(ERASED);
      erasedIds.push(person.newUserId);
      const ownRow = await prisma.entitlementGrant.findUniqueOrThrow({ where: { id: own.id } });
      expect(ownRow).toMatchObject({ userId: person.newUserId, reason: null, createdByUserId: ADMIN });

      const admin = await erasure.eraseAccount(otherAdmin);
      erasedIds.push(admin.newUserId);
      const keptRow = await prisma.entitlementGrant.findUniqueOrThrow({ where: { id: kept.id } });
      // The note is about NONE, not the admin's own data: it stays; the author id is rewritten.
      expect(keptRow).toMatchObject({ userId: NONE, reason: NOTE, createdByUserId: admin.newUserId });
    });
  });
});
