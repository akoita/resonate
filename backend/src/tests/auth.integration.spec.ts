/**
 * AuthService integration tests.
 *
 * Wallet-authenticated users are keyed by their smart-account address. These
 * tests cover the redeploy recovery path: successful auth should recreate the
 * backend User/Wallet rows for the existing on-chain account.
 */

import { prisma } from '../db/prisma';
import { AuthService } from '../modules/auth/auth.service';

const BASE = BigInt(Date.now());
const addressFromOffset = (offset: bigint) =>
  `0x${(BASE + offset).toString(16).padStart(40, '0').slice(-40)}`;

const USER_ID = addressFromOffset(1n);
const WALLET_ADDRESS = addressFromOffset(2n);
const EXISTING_USER_ID = addressFromOffset(3n);
const EXISTING_FAKE_WALLET = addressFromOffset(4n);
const EXISTING_REAL_WALLET = addressFromOffset(5n);
const DRIFTED_USER_ID = addressFromOffset(6n);
const DRIFTED_WALLET = addressFromOffset(7n);
const PASSKEY_X = '1'.repeat(64);
const PASSKEY_Y = '2'.repeat(64);

const mockJwt = { sign: jest.fn().mockReturnValue('mock-jwt-token') };
const mockAudit = { log: jest.fn() };

describe('AuthService wallet identity persistence (integration)', () => {
  let service: AuthService;

  beforeAll(() => {
    service = new AuthService(mockJwt as any, mockAudit as any);
  });

  afterAll(async () => {
    await prisma.passkeyIdentity.deleteMany({
      where: { userId: { in: [USER_ID, EXISTING_USER_ID, DRIFTED_USER_ID] } },
    }).catch(() => {});
    await prisma.wallet.deleteMany({
      where: { userId: { in: [USER_ID, EXISTING_USER_ID, DRIFTED_USER_ID] } },
    }).catch(() => {});
    await prisma.user.deleteMany({
      where: { id: { in: [USER_ID, EXISTING_USER_ID, DRIFTED_USER_ID] } },
    }).catch(() => {});
  });

  it('creates User and Wallet rows for an authenticated smart account', async () => {
    await service.upsertWalletIdentity({
      userId: USER_ID.toUpperCase(),
      walletAddress: WALLET_ADDRESS.toUpperCase(),
      chainId: 11155111,
    });

    const user = await prisma.user.findUnique({ where: { id: USER_ID } });
    const wallet = await prisma.wallet.findUnique({ where: { userId: USER_ID } });

    expect(user).not.toBeNull();
    expect(wallet).toMatchObject({
      userId: USER_ID,
      address: WALLET_ADDRESS,
      chainId: 11155111,
      accountType: 'erc4337',
      provider: 'erc4337',
      ownerAddress: USER_ID,
    });
  });

  it('repairs an existing derived wallet row without resetting balances', async () => {
    await prisma.user.create({
      data: {
        id: EXISTING_USER_ID,
        email: `${EXISTING_USER_ID}@wallet.resonate`,
      },
    });
    await prisma.wallet.create({
      data: {
        userId: EXISTING_USER_ID,
        address: EXISTING_FAKE_WALLET,
        chainId: 31337,
        balanceUsd: 42,
        monthlyCapUsd: 100,
        spentUsd: 7,
        accountType: 'erc4337',
        provider: 'erc4337',
        ownerAddress: EXISTING_USER_ID,
      },
    });

    await service.upsertWalletIdentity({
      userId: EXISTING_USER_ID,
      walletAddress: EXISTING_REAL_WALLET,
      chainId: 11155111,
    });

    const wallet = await prisma.wallet.findUnique({ where: { userId: EXISTING_USER_ID } });

    expect(wallet).toMatchObject({
      address: EXISTING_REAL_WALLET,
      chainId: 11155111,
      balanceUsd: 42,
      monthlyCapUsd: 100,
      spentUsd: 7,
    });
  });

  it('keeps the original owner when the same passkey derives a different smart account', async () => {
    await service.upsertWalletIdentity({
      userId: EXISTING_USER_ID,
      walletAddress: EXISTING_REAL_WALLET,
      chainId: 11155111,
      pubKeyX: PASSKEY_X,
      pubKeyY: PASSKEY_Y,
    });

    const wallet = await service.upsertWalletIdentity({
      userId: DRIFTED_USER_ID,
      walletAddress: DRIFTED_WALLET,
      chainId: 11155111,
      pubKeyX: PASSKEY_X,
      pubKeyY: PASSKEY_Y,
    });

    const driftedUser = await prisma.user.findUnique({ where: { id: DRIFTED_USER_ID } });
    const identity = await prisma.passkeyIdentity.findFirst({
      where: { userId: EXISTING_USER_ID },
    });

    expect(wallet).toMatchObject({
      userId: EXISTING_USER_ID,
      address: DRIFTED_WALLET,
    });
    expect(driftedUser).toBeNull();
    expect(identity).toMatchObject({
      firstWalletAddress: EXISTING_REAL_WALLET,
      lastWalletAddress: DRIFTED_WALLET,
    });
  });
});
