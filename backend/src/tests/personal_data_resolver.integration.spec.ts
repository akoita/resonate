import { NotFoundException } from "@nestjs/common";
import { prisma } from "../db/prisma";
import { pseudonymousAnalyticsActorId } from "../modules/analytics/analytics_identity";
import {
  PersonalDataResolverService,
  describeResolvedIdentifiers,
} from "../modules/identity/personal_data_resolver.service";

const TEST_PREFIX = `personal_data_resolver_${Date.now()}_`;

const FULL_USER_ID = `${TEST_PREFIX}user_full`;
const BARE_USER_ID = `${TEST_PREFIX}user_bare`;
const MIXED_CASE_USER_ID = `${TEST_PREFIX}user_mixed`;
const OTHER_USER_ID = `${TEST_PREFIX}user_other`;

const FULL_WALLET_ADDRESS = "0xAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAa0001";
const FULL_OWNER_ADDRESS = "0xBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBb0001";
const FULL_FAUCET_ADDRESS = "0xCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCc0001";
const MIXED_ADDRESS_CHECKSUMMED = "0xDdDdDdDdDdDdDdDdDdDdDdDdDdDdDdDdDdDd0002";
const MIXED_ADDRESS_LOWERCASE = MIXED_ADDRESS_CHECKSUMMED.toLowerCase();
const MIXED_OWNER_ADDRESS = "0xEeEeEeEeEeEeEeEeEeEeEeEeEeEeEeEeEeEe0002";
const OTHER_WALLET_ADDRESS = "0xFfFfFfFfFfFfFfFfFfFfFfFfFfFfFfFfFfFf0003";
const OTHER_OWNER_ADDRESS = "0x1111111111111111111111111111111111110003";
const OTHER_FAUCET_ADDRESS = "0x2222222222222222222222222222222222220003";

const resolver = new PersonalDataResolverService();

async function createUser(id: string) {
  await prisma.user.create({
    data: { id, email: `${id}@test.resonate` },
  });
}

