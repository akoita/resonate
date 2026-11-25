/**
 * Shows "I would come" interest mode (#2668), against real Postgres.
 */
import { prisma } from "../db/prisma";
import { ShowsService } from "../modules/shows/shows.service";
import { ShowInterestService, summarizeInterest } from "../modules/shows/show-interest.service";

const TEST_PREFIX = `showint_${Date.now()}_`;
const artistUser = `${TEST_PREFIX}artist`;
const artistId = `${TEST_PREFIX}artistprofile`;
const fans = [1, 2, 3, 4, 5].map((n) => `${TEST_PREFIX}fan${n}`);
const stranger = `${TEST_PREFIX}stranger`;
const DAY = 24 * 60 * 60 * 1000;

describe("show interest (#2668)", () => {
  const sendTargeted = jest.fn().mockResolvedValue({ recipientCount: 0, created: 2 });
  const service = new ShowInterestService(new ShowsService(), { sendTargeted } as never);
  const artist = { userId: artistUser, role: "listener" };
  const campaignIds: string[] = [];
  const previousSwitch = process.env.SHOWS_PLEDGING_ENABLED;

  async function seedCampaign(overrides: Record<string, unknown> = {}) {
    const n = campaignIds.length + 1;
    const campaign = await prisma.showCampaign.create({
      data: {
        slug: `${TEST_PREFIX}c${n}`,
        artistId,
        artistDisplayName: "Interest Artist",
        title: `Interest Show ${n}`,
        city: "Lyon",
        country: "FR",
        deadline: new Date(Date.now() + 30 * DAY),
        goalAmountUnits: "1000000",
        chainId: 31337,
        status: "draft",
        campaignLevel: "active_escrow_campaign",
        mode: "interest",
        ...overrides,
      },
    });
    campaignIds.push(campaign.id);
    return campaign;
  }

  beforeAll(async () => {
    for (const id of [artistUser, ...fans, stranger]) {
      await prisma.user.create({ data: { id, email: `${id}@test.resonate` } });
    }
    await prisma.artist.create({ data: { id: artistId, userId: artistUser, displayName: `${TEST_PREFIX}Artist` } });
  });

  afterAll(async () => {
    if (previousSwitch === undefined) delete process.env.SHOWS_PLEDGING_ENABLED;
    else process.env.SHOWS_PLEDGING_ENABLED = previousSwitch;
    await prisma.showInterest.deleteMany({ where: { campaignId: { in: campaignIds } } });
    await prisma.showCampaign.deleteMany({ where: { id: { in: campaignIds } } });
    await prisma.artist.deleteMany({ where: { id: artistId } });
    await prisma.user.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
  });

  beforeEach(() => sendTargeted.mockClear());

  it("declares, updates and withdraws: one declaration per account", async () => {
    const campaign = await seedCampaign();
    const fan = { userId: fans[0] };
    await service.declare(fan, campaign.id, { city: "Lyon", notifyWhenOpen: true });
    await service.declare(fan, campaign.slug, { city: "  Paris  ", notifyWhenOpen: false });
    const rows = await prisma.showInterest.findMany({ where: { campaignId: campaign.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(expect.objectContaining({ userId: fans[0], city: "Paris", notifyWhenOpen: false }));

    const state = await service.getState(campaign.id, fans[0]);
    expect(state).toEqual(expect.objectContaining({ mode: "interest", open: true, mine: expect.objectContaining({ city: "Paris" }) }));
    expect((await service.getState(campaign.id, null)).mine).toBeNull();

    await expect(service.withdraw(fan, campaign.id)).resolves.toEqual({ withdrawn: true });
    await expect(service.withdraw(fan, campaign.id)).resolves.toEqual({ withdrawn: false });
    await expect(prisma.showInterest.count({ where: { campaignId: campaign.id } })).resolves.toBe(0);
  });

  it("refuses a declaration on a pledge-mode campaign or after the deadline", async () => {
    const pledge = await seedCampaign({ mode: "pledge" });
    await expect(service.declare({ userId: fans[1] }, pledge.id, {})).rejects.toMatchObject({ status: 400 });
    const past = await seedCampaign({ deadline: new Date(Date.now() - DAY) });
    await expect(service.declare({ userId: fans[1] }, past.id, {})).rejects.toMatchObject({ status: 400 });
    expect((await service.getState(past.id, null)).open).toBe(false);
  });

  it("shows counts by city to the artist only, folding small cities together", async () => {
    const campaign = await seedCampaign();
    const cities = ["Lyon", "lyon", "LYON", "Paris", null];
    for (const [i, city] of cities.entries()) {
      await service.declare({ userId: fans[i] }, campaign.id, { city: city ?? undefined, notifyWhenOpen: i < 2 });
    }
    const summary = await service.summary(artist, campaign.id);
    expect(summary.total).toBe(5);
    expect(summary.notifyCount).toBe(2);
    // The minimum group defaults to 3: Lyon shows, Paris (1) and no city (1) are folded.
    expect(summary.cities).toEqual([{ city: "Lyon", count: 3 }]);
    expect(summary.otherCount).toBe(2);

    await expect(service.summary({ userId: stranger, role: "listener" }, campaign.id)).rejects.toMatchObject({ status: 403 });
  });

  it("moves to pledge mode only when pledging is available, and tells the people who asked, once", async () => {
    const campaign = await seedCampaign();
    await service.declare({ userId: fans[0] }, campaign.id, { notifyWhenOpen: true });
    await service.declare({ userId: fans[1] }, campaign.id, { notifyWhenOpen: true });
    await service.declare({ userId: fans[2] }, campaign.id, { notifyWhenOpen: false });

    process.env.SHOWS_PLEDGING_ENABLED = "false";
    await expect(service.setMode(artist, campaign.id, "pledge")).rejects.toMatchObject({ status: 409 });
    expect((await prisma.showCampaign.findUniqueOrThrow({ where: { id: campaign.id } })).mode).toBe("interest");

    process.env.SHOWS_PLEDGING_ENABLED = "true";
    await expect(service.setMode({ userId: stranger, role: "listener" }, campaign.id, "pledge")).rejects.toMatchObject({ status: 403 });
    const moved = await service.setMode(artist, campaign.id, "pledge");
    expect(moved).toEqual({ id: campaign.id, mode: "pledge", notified: 2 });
    expect(sendTargeted).toHaveBeenCalledTimes(1);
    const [input, , options] = sendTargeted.mock.calls[0];
    expect([...input.userIds].sort()).toEqual([fans[0], fans[1]].sort());
    expect(input.link).toBe(`/shows/${campaign.slug}`);
    expect(`${input.title} ${input.body}`).not.toMatch(/\bback\b/i);
    expect(options).toEqual({ dedupeKey: `show_interest_open:${campaign.id}` });

    // Already in pledge mode: nothing more is sent.
    await service.setMode(artist, campaign.id, "pledge");
    expect(sendTargeted).toHaveBeenCalledTimes(1);
    // A pledge-mode campaign no longer takes declarations.
    await expect(service.declare({ userId: fans[3] }, campaign.id, {})).rejects.toMatchObject({ status: 400 });
  });

  it("lets only a draft with no pledges collect interest", async () => {
    const draft = await seedCampaign({ mode: "pledge" });
    await expect(service.setMode(artist, draft.id, "interest")).resolves.toEqual(expect.objectContaining({ mode: "interest" }));
    const active = await seedCampaign({ mode: "pledge", status: "active" });
    await expect(service.setMode(artist, active.id, "interest")).rejects.toMatchObject({ status: 409 });
  });

  it("refuses a pledge intent on an interest-mode campaign", async () => {
    const campaign = await seedCampaign({ status: "active" });
    await expect(
      new ShowsService().createPledgeIntent({ userId: fans[0] } as never, campaign.id, { walletAddress: "0x" + "1".repeat(40) } as never),
    ).rejects.toThrow("collecting interest");
  });
});

describe("summarizeInterest (#2668)", () => {
  it("never shows a city below the minimum group", () => {
    const summary = summarizeInterest(
      [
        { city: "Montréal", notifyWhenOpen: false },
        { city: "Montreal", notifyWhenOpen: true },
        { city: "Dakar", notifyWhenOpen: false },
      ],
      "interest",
      2,
    );
    expect(summary.cities).toEqual([{ city: "Montréal", count: 2 }]);
    expect(summary.otherCount).toBe(1);
  });
});
