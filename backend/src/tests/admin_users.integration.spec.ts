/**
 * Operator users directory, overview and detail (#2166) against real Postgres.
 *
 * Every seeded wallet address starts with the same random RUN_TAG, so a query
 * with `q: RUN_TAG` returns exactly this run's accounts and the assertions do
 * not depend on whatever else is in the database. Only the overview, which is
 * platform-wide by nature, is asserted as a delta against a baseline taken
 * before seeding.
 */
import { randomBytes } from "crypto";
import { NotFoundException } from "@nestjs/common";
import { getAddress } from "viem";
import { prisma } from "../db/prisma";
import { AdminUsersService } from "../modules/admin_users/admin_users.service";

const TEST_PREFIX = `admin_users_${Date.now()}_`;
const RUN_TAG = `0x${randomBytes(4).toString("hex")}`;
/** A 42-character address that starts with RUN_TAG; `label` is four hex digits. */
const addr = (label: string) => `${RUN_TAG}${randomBytes(14).toString("hex")}${label}`.toLowerCase();

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const ago = (ms: number) => new Date(Date.now() - ms);

const ID = {
  alice: `${TEST_PREFIX}alice`,
  bob: `${TEST_PREFIX}bob`,
  carol: `${TEST_PREFIX}carol`,
  dave: `${TEST_PREFIX}dave`,
  erin: `${TEST_PREFIX}erin`,
  frank: `${TEST_PREFIX}frank`,
  admin: `${TEST_PREFIX}admin`,
  operator: `${TEST_PREFIX}operator`,
  erased: `${TEST_PREFIX}erased`,
  actor: `${TEST_PREFIX}actor`,
};
const LIVE_IDS = [ID.alice, ID.bob, ID.carol, ID.dave, ID.erin, ID.frank, ID.admin, ID.operator];
const ALL_IDS = [...LIVE_IDS, ID.erased, ID.actor];

const WALLET = {
  alice: addr("a11c"),
  bob: addr("b0b0"),
  carol: addr("ca01"),
  dave: addr("da0e"),
  erin: addr("e121"),
  frank: addr("f2a4"),
  admin: addr("ad01"),
  operator: addr("0e01"),
  erased: addr("dead"),
};
const ALICE_OWNER = addr("a11e");

const ARTIST_ID = `${TEST_PREFIX}artist`;
const CAMPAIGN_ID = `${TEST_PREFIX}campaign`;
const LISTING_ID = `${TEST_PREFIX}listing`;
const STEM_ID = `${TEST_PREFIX}stem`;
const TRACK_ID = `${TEST_PREFIX}track`;
const RELEASE_IDS = [`${TEST_PREFIX}release1`, `${TEST_PREFIX}release2`];

const ENV_KEYS = ["ADMIN_ADDRESSES", "OPERATOR_ADDRESSES", "AGENT_ADDRESSES"] as const;
const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

