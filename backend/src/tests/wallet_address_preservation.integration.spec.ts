/**
 * Wallet address preservation — Integration Test (Testcontainers)
 *
 * #2023: sign-in (/auth/verify → AuthService.upsertWalletIdentity) writes the
 * real smart-account address and marks it verified. A later provider refresh
 * (POST /wallet/aa/enable, /wallet/aa/refresh, /wallet/agent/enable, admin
 * /wallet/refresh and /wallet/provider) must keep that address instead of
 * overwriting it with the erc4337 provider's derived pseudo-address, because
 * purchase flows trust Wallet.address as the buyer.
 *
 * Real Postgres, real wallet providers; only non-Prisma collaborators
 * (bundler client, paymaster, kernel account, ZeroDev session keys) are stubbed.
 *
 * Run: npm run test:integration -- wallet_address_preservation
 */

import { ConflictException } from '@nestjs/common';
import { prisma } from '../db/prisma';
import { AgentWalletService } from '../modules/agents/agent_wallet.service';
import { AuthService } from '../modules/auth/auth.service';
import { WalletService } from '../modules/identity/wallet.service';
import { WalletProviderRegistry } from '../modules/identity/wallet_provider_registry';
import { Erc4337WalletProvider } from '../modules/identity/wallet_providers/erc4337_wallet_provider';
import { LocalWalletProvider } from '../modules/identity/wallet_providers/local_wallet_provider';
import { EventBus } from '../modules/shared/event_bus';

const BASE = BigInt(Date.now()) * 1000n;
const addressFromOffset = (offset: bigint) =>
  `0x${(BASE + offset).toString(16).padStart(40, 'a').slice(-40)}`;

// Passkey/wallet accounts: User.id is the lowercased smart-account address.
const VERIFIED_USER = addressFromOffset(1n);
const SECOND_SIGN_IN_ADDRESS = addressFromOffset(2n);
const AGENT_USER = addressFromOffset(3n);
// A wallet/passkey account whose wallet row was created before any sign-in.
const NEW_ADDRESS_USER = addressFromOffset(4n);
// An account whose id is not an address (e.g. rotated by erasure): no sign-in
// ever verified its wallet, so the derived address is its only address.
const UNVERIFIED_USER = `wap_${Date.now()}_unverified`;
const UNVERIFIED_LOCAL_USER = `wap_${Date.now()}_unverified_local`;

const ALL_USERS = [VERIFIED_USER, AGENT_USER, NEW_ADDRESS_USER, UNVERIFIED_USER, UNVERIFIED_LOCAL_USER];

const mockJwt = { sign: jest.fn().mockReturnValue('mock-jwt-token') };
const mockAudit = { log: jest.fn() };

