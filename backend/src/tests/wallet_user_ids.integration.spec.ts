/**
 * Wallet-account user ids — Integration Test (Testcontainers), #2180
 *
 * Wallet-account `User.id`s are lowercase addresses. Every path that creates or
 * looks up a user from an address-derived id must normalise it, so one account
 * is never stored twice under two casings. Also covers the wallet read
 * contract: a caller reads its own wallet (by user id or wallet address), an
 * admin may read any existing wallet, and a read never creates a user for an
 * id that is not the caller's own.
 *
 * Real Postgres and the real WalletService behind the real controller.
 *
 * Run: npm run test:integration -- wallet_user_ids
 */

import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { prisma } from '../db/prisma';
import { AuthService } from '../modules/auth/auth.service';
import { WalletController } from '../modules/identity/wallet.controller';
import { WalletService } from '../modules/identity/wallet.service';
import { SessionKeyService } from '../modules/identity/session_key.service';
import { SocialRecoveryService } from '../modules/identity/social_recovery.service';
import { WalletProviderRegistry } from '../modules/identity/wallet_provider_registry';
import { Erc4337WalletProvider } from '../modules/identity/wallet_providers/erc4337_wallet_provider';
import { LocalWalletProvider } from '../modules/identity/wallet_providers/local_wallet_provider';
import { PaymasterService } from '../modules/identity/paymaster.service';
import { normalizeUserId } from '../modules/identity/user_id';
import { AgentWalletService } from '../modules/agents/agent_wallet.service';
import { AgentPurchaseService } from '../modules/agents/agent_purchase.service';
import { EventBus } from '../modules/shared/event_bus';
import { authToken, createControllerTestApp } from './e2e-helpers';

const BASE = BigInt(Date.now()) * 1000n;
// Hex digits a-f make the checksummed/lowercase forms differ.
const address = (offset: bigint) =>
  `0x${(BASE + offset).toString(16).padStart(40, 'a').slice(-40)}`;
// An upper-cased hex body is a valid mixed-case spelling of the same address.
const mixedCase = (value: string) => `0x${value.slice(2).toUpperCase()}`;

const SELF = address(1n);
const OTHER = address(2n);
const ADMIN = address(3n);
const UNKNOWN = address(4n);
const PATHS = address(5n);
const SIGN_IN = address(6n);
const SMART_ACCOUNT = address(7n);
const NON_ADDRESS_ID = `wui_${Date.now()}_plain`;

const ALL_IDS = [SELF, OTHER, ADMIN, UNKNOWN, PATHS, SIGN_IN, NON_ADDRESS_ID];