describe("AdminUsersService (integration)", () => {
  const service = new AdminUsersService();
  let baseline: Awaited<ReturnType<AdminUsersService["overview"]>>;

  /** Every account this run created that is still visible to the directory. */
  const scoped = (query: Record<string, unknown> = {}) =>
    service.list({ q: RUN_TAG, pageSize: 100, ...query } as any);
  const ids = async (query: Record<string, unknown> = {}) => (await scoped(query)).items.map((row) => row.id);
  const sorted = (values: string[]) => [...values].sort();

  async function seedUser(
    id: string,
    wallet: string,
    data: Record<string, unknown> & { createdAt: Date },
    ownerAddress?: string,
  ) {
    await prisma.user.create({
      data: {
        id,
        email: `${id}@test.resonate`,
        ...data,
        wallet: { create: { address: wallet, ownerAddress: ownerAddress ?? null, chainId: 31337, accountType: "erc4337" } },
      },
    });
  }

  beforeAll(async () => {
    baseline = await service.overview();

    process.env.ADMIN_ADDRESSES = WALLET.admin;
    process.env.OPERATOR_ADDRESSES = WALLET.operator;
    process.env.AGENT_ADDRESSES = ALICE_OWNER;

    await seedUser(
      ID.alice,
      WALLET.alice,
      { createdAt: ago(40 * DAY), lastSignInAt: ago(3 * DAY), lastActiveAt: ago(2 * DAY) },
      ALICE_OWNER,
    );
    await seedUser(ID.bob, WALLET.bob, {
      createdAt: ago(10 * DAY),
      lastSignInAt: ago(DAY),
      lastActiveAt: ago(20 * HOUR),
    });
    await seedUser(ID.carol, WALLET.carol, {
      createdAt: ago(100 * DAY),
      accountStatus: "suspended",
      accountStatusReason: "abuse",
      accountStatusChangedAt: ago(30 * DAY),
      accountStatusChangedBy: ID.actor,
    });
    await seedUser(ID.dave, WALLET.dave, {
      createdAt: ago(5 * DAY),
      lastActiveAt: ago(10 * DAY),
      accountStatus: "suspended",
      accountStatusReason: "other",
      accountStatusUntil: ago(DAY),
    });
    await seedUser(ID.erin, WALLET.erin, {
      createdAt: ago(300 * DAY),
      lastActiveAt: ago(200 * DAY),
      accountStatus: "closed",
      accountStatusReason: "fraud",
    });
    await seedUser(ID.frank, WALLET.frank, { createdAt: ago(2 * DAY) });
    await seedUser(ID.admin, WALLET.admin, { createdAt: ago(3 * DAY), lastActiveAt: ago(HOUR) });
    await seedUser(ID.operator, WALLET.operator, { createdAt: ago(4 * DAY), lastActiveAt: ago(12 * HOUR) });
    await seedUser(ID.erased, WALLET.erased, {
      createdAt: ago(DAY),
      lastActiveAt: ago(HOUR),
      erasedAt: new Date(),
    });
    // The operator who acted on carol earlier; deliberately has no wallet, so RUN_TAG does not match it.
    await prisma.user.create({ data: { id: ID.actor, email: `${ID.actor}@test.resonate`, createdAt: ago(90 * DAY) } });

    // bob: an artist with two releases, and the seller of the listing purchases hang off.
    await prisma.artist.create({
      data: { id: ARTIST_ID, userId: ID.bob, displayName: `${TEST_PREFIX}Bobby Beats` },
    });
    await prisma.release.createMany({
      data: RELEASE_IDS.map((id, i) => ({
        id,
        artistId: ARTIST_ID,
        title: `${TEST_PREFIX}release${i + 1}`,
        status: "published",
        createdAt: ago((i + 1) * DAY),
      })),
    });
    await prisma.track.create({ data: { id: TRACK_ID, releaseId: RELEASE_IDS[0], title: `${TEST_PREFIX}track` } });
    await prisma.stem.create({ data: { id: STEM_ID, trackId: TRACK_ID, type: "vocals", uri: `ipfs://${TEST_PREFIX}stem` } });
    await prisma.stemListing.create({
      data: {
        id: LISTING_ID,
        stemId: STEM_ID,
        listingId: BigInt(Date.now()),
        tokenId: 1n,
        chainId: 31337,
        contractAddress: addr("c0de"),
        sellerAddress: WALLET.bob,
        pricePerUnit: "1000",
        amount: 10n,
        paymentToken: "0x0000000000000000000000000000000000000000",
        expiresAt: new Date("2099-01-01T00:00:00.000Z"),
        transactionHash: `0x${randomBytes(32).toString("hex")}`,
        blockNumber: 1n,
        listedAt: ago(DAY),
      },
    });

    // Purchases are keyed by buyer address only: alice's wallet (lowercase and
    // checksummed forms) and her owner address, plus one from bob.
    const purchase = (buyerAddress: string, totalPaid: string, purchasedAt: Date) => ({
      id: `${TEST_PREFIX}purchase_${randomBytes(4).toString("hex")}`,
      listingId: LISTING_ID,
      buyerAddress,
      amount: 1n,
      totalPaid,
      royaltyPaid: "1",
      protocolFeePaid: "1",
      sellerReceived: "1",
      transactionHash: `0x${randomBytes(32).toString("hex")}`,
      logIndex: 0,
      blockNumber: 2n,
      purchasedAt,
    });
    await prisma.stemPurchase.createMany({
      data: [
        purchase(WALLET.alice, "100", ago(5 * DAY)),
        purchase(WALLET.alice, "200", ago(4 * DAY)),
        purchase(ALICE_OWNER, "300", ago(3 * DAY)),
        purchase(getAddress(WALLET.alice), "400", ago(2 * DAY)),
        purchase(WALLET.bob, "500", ago(DAY)),
      ],
    });

    await prisma.showCampaign.create({
      data: {
        id: CAMPAIGN_ID,
        slug: `${TEST_PREFIX}campaign`,
        artistDisplayName: "Fixture",
        title: "Fixture",
        city: "Paris",
        country: "FR",
        deadline: new Date("2099-01-01T00:00:00.000Z"),
        goalAmountUnits: "1000000",
        chainId: 31337,
      },
    });
    for (const n of [1, 2]) {
      await prisma.showPledge.create({
        data: {
          id: `${TEST_PREFIX}pledge${n}`,
          campaignId: CAMPAIGN_ID,
          userId: ID.alice,
          walletAddress: WALLET.alice,
          amountUnits: `${n}000000`,
          chainId: 31337,
          createdAt: ago(n * DAY),
        },
      });
    }
    await prisma.passkeyIdentity.create({
      data: { id: `${TEST_PREFIX}passkey`, userId: ID.alice, publicKeyHash: `${TEST_PREFIX}pk_hash` },
    });
    await prisma.notice.create({
      data: {
        id: `${TEST_PREFIX}notice`,
        category: "account",
        title: "t",
        body: "b",
        audience: "user",
        recipientUserId: ID.alice,
        createdBy: "system:test",
      },
    });
    await prisma.adminAuditEvent.create({
      data: { actorUserId: ID.actor, action: "account.suspended", targetUserId: ID.carol, detail: { reason: "abuse" } },
    });
  });

  afterAll(async () => {
    await prisma.adminAuditEvent.deleteMany({
      where: { OR: [{ actorUserId: { in: ALL_IDS } }, { targetUserId: { in: ALL_IDS } }] },
    });
    await prisma.stemPurchase.deleteMany({ where: { listingId: LISTING_ID } });
    await prisma.stemListing.deleteMany({ where: { id: LISTING_ID } });
    await prisma.stem.deleteMany({ where: { id: STEM_ID } });
    await prisma.track.deleteMany({ where: { id: TRACK_ID } });
    await prisma.release.deleteMany({ where: { artistId: ARTIST_ID } });
    await prisma.showPledge.deleteMany({ where: { campaignId: CAMPAIGN_ID } });
    await prisma.showCampaign.deleteMany({ where: { id: CAMPAIGN_ID } });
    await prisma.passkeyIdentity.deleteMany({ where: { userId: { in: ALL_IDS } } });
    await prisma.notice.deleteMany({ where: { recipientUserId: { in: ALL_IDS } } });
    await prisma.artist.deleteMany({ where: { id: ARTIST_ID } });
    await prisma.wallet.deleteMany({ where: { userId: { in: ALL_IDS } } });
    await prisma.user.deleteMany({ where: { id: { in: ALL_IDS } } });
    for (const key of ENV_KEYS) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
    await prisma.$disconnect();
  });

  describe("overview", () => {
    it("counts users, new users, active users, suspended and closed, excluding erased accounts", async () => {
      const now = await service.overview();
      expect(now.totalUsers - baseline.totalUsers).toBe(9); // 10 seeded, minus the erased one (the actor counts)
      expect(now.newUsers.d7 - baseline.newUsers.d7).toBe(4); // dave, frank, admin, operator
      expect(now.newUsers.d30 - baseline.newUsers.d30).toBe(5); // + bob
      expect(now.activeUsers.d1 - baseline.activeUsers.d1).toBe(3); // bob, admin, operator
      expect(now.activeUsers.d7 - baseline.activeUsers.d7).toBe(4); // + alice
      expect(now.activeUsers.d30 - baseline.activeUsers.d30).toBe(5); // + dave
      // dave's suspension ended yesterday, so only carol is suspended now.
      expect(now.suspended - baseline.suspended).toBe(1);
      expect(now.closed - baseline.closed).toBe(1);
      expect(new Date(now.generatedAt).getTime()).toBeGreaterThan(Date.now() - 60_000);
    });
  });

  describe("search", () => {
    it("excludes erased accounts, even on an exact id or wallet match", async () => {
      expect(await ids()).not.toContain(ID.erased);
      expect((await service.list({ q: ID.erased } as any)).total).toBe(0);
      expect((await service.list({ q: WALLET.erased } as any)).total).toBe(0);
    });

    it("finds an account by exact user id", async () => {
      const page = await service.list({ q: ID.alice } as any);
      expect(page.items.map((row) => row.id)).toEqual([ID.alice]);
    });

    it("finds an account by a case-insensitive wallet address, in full or by prefix", async () => {
      expect((await service.list({ q: WALLET.carol.toUpperCase() } as any)).items.map((r) => r.id)).toEqual([ID.carol]);
      expect((await service.list({ q: WALLET.dave.slice(0, 30) } as any)).items.map((r) => r.id)).toEqual([ID.dave]);
    });

    it("finds an account by its owner address", async () => {
      expect((await service.list({ q: ALICE_OWNER.toUpperCase() } as any)).items.map((r) => r.id)).toEqual([ID.alice]);
    });

    it("finds an artist by display name, case-insensitively and by substring", async () => {
      expect((await service.list({ q: "bobby beats" } as any)).items.map((r) => r.id)).toEqual([ID.bob]);
      expect((await service.list({ q: "OBBY" } as any)).items.map((r) => r.id)).toEqual([ID.bob]);
    });

    it("does not match on email", async () => {
      expect((await service.list({ q: `${ID.alice}@test.resonate` } as any)).total).toBe(0);
    });

    it("matches nothing for an unknown term", async () => {
      expect((await service.list({ q: `${TEST_PREFIX}nobody_at_all` } as any)).total).toBe(0);
    });
  });

  describe("filters", () => {
    it("filters by effective status: an expired suspension counts as active", async () => {
      expect(sorted(await ids({ status: "suspended" }))).toEqual([ID.carol]);
      expect(sorted(await ids({ status: "closed" }))).toEqual([ID.erin]);
      expect(sorted(await ids({ status: "active" }))).toEqual(
        sorted([ID.alice, ID.bob, ID.dave, ID.frank, ID.admin, ID.operator]),
      );
    });

    it("filters by role, from the same allowlists sign-in uses", async () => {
      expect(await ids({ role: "admin" })).toEqual([ID.admin]);
      expect(await ids({ role: "operator" })).toEqual([ID.operator]);
      // alice's OWNER address is on the agent allowlist.
      expect(await ids({ role: "agent" })).toEqual([ID.alice]);
      expect(await ids({ role: "artist" })).toEqual([ID.bob]);
      expect(sorted(await ids({ role: "listener" }))).toEqual(
        sorted([ID.carol, ID.dave, ID.erin, ID.frank]),
      );
    });

    it("matches no one for a privileged role whose allowlist is empty", async () => {
      process.env.AGENT_ADDRESSES = "";
      try {
        expect(await ids({ role: "agent" })).toEqual([]);
        expect(sorted(await ids({ role: "listener" }))).toEqual(
          sorted([ID.alice, ID.carol, ID.dave, ID.erin, ID.frank]),
        );
      } finally {
        process.env.AGENT_ADDRESSES = ALICE_OWNER;
      }
    });

    it("filters by activity within N days", async () => {
      expect(sorted(await ids({ activeWithinDays: 1 }))).toEqual(sorted([ID.bob, ID.admin, ID.operator]));
      expect(sorted(await ids({ activeWithinDays: 30 }))).toEqual(
        sorted([ID.alice, ID.bob, ID.dave, ID.admin, ID.operator]),
      );
    });

    it("filters by inactivity for N days, including never-active accounts older than N days", async () => {
      // carol never acted and joined 100 days ago; frank never acted but joined 2 days ago.
      expect(sorted(await ids({ inactiveForDays: 30 }))).toEqual(sorted([ID.carol, ID.erin]));
      expect(sorted(await ids({ inactiveForDays: 1 }))).toEqual(
        sorted([ID.alice, ID.carol, ID.dave, ID.erin, ID.frank]),
      );
    });

    it("combines filters", async () => {
      expect(await ids({ status: "active", role: "artist", activeWithinDays: 7 })).toEqual([ID.bob]);
      expect(await ids({ status: "suspended", activeWithinDays: 7 })).toEqual([]);
    });
  });

  describe("sort and pagination", () => {
    it("sorts by last activity with accounts that never acted last, in either order", async () => {
      expect(await ids({ sort: "lastActiveAt", order: "desc" })).toEqual([
        ID.admin, ID.operator, ID.bob, ID.alice, ID.dave, ID.erin, ID.carol, ID.frank,
      ]);
      expect(await ids({ sort: "lastActiveAt", order: "asc" })).toEqual([
        ID.erin, ID.dave, ID.alice, ID.bob, ID.operator, ID.admin, ID.carol, ID.frank,
      ]);
    });

    it("sorts by last sign-in with accounts that never signed in last", async () => {
      const desc = await ids({ sort: "lastSignInAt", order: "desc" });
      expect(desc.slice(0, 2)).toEqual([ID.bob, ID.alice]);
      const asc = await ids({ sort: "lastSignInAt", order: "asc" });
      expect(asc.slice(0, 2)).toEqual([ID.alice, ID.bob]);
      expect(sorted(desc.slice(2))).toEqual(sorted([ID.carol, ID.dave, ID.erin, ID.frank, ID.admin, ID.operator]));
    });

    it("sorts by creation date, newest first by default", async () => {
      expect(await ids()).toEqual([
        ID.frank, ID.admin, ID.operator, ID.dave, ID.bob, ID.alice, ID.carol, ID.erin,
      ]);
      expect(await ids({ sort: "createdAt", order: "asc" })).toEqual([
        ID.erin, ID.carol, ID.alice, ID.bob, ID.dave, ID.operator, ID.admin, ID.frank,
      ]);
    });

    it("pages with an accurate total", async () => {
      const first = await scoped({ pageSize: 3, page: 1, sort: "createdAt", order: "asc" });
      const second = await scoped({ pageSize: 3, page: 2, sort: "createdAt", order: "asc" });
      const third = await scoped({ pageSize: 3, page: 3, sort: "createdAt", order: "asc" });
      const beyond = await scoped({ pageSize: 3, page: 4, sort: "createdAt", order: "asc" });
      expect([first.total, second.total, third.total, beyond.total]).toEqual([8, 8, 8, 8]);
      expect([first.items.length, second.items.length, third.items.length, beyond.items.length]).toEqual([3, 3, 2, 0]);
      expect([...first.items, ...second.items, ...third.items].map((r) => r.id)).toEqual([
        ID.erin, ID.carol, ID.alice, ID.bob, ID.dave, ID.operator, ID.admin, ID.frank,
      ]);
      expect(first).toMatchObject({ page: 1, pageSize: 3 });
    });

    it("defaults to page 1 of 25", async () => {
      const page = await service.list({ q: RUN_TAG } as any);
      expect(page).toMatchObject({ page: 1, pageSize: 25, total: 8 });
    });
  });

  describe("rows", () => {
    it("builds each row with counts for the whole page, purchases grouped by buyer address", async () => {
      const spy = jest.spyOn(prisma.stemPurchase, "groupBy");
      const pledgeSpy = jest.spyOn(prisma.showPledge, "groupBy");
      let page;
      try {
        page = await scoped();
        expect(spy).toHaveBeenCalledTimes(1);
        expect(pledgeSpy).toHaveBeenCalledTimes(1);
      } finally {
        spy.mockRestore();
        pledgeSpy.mockRestore();
      }
      const byId = new Map(page.items.map((row) => [row.id, row]));
      // 2 lowercase + 1 owner address + 1 checksummed form of the wallet
      expect(byId.get(ID.alice)!.counts).toEqual({ purchases: 4, pledges: 2, releases: 0 });
      expect(byId.get(ID.bob)!.counts).toEqual({ purchases: 1, pledges: 0, releases: 2 });
      expect(byId.get(ID.carol)!.counts).toEqual({ purchases: 0, pledges: 0, releases: 0 });
    });

    it("shows wallet, roles, artist name, status and activity to the day only", async () => {
      const page = await scoped();
      const byId = new Map(page.items.map((row) => [row.id, row]));
      const alice = byId.get(ID.alice)!;
      expect(alice).toMatchObject({
        walletAddress: WALLET.alice,
        roles: ["agent"],
        artistName: null,
        accountStatus: "active",
      });
      expect(alice.lastActiveDay).toBe(ago(2 * DAY).toISOString().slice(0, 10));
      expect(alice.lastActiveDay).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(alice.lastSignInAt).toEqual(expect.any(String));
      expect(byId.get(ID.bob)).toMatchObject({ roles: ["artist"], artistName: `${TEST_PREFIX}Bobby Beats` });
      expect(byId.get(ID.admin)!.roles).toEqual(["admin"]);
      expect(byId.get(ID.operator)!.roles).toEqual(["operator"]);
      expect(byId.get(ID.carol)).toMatchObject({ accountStatus: "suspended", lastActiveDay: null, lastSignInAt: null });
      // An expired suspension is reported as active.
      expect(byId.get(ID.dave)!.accountStatus).toBe("active");
      expect(byId.get(ID.erin)!.accountStatus).toBe("closed");
    });

    it("never returns an email address", async () => {
      expect(JSON.stringify(await scoped())).not.toMatch(/@test\.resonate|@wallet\.resonate|email/i);
    });
  });

  describe("detail", () => {
    const auditCount = (target: string) =>
      prisma.adminAuditEvent.count({ where: { targetUserId: target, action: "user.detail_viewed" } });

    it("writes exactly one audit event per view and returns the admin actions", async () => {
      expect(await auditCount(ID.carol)).toBe(0);
      const first = await service.detail(ID.admin, ID.carol);
      expect(await auditCount(ID.carol)).toBe(1);
      await service.detail(ID.operator, ID.carol);
      expect(await auditCount(ID.carol)).toBe(2);

      const events = await prisma.adminAuditEvent.findMany({
        where: { targetUserId: ID.carol, action: "user.detail_viewed" },
        orderBy: { createdAt: "asc" },
      });
      expect(events.map((e) => e.actorUserId)).toEqual([ID.admin, ID.operator]);

      expect(first.adminActions.map((a) => a.action)).toEqual(
        expect.arrayContaining(["account.suspended", "user.detail_viewed"]),
      );
      const suspended = first.adminActions.find((a) => a.action === "account.suspended")!;
      expect(suspended).toMatchObject({ actorUserId: ID.actor, detail: { reason: "abuse" } });
      // Newest first.
      const times = first.adminActions.map((a) => new Date(a.createdAt).getTime());
      expect([...times].sort((a, b) => b - a)).toEqual(times);
    });

    it("returns identity, status, counts and recent activity", async () => {
      const alice = await service.detail(ID.admin, ID.alice);
      expect(alice).toMatchObject({
        id: ID.alice,
        walletAddress: WALLET.alice,
        wallet: { address: WALLET.alice, ownerAddress: ALICE_OWNER, accountType: "erc4337", chainId: 31337 },
        passkeyCount: 1,
        counts: { purchases: 4, pledges: 2, releases: 0 },
        status: { accountStatus: "active", reason: null, until: null },
      });
      expect(alice.activity.noticesReceived).toBe(1);
      expect(alice.activity.recentPurchases.map((p) => p.totalPaid)).toEqual(["400", "300", "200", "100"]);
      // Defaults of the purchase / pledge rows: ETH (18) and USDC (6).
      expect(alice.activity.recentPurchases[0]).toMatchObject({ assetSymbol: "ETH", assetDecimals: 18 });
      expect(alice.activity.recentPledges[0]).toMatchObject({ assetSymbol: "USDC", assetDecimals: 6 });
      expect(alice.status.scheduledErasureAt).toBeNull();
      expect(alice.activity.recentPledges.map((p) => p.amountUnits)).toEqual(["1000000", "2000000"]);
      expect(alice.activity.recentPledges[0]).toMatchObject({ campaignId: CAMPAIGN_ID, status: "intent_created" });
      expect(alice.activity.recentReleases).toEqual([]);

      const bob = await service.detail(ID.admin, ID.bob);
      expect(bob.activity.recentReleases.map((r) => r.title)).toEqual([`${TEST_PREFIX}release1`, `${TEST_PREFIX}release2`]);
      expect(bob.activity.recentReleases[0]).toMatchObject({ status: "published" });
    });

    it("reports a restriction's reason and change date, and an expired suspension as active", async () => {
      const carol = await service.detail(ID.admin, ID.carol);
      expect(carol.status).toMatchObject({ accountStatus: "suspended", reason: "abuse", until: null });
      expect(carol.status.changedAt).toEqual(expect.any(String));
      const dave = await service.detail(ID.admin, ID.dave);
      expect(dave.status).toMatchObject({ accountStatus: "active", reason: null, until: null });
    });

    it("reports a pending erasure's due date, and nothing once it is cancelled", async () => {
      const dueAt = new Date(Date.now() + 20 * DAY);
      const request = await prisma.accountClosureRequest.create({
        data: { userId: ID.erin, reason: "operator closure: fraud", dueAt },
      });
      try {
        const erin = await service.detail(ID.admin, ID.erin);
        expect(erin.status).toMatchObject({ accountStatus: "closed", scheduledErasureAt: dueAt.toISOString() });
        await prisma.accountClosureRequest.update({
          where: { id: request.id },
          data: { status: "cancelled", cancelledAt: new Date() },
        });
        expect((await service.detail(ID.admin, ID.erin)).status.scheduledErasureAt).toBeNull();
      } finally {
        await prisma.accountClosureRequest.delete({ where: { id: request.id } });
      }
    });

    it("returns no email, balances or session keys", async () => {
      const text = JSON.stringify(await service.detail(ID.admin, ID.alice));
      expect(text).not.toMatch(/@test\.resonate|email|balanceUsd|spentUsd|monthlyCapUsd|salt|agentPrivateKey/i);
    });

    it("is a 404 and writes nothing for an unknown or an erased account", async () => {
      const before = await prisma.adminAuditEvent.count({ where: { actorUserId: ID.admin } });
      await expect(service.detail(ID.admin, `${TEST_PREFIX}nobody`)).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.detail(ID.admin, ID.erased)).rejects.toBeInstanceOf(NotFoundException);
      expect(await prisma.adminAuditEvent.count({ where: { actorUserId: ID.admin } })).toBe(before);
    });
  });
  describe("possible duplicates (#2180)", () => {
    const LOWER = `${TEST_PREFIX}dupe`;
    const MIXED = `${TEST_PREFIX}Dupe`;

    beforeAll(async () => {
      await prisma.user.createMany({
        data: [
          { id: LOWER, email: `${LOWER}@test.resonate` },
          { id: MIXED, email: `${MIXED}@test.resonate` },
        ],
      });
    });

    afterAll(async () => {
      await prisma.adminAuditEvent.deleteMany({ where: { targetUserId: { in: [LOWER, MIXED] } } });
      await prisma.user.deleteMany({ where: { id: { in: [LOWER, MIXED] } } });
    });

    it("flags both case variants, and no other account", async () => {
      const lower = (await service.list({ q: LOWER, pageSize: 100 } as any)).items;
      const mixed = (await service.list({ q: MIXED, pageSize: 100 } as any)).items;
      expect(lower.map((row) => [row.id, row.possibleDuplicate])).toEqual([[LOWER, true]]);
      expect(mixed.map((row) => [row.id, row.possibleDuplicate])).toEqual([[MIXED, true]]);
      const page = await scoped();
      expect(page.items.length).toBeGreaterThan(0);
      expect(page.items.every((row) => row.possibleDuplicate === false)).toBe(true);
    });

    it("computes the flag for the whole page in one query", async () => {
      const spy = jest.spyOn(prisma, "$queryRaw");
      try {
        await scoped();
        expect(spy).toHaveBeenCalledTimes(1);
      } finally {
        spy.mockRestore();
      }
    });

    it("is on the detail record too", async () => {
      expect((await service.detail(ID.admin, MIXED)).possibleDuplicate).toBe(true);
      expect((await service.detail(ID.admin, ID.alice)).possibleDuplicate).toBe(false);
    });
  });
});