describe('Wallet address preservation (integration, #2023)', () => {
  let auth: AuthService;
  let walletService: WalletService;
  let agentWallet: AgentWalletService;
  const erc4337Provider = new Erc4337WalletProvider();
  const localProvider = new LocalWalletProvider();

  beforeAll(() => {
    auth = new AuthService(mockJwt as any, mockAudit as any);
    const eventBus = new EventBus();
    walletService = new WalletService(
      eventBus,
      new WalletProviderRegistry(localProvider, erc4337Provider),
      {
        sendUserOperation: async () => '0xhash',
        waitForReceipt: async () => ({}),
      } as any,
      { configure: () => {}, getStatus: () => ({}), resetUser: () => {} } as any,
      {} as any,
    );
    agentWallet = new AgentWalletService(
      walletService,
      {
        createPendingSession: async () => ({ agentAddress: addressFromOffset(99n) }),
        validateSessionKey: async () => null,
      } as any,
      eventBus,
    );
  });

  afterAll(async () => {
    await prisma.passkeyIdentity.deleteMany({ where: { userId: { in: ALL_USERS } } }).catch(() => {});
    await prisma.wallet.deleteMany({ where: { userId: { in: ALL_USERS } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { in: ALL_USERS } } }).catch(() => {});
  });

  const loadWallet = (userId: string) => prisma.wallet.findUniqueOrThrow({ where: { userId } });

  describe('a wallet whose address was written by sign-in', () => {
    let signedIn: Awaited<ReturnType<typeof loadWallet>>;

    beforeAll(async () => {
      await auth.upsertWalletIdentity({ userId: VERIFIED_USER, walletAddress: VERIFIED_USER, chainId: 11155111 });
      signedIn = await loadWallet(VERIFIED_USER);
    });

    it('is marked verified by sign-in, and differs from the provider-derived address', () => {
      expect(signedIn.address).toBe(VERIFIED_USER);
      expect(signedIn.addressVerifiedAt).toBeInstanceOf(Date);
      expect(erc4337Provider.getAccount(VERIFIED_USER).address).not.toBe(VERIFIED_USER);
    });

    it('keeps the verified wallet unchanged on refresh without a provider (admin /wallet/refresh)', async () => {
      const returned = await walletService.refreshWallet({ userId: VERIFIED_USER });
      expect(returned.address).toBe(VERIFIED_USER);
      expect(await loadWallet(VERIFIED_USER)).toEqual(signedIn);
    });

    it('keeps the verified wallet unchanged on an erc4337 refresh (/wallet/aa/refresh)', async () => {
      const returned = await walletService.refreshWallet({ userId: VERIFIED_USER, provider: 'erc4337' });
      expect(returned.address).toBe(VERIFIED_USER);
      expect(await loadWallet(VERIFIED_USER)).toEqual(signedIn);
    });

    it('keeps the verified wallet unchanged when enabling the smart account (/wallet/aa/enable)', async () => {
      const returned = await walletService.setProvider({ userId: VERIFIED_USER, provider: 'erc4337' });
      expect(returned.address).toBe(VERIFIED_USER);
      expect(await loadWallet(VERIFIED_USER)).toEqual(signedIn);
    });

    it('refuses to switch a verified wallet to another provider and leaves it unchanged', async () => {
      const attempt = walletService.setProvider({ userId: VERIFIED_USER, provider: 'local' });
      await expect(attempt).rejects.toBeInstanceOf(ConflictException);
      await expect(
        walletService.refreshWallet({ userId: VERIFIED_USER, provider: 'local' }),
      ).rejects.toMatchObject({ response: { code: 'wallet_address_verified' } });
      expect(await loadWallet(VERIFIED_USER)).toEqual(signedIn);
    });

    it('lets a later sign-in replace the address (sign-in stays authoritative)', async () => {
      await auth.upsertWalletIdentity({
        userId: VERIFIED_USER,
        walletAddress: SECOND_SIGN_IN_ADDRESS,
        chainId: 11155111,
      });
      const resigned = await loadWallet(VERIFIED_USER);
      expect(resigned.address).toBe(SECOND_SIGN_IN_ADDRESS);
      expect(resigned.addressVerifiedAt).toBeInstanceOf(Date);

      await walletService.refreshWallet({ userId: VERIFIED_USER, provider: 'erc4337' });
      expect((await loadWallet(VERIFIED_USER)).address).toBe(SECOND_SIGN_IN_ADDRESS);
    });
  });

  it('keeps the verified address when the agent wallet is enabled (/wallet/agent/enable)', async () => {
    await auth.upsertWalletIdentity({ userId: AGENT_USER, walletAddress: AGENT_USER, chainId: 11155111 });
    const before = await loadWallet(AGENT_USER);

    const result = await agentWallet.enable(AGENT_USER, {
      target: addressFromOffset(50n),
      function: 'buy(uint256,uint256)',
      totalCapWei: '1',
      perTxCapWei: '1',
      rateLimit: 1,
    });

    expect(result.status.walletAddress).toBe(AGENT_USER);
    expect(await loadWallet(AGENT_USER)).toEqual(before);
  });

  describe('a wallet no sign-in has verified', () => {
    it('still receives the derived erc4337 address on refresh', async () => {
      await walletService.refreshWallet({ userId: UNVERIFIED_USER, provider: 'erc4337' });
      const wallet = await loadWallet(UNVERIFIED_USER);
      const derived = erc4337Provider.getAccount(UNVERIFIED_USER);
      expect(wallet.addressVerifiedAt).toBeNull();
      expect(wallet.address).toBe(derived.address);
      expect(wallet.provider).toBe('erc4337');
      expect(wallet.ownerAddress).toBe(UNVERIFIED_USER);
    });

    it('keeps an address-shaped userId as the address on an erc4337 refresh', async () => {
      // The wallet row exists before any sign-in (e.g. /wallet/aa/enable first).
      await walletService.getWallet(NEW_ADDRESS_USER);
      await walletService.refreshWallet({ userId: NEW_ADDRESS_USER, provider: 'erc4337' });
      const wallet = await loadWallet(NEW_ADDRESS_USER);
      expect(wallet.addressVerifiedAt).toBeNull();
      expect(wallet.address).toBe(NEW_ADDRESS_USER);
      expect(wallet.address).not.toBe(erc4337Provider.getAccount(NEW_ADDRESS_USER).address);
      expect(wallet.ownerAddress).toBeNull();
    });

    it('can still switch provider', async () => {
      await walletService.getWallet(UNVERIFIED_LOCAL_USER);
      await walletService.setProvider({ userId: UNVERIFIED_LOCAL_USER, provider: 'local' });
      const wallet = await loadWallet(UNVERIFIED_LOCAL_USER);
      expect(wallet.addressVerifiedAt).toBeNull();
      expect(wallet.address).toBe(localProvider.getAccount(UNVERIFIED_LOCAL_USER).address);
      expect(wallet.provider).toBe('local');
    });
  });
});