describe('Wallet user ids (integration, #2180)', () => {
  let app: INestApplication;
  let walletService: WalletService;
  let paymaster: PaymasterService;

  const userCount = (ids: string[]) =>
    prisma.user.count({ where: { id: { in: ids.flatMap((id) => [id, mixedCase(id)]) } } });

  beforeAll(async () => {
    paymaster = new PaymasterService();
    paymaster.configure({ sponsorMaxUsd: 10, paymasterAddress: '0x000000000000000000000000000000000000dEaD' });
    walletService = new WalletService(
      new EventBus(),
      new WalletProviderRegistry(new LocalWalletProvider(), new Erc4337WalletProvider()),
      {} as any,
      paymaster,
      {} as any,
    );
    app = await createControllerTestApp(WalletController, [
      { provide: WalletService, useValue: walletService },
      { provide: SessionKeyService, useValue: {} },
      { provide: SocialRecoveryService, useValue: {} },
      { provide: AgentWalletService, useValue: {} },
      { provide: AgentPurchaseService, useValue: {} },
    ]);
  });

  afterAll(async () => {
    await app.close();
    await prisma.wallet.deleteMany({ where: { userId: { in: ALL_IDS } } }).catch(() => {});
    await prisma.passkeyIdentity.deleteMany({ where: { userId: { in: ALL_IDS } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { in: ALL_IDS } } }).catch(() => {});
  });

  describe('normalizeUserId', () => {
    it('lowercases address-shaped ids only', () => {
      expect(normalizeUserId(mixedCase(SELF))).toBe(SELF);
      expect(normalizeUserId(SELF)).toBe(SELF);
      expect(normalizeUserId('Some-User-1')).toBe('Some-User-1');
      expect(normalizeUserId('0xABC')).toBe('0xABC');
    });
  });

  describe('every user-creating path stores one user per address', () => {
    it('WalletService: all public methods agree on one lowercase user', async () => {
      const upper = mixedCase(PATHS);

      await walletService.getWallet(upper);
      await walletService.fundWallet({ userId: upper, amountUsd: 5 });
      await walletService.setBudget({ userId: upper, monthlyCapUsd: 10 });
      await walletService.spend(upper, 1);
      await walletService.refreshWallet({ userId: upper });
      await walletService.getWallet(PATHS);

      expect(await userCount([PATHS])).toBe(1);
      const stored = await prisma.user.findMany({
        where: { id: { in: [PATHS, upper] } },
        select: { id: true },
      });
      expect(stored).toEqual([{ id: PATHS }]);
      expect(await prisma.wallet.count({ where: { userId: { in: [PATHS, upper] } } })).toBe(1);
      const wallet = await walletService.getWallet(upper);
      expect(wallet.balanceUsd).toBe(4);
    });

    it('wallet creation order does not matter (lowercase first, mixed case second)', async () => {
      const first = await walletService.getWallet(OTHER);
      const second = await walletService.getWallet(mixedCase(OTHER));
      expect(second.id).toBe(first.id);
      expect(await userCount([OTHER])).toBe(1);
    });

    it('AuthService sign-in identity: a checksummed address reuses the lowercase user', async () => {
      const auth = new AuthService({ sign: jest.fn().mockReturnValue('t') } as any, { log: jest.fn() } as any);
      await walletService.getWallet(SIGN_IN);

      const wallet = await auth.upsertWalletIdentity({
        userId: mixedCase(SIGN_IN),
        walletAddress: mixedCase(SMART_ACCOUNT),
      });

      expect(wallet.userId).toBe(SIGN_IN);
      expect(await userCount([SIGN_IN])).toBe(1);
    });

    it('AuthService.issueToken signs the canonical id', () => {
      const sign = jest.fn().mockReturnValue('t');
      const auth = new AuthService({ sign } as any, { log: jest.fn() } as any);
      auth.issueToken(mixedCase(SELF), 'listener');
      expect(sign).toHaveBeenCalledWith(expect.objectContaining({ sub: SELF }));
    });

    it('a non-address id is stored exactly as given', async () => {
      await walletService.getWallet(NON_ADDRESS_ID);
      expect(await prisma.user.findUnique({ where: { id: NON_ADDRESS_ID } })).not.toBeNull();
    });

    it('paymaster sponsorship accounting is keyed by the canonical id', () => {
      paymaster.buildPaymasterData({} as any, 3, mixedCase(SELF));
      expect(walletService.getPaymasterStatus(SELF).spentUsd).toBe(3);
      expect(walletService.getPaymasterStatus(mixedCase(SELF)).spentUsd).toBe(3);
      walletService.resetPaymaster(mixedCase(SELF));
      expect(walletService.getPaymasterStatus(SELF).spentUsd).toBe(0);
    });
  });

  describe('GET /wallet/:userId', () => {
    const get = (path: string, token: string) =>
      request(app.getHttpServer()).get(`/wallet/${path}`).set('Authorization', `Bearer ${token}`);

    it('returns the caller\'s own wallet (200) and creates it when missing', async () => {
      const res = await get(SELF, authToken(SELF)).expect(200);
      expect(res.body.userId).toBe(SELF);
      expect(await userCount([SELF])).toBe(1);
    });

    it('a checksummed spelling of the caller\'s own address returns the same user (200)', async () => {
      const before = await prisma.wallet.findFirstOrThrow({ where: { userId: SELF } });
      const res = await get(mixedCase(SELF), authToken(SELF)).expect(200);
      expect(res.body.id).toBe(before.id);
      expect(await userCount([SELF])).toBe(1);
    });

    it('a checksummed JWT subject resolves to the same lowercase user (200)', async () => {
      const res = await get(SELF, authToken(mixedCase(SELF))).expect(200);
      expect(res.body.userId).toBe(SELF);
      expect(await userCount([SELF])).toBe(1);
    });

    it('allows the wallet address recorded on the caller\'s own wallet', async () => {
      await prisma.wallet.update({ where: { userId: SELF }, data: { address: SMART_ACCOUNT } });
      const res = await get(mixedCase(SMART_ACCOUNT), authToken(SELF)).expect(200);
      expect(res.body.userId).toBe(SELF);
      expect(await userCount([SMART_ACCOUNT])).toBe(0);
    });

    it('another user\'s id → 403, and nothing is created', async () => {
      await get(OTHER, authToken(SELF)).expect(403);
      await get(UNKNOWN, authToken(SELF)).expect(403);
      expect(await userCount([UNKNOWN])).toBe(0);
      expect(await prisma.wallet.count({ where: { userId: UNKNOWN } })).toBe(0);
    });

    it('an admin reads any existing wallet (200)', async () => {
      const res = await get(OTHER, authToken(ADMIN, 'admin')).expect(200);
      expect(res.body.userId).toBe(OTHER);
      const mixed = await get(mixedCase(OTHER), authToken(ADMIN, 'admin')).expect(200);
      expect(mixed.body.id).toBe(res.body.id);
    });

    it('an admin reading an unknown id → 404, and nothing is created', async () => {
      await get(UNKNOWN, authToken(ADMIN, 'admin')).expect(404);
      await get(mixedCase(UNKNOWN), authToken(ADMIN, 'admin')).expect(404);
      expect(await userCount([UNKNOWN])).toBe(0);
      expect(await prisma.wallet.count({ where: { userId: UNKNOWN } })).toBe(0);
    });
  });

  describe('wallet writes that name a user', () => {
    const post = (path: string, token: string, body: object) =>
      request(app.getHttpServer()).post(`/wallet/${path}`).set('Authorization', `Bearer ${token}`).send(body);

    it('refuses a non-admin naming another user, and creates nothing', async () => {
      await post('fund', authToken(SELF), { userId: UNKNOWN, amountUsd: 1 }).expect(403);
      await post('budget', authToken(SELF), { userId: UNKNOWN, monthlyCapUsd: 1 }).expect(403);
      expect(await userCount([UNKNOWN])).toBe(0);
    });

    it('allows the caller\'s own wallet in any spelling of its address', async () => {
      await post('fund', authToken(SELF), { userId: mixedCase(SELF), amountUsd: 2 }).expect(201);
      expect(await userCount([SELF])).toBe(1);
    });

    it('allows an admin to name any user', async () => {
      await post('fund', authToken(ADMIN, 'admin'), { userId: mixedCase(OTHER), amountUsd: 2 }).expect(201);
      expect(await userCount([OTHER])).toBe(1);
    });
  });
});