describe("PersonalDataResolverService integration", () => {
  beforeAll(async () => {
    await createUser(FULL_USER_ID);
    await createUser(BARE_USER_ID);
    await createUser(MIXED_CASE_USER_ID);
    await createUser(OTHER_USER_ID);

    // Full user: wallet + owner address + artist + two sessions + faucet attempt.
    await prisma.wallet.create({
      data: {
        id: `${TEST_PREFIX}wallet_full`,
        userId: FULL_USER_ID,
        address: FULL_WALLET_ADDRESS,
        ownerAddress: FULL_OWNER_ADDRESS,
        chainId: 11155111,
      },
    });
    await prisma.artist.create({
      data: {
        id: `${TEST_PREFIX}artist_full`,
        userId: FULL_USER_ID,
        displayName: `${TEST_PREFIX}Full Artist`,
      },
    });
    await prisma.session.createMany({
      data: [
        { id: `${TEST_PREFIX}session_full_a`, userId: FULL_USER_ID, budgetCapUsd: 5 },
        { id: `${TEST_PREFIX}session_full_b`, userId: FULL_USER_ID, budgetCapUsd: 7 },
      ],
    });
    await prisma.signupFaucetAttempt.create({
      data: {
        id: `${TEST_PREFIX}faucet_full`,
        userId: FULL_USER_ID,
        walletAddress: FULL_FAUCET_ADDRESS,
        chainId: 11155111,
        amountWei: "1000",
        status: "sent",
      },
    });

    // Mixed-case user: the same address stored checksummed on the wallet and
    // lowercase on the faucet attempt, plus a checksummed owner address.
    await prisma.wallet.create({
      data: {
        id: `${TEST_PREFIX}wallet_mixed`,
        userId: MIXED_CASE_USER_ID,
        address: MIXED_ADDRESS_CHECKSUMMED,
        ownerAddress: MIXED_OWNER_ADDRESS,
        chainId: 11155111,
      },
    });
    await prisma.signupFaucetAttempt.create({
      data: {
        id: `${TEST_PREFIX}faucet_mixed`,
        userId: MIXED_CASE_USER_ID,
        walletAddress: MIXED_ADDRESS_LOWERCASE,
        chainId: 11155111,
        amountWei: "1000",
        status: "sent",
      },
    });

    // Other user: a full set of records that must never leak into another
    // person's resolution.
    await prisma.wallet.create({
      data: {
        id: `${TEST_PREFIX}wallet_other`,
        userId: OTHER_USER_ID,
        address: OTHER_WALLET_ADDRESS,
        ownerAddress: OTHER_OWNER_ADDRESS,
        chainId: 11155111,
      },
    });
    await prisma.artist.create({
      data: {
        id: `${TEST_PREFIX}artist_other`,
        userId: OTHER_USER_ID,
        displayName: `${TEST_PREFIX}Other Artist`,
      },
    });
    await prisma.session.create({
      data: { id: `${TEST_PREFIX}session_other`, userId: OTHER_USER_ID, budgetCapUsd: 3 },
    });
    await prisma.signupFaucetAttempt.create({
      data: {
        id: `${TEST_PREFIX}faucet_other`,
        userId: OTHER_USER_ID,
        walletAddress: OTHER_FAUCET_ADDRESS,
        chainId: 11155111,
        amountWei: "1000",
        status: "sent",
      },
    });
  });

  afterAll(async () => {
    // Reverse FK order: leaf rows first, users last.
    await prisma.signupFaucetAttempt.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.session.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.artist.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.wallet.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.user.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.$disconnect();
  });

  it("resolves every identifier kind for a fully populated user", async () => {
    const resolved = await resolver.resolve(FULL_USER_ID);

    expect(resolved.userId).toBe(FULL_USER_ID);
    expect(resolved.actorId).toBeTruthy();
    expect(resolved.walletAddresses.sort()).toEqual(
      [FULL_WALLET_ADDRESS.toLowerCase(), FULL_FAUCET_ADDRESS.toLowerCase()].sort(),
    );
    expect(resolved.ownerAddresses).toEqual([FULL_OWNER_ADDRESS.toLowerCase()]);
    expect(resolved.artistIds).toEqual([`${TEST_PREFIX}artist_full`]);
    expect(resolved.sessionIds.sort()).toEqual(
      [`${TEST_PREFIX}session_full_a`, `${TEST_PREFIX}session_full_b`].sort(),
    );
  });

  it("resolves a user with no optional records to empty arrays without throwing", async () => {
    const resolved = await resolver.resolve(BARE_USER_ID);

    expect(resolved).toEqual({
      userId: BARE_USER_ID,
      actorId: pseudonymousAnalyticsActorId(BARE_USER_ID),
      walletAddresses: [],
      ownerAddresses: [],
      artistIds: [],
      sessionIds: [],
    });
  });

  it("lowercases and de-duplicates addresses stored in mixed case", async () => {
    const resolved = await resolver.resolve(MIXED_CASE_USER_ID);

    // The wallet holds the checksummed form and the faucet attempt the
    // lowercase form of the same address: one entry, not two.
    expect(resolved.walletAddresses).toEqual([MIXED_ADDRESS_LOWERCASE]);
    expect(resolved.ownerAddresses).toEqual([MIXED_OWNER_ADDRESS.toLowerCase()]);
    for (const address of [...resolved.walletAddresses, ...resolved.ownerAddresses]) {
      expect(address).toBe(address.toLowerCase());
    }
  });

  it("throws NotFoundException for an unknown userId", async () => {
    await expect(resolver.resolve(`${TEST_PREFIX}does_not_exist`)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("derives actorId with pseudonymousAnalyticsActorId, not a second implementation", async () => {
    const resolved = await resolver.resolve(FULL_USER_ID);

    expect(resolved.actorId).toBe(pseudonymousAnalyticsActorId(FULL_USER_ID));
    expect(resolved.actorId).not.toBe(pseudonymousAnalyticsActorId(OTHER_USER_ID));
  });

  it("never includes another user's identifiers", async () => {
    const [full, other] = await Promise.all([
      resolver.resolve(FULL_USER_ID),
      resolver.resolve(OTHER_USER_ID),
    ]);

    const otherIdentifiers = [
      OTHER_WALLET_ADDRESS.toLowerCase(),
      OTHER_OWNER_ADDRESS.toLowerCase(),
      OTHER_FAUCET_ADDRESS.toLowerCase(),
      `${TEST_PREFIX}artist_other`,
      `${TEST_PREFIX}session_other`,
      other.actorId as string,
    ];
    const fullIdentifiers = [
      full.actorId as string,
      ...full.walletAddresses,
      ...full.ownerAddresses,
      ...full.artistIds,
      ...full.sessionIds,
    ];

    for (const identifier of otherIdentifiers) {
      expect(fullIdentifiers).not.toContain(identifier);
    }

    // And the other user resolves to exactly their own records.
    expect(other.walletAddresses.sort()).toEqual(
      [OTHER_WALLET_ADDRESS.toLowerCase(), OTHER_FAUCET_ADDRESS.toLowerCase()].sort(),
    );
    expect(other.ownerAddresses).toEqual([OTHER_OWNER_ADDRESS.toLowerCase()]);
    expect(other.artistIds).toEqual([`${TEST_PREFIX}artist_other`]);
    expect(other.sessionIds).toEqual([`${TEST_PREFIX}session_other`]);
  });

  it("describes a resolution as counts, never as raw identifier values", async () => {
    const resolved = await resolver.resolve(FULL_USER_ID);
    const described = describeResolvedIdentifiers(resolved);

    expect(described).toEqual({
      userId: FULL_USER_ID,
      hasActorId: true,
      walletAddressCount: 2,
      ownerAddressCount: 1,
      artistIdCount: 1,
      sessionIdCount: 2,
    });
    const serialized = JSON.stringify(described).toLowerCase();
    expect(serialized).not.toContain(FULL_WALLET_ADDRESS.toLowerCase());
    expect(serialized).not.toContain(FULL_OWNER_ADDRESS.toLowerCase());
    expect(serialized).not.toContain(FULL_FAUCET_ADDRESS.toLowerCase());
  });
});
