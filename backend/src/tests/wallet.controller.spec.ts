/**
 * WalletController — Unit Test
 *
 * Tests controller-specific concerns ONLY:
 *   - enableAgentWallet: default permissions when body is empty/undefined
 *   - agentPurchase: BigInt() conversions (controller-level transformation)
 *   - rotateAgentKey: default permissions fallback
 */

import { WalletController } from '../modules/identity/wallet.controller';

const mockWalletService = {
  fundWallet: jest.fn().mockResolvedValue({ ok: true }),
  setBudget: jest.fn().mockResolvedValue({ ok: true }),
  setProvider: jest.fn().mockResolvedValue({ ok: true }),
  refreshWallet: jest.fn().mockResolvedValue({ ok: true }),
  configurePaymaster: jest.fn(),
  getPaymasterStatus: jest.fn().mockReturnValue({}),
  resetPaymaster: jest.fn(),
  getWallet: jest.fn().mockResolvedValue({ balance: 100 }),
};

const mockSessionKeyService = {
  issue: jest.fn().mockReturnValue({ token: 'sk-tok' }),
  validate: jest.fn().mockReturnValue({ valid: true }),
};

const mockRecoveryService = {
  setGuardians: jest.fn().mockResolvedValue({ ok: true }),
  requestRecovery: jest.fn().mockResolvedValue({ requestId: 'r1' }),
  approveRecovery: jest.fn().mockResolvedValue({ approved: true }),
};

const mockAgentWalletService = {
  enable: jest.fn().mockResolvedValue({ agentAddress: '0xAgent' }),
  activateSessionKey: jest.fn().mockResolvedValue({ ok: true }),
  disable: jest.fn().mockResolvedValue({ ok: true }),
  getStatus: jest.fn().mockResolvedValue({ enabled: false }),
  rotateKey: jest.fn().mockResolvedValue({ newAddress: '0xNew' }),
};

const mockAgentPurchaseService = {
  getTransactions: jest.fn().mockResolvedValue([]),
  purchase: jest.fn().mockResolvedValue({ txHash: '0x123' }),
};

function makeController() {
  return new WalletController(
    mockWalletService as any,
    mockSessionKeyService as any,
    mockRecoveryService as any,
    mockAgentWalletService as any,
    mockAgentPurchaseService as any,
  );
}

const req = { user: { userId: 'user-1' } };

beforeEach(() => jest.clearAllMocks());

describe('WalletController', () => {

  // ===== enableAgentWallet — default permissions (controller logic) =====

  describe('enableAgentWallet', () => {
    it('uses default permissions when body is empty', async () => {
      const ctrl = makeController();
      await ctrl.enableAgentWallet(req, undefined);

      expect(mockAgentWalletService.enable).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({
          function: 'buy(uint256,uint256)',
          rateLimit: 10,
        }),
        24, // default hours
      );
    });

    it('uses custom permissions when provided', async () => {
      const ctrl = makeController();
      const custom = {
        target: '0xCustom',
        function: 'sell(uint256)',
        totalCapWei: '1000',
        perTxCapWei: '100',
        rateLimit: 5,
      };

      await ctrl.enableAgentWallet(req, { permissions: custom, validityHours: 48 });

      expect(mockAgentWalletService.enable).toHaveBeenCalledWith('user-1', custom, 48);
    });
  });

  // ===== agentPurchase — BigInt conversions (controller logic) =====

  describe('agentPurchase', () => {
    it('converts string fields to BigInt before calling service', async () => {
      const ctrl = makeController();
      await ctrl.agentPurchase(req, {
        sessionId: 'sess-1',
        listingId: '42',
        tokenId: '7',
        amount: '3',
        totalPriceWei: '1000000000000000000',
        priceUsd: 5.0,
      });

      expect(mockAgentPurchaseService.purchase).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          listingId: 42n,
          tokenId: 7n,
          amount: 3n,
          totalPriceWei: '1000000000000000000',
          priceUsd: 5.0,
        }),
      );
    });
  });

  // ===== rotateAgentKey — default permissions fallback =====

  describe('rotateAgentKey', () => {
    it('uses default permissions when body is empty', async () => {
      const ctrl = makeController();
      await ctrl.rotateAgentKey(req, undefined);

      expect(mockAgentWalletService.rotateKey).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ function: 'buy(uint256,uint256)' }),
        24,
      );
    });
  });
});
