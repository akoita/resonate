/**
 * AuthController — Unit Test
 *
 * Tests controller-specific concerns ONLY:
 *   - verify() branching logic (5 paths orchestrated in the controller)
 *   - Nonce regex extraction from message
 *   - Error wrapping → { status: "error", message }
 *   - login() role defaulting
 *   - nonce() response shaping
 *
 * Service logic (token issuance, role resolution) is NOT tested here.
 */

import { AuthController } from '../modules/auth/auth.controller';

// Mock viem's recoverMessageAddress — called in the EOA fallback path
jest.mock('viem', () => ({
  ...jest.requireActual('viem'),
  recoverMessageAddress: jest.fn().mockRejectedValue(new Error('mock: no recovery')),
}));

// ---------- Mocks ----------

const mockAuthService = {
  issueToken: jest.fn().mockReturnValue({ accessToken: 'tok' }),
  issueTokenForAddress: jest.fn().mockReturnValue({ accessToken: 'tok-addr' }),
};

const mockNonceService = {
  issue: jest.fn().mockReturnValue('nonce-123'),
  consume: jest.fn().mockReturnValue(true),
};

const mockPublicClient = {
  getChainId: jest.fn(),
  verifyMessage: jest.fn(),
  getCode: jest.fn(),
};

function makeController() {
  return new AuthController(
    mockAuthService as any,
    mockNonceService as any,
    mockPublicClient as any,
  );
}

const body = (overrides: Record<string, any> = {}) => ({
  address: '0xSmartAccount',
  message: 'Sign in to Resonate\nNonce: nonce-123',
  signature: '0xsig' as `0x${string}`,
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  // Re-apply defaults (clearAllMocks strips mockReturnValue)
  mockAuthService.issueToken.mockReturnValue({ accessToken: 'tok' });
  mockAuthService.issueTokenForAddress.mockReturnValue({ accessToken: 'tok-addr' });
  mockNonceService.issue.mockReturnValue('nonce-123');
  mockNonceService.consume.mockReturnValue(true);
});

// ====================================================================

describe('AuthController', () => {
  // ----- login() -----
  describe('login()', () => {
    it('defaults role to "listener" when omitted', () => {
      const ctrl = makeController();
      ctrl.login({ userId: 'u1' });
      expect(mockAuthService.issueToken).toHaveBeenCalledWith('u1', 'listener');
    });

    it('passes explicit role through', () => {
      const ctrl = makeController();
      ctrl.login({ userId: 'u1', role: 'artist' });
      expect(mockAuthService.issueToken).toHaveBeenCalledWith('u1', 'artist');
    });
  });

  // ----- nonce() -----
  describe('nonce()', () => {
    it('wraps nonceService.issue in { nonce } object', () => {
      const ctrl = makeController();
      const result = ctrl.nonce({ address: '0xABC' });
      expect(result).toEqual({ nonce: 'nonce-123' });
      expect(mockNonceService.issue).toHaveBeenCalledWith('0xABC');
    });
  });

  // ----- verify() — controller branching logic -----
  describe('verify()', () => {
    // Path 1: Local dev EOA signer (chainId 31337 + signerAddress)
    it('local dev EOA: verifies signer then issues token for smart account address', async () => {
      mockPublicClient.getChainId.mockResolvedValue(31337);
      mockPublicClient.verifyMessage.mockResolvedValue(true);
      const ctrl = makeController();

      const result = await ctrl.verify(body({ signerAddress: '0xEOA' }));

      // Verifies with signerAddress, not smart account address
      expect(mockPublicClient.verifyMessage).toHaveBeenCalledWith(
        expect.objectContaining({ address: '0xEOA' }),
      );
      // Issues token for the smart account address
      expect(mockAuthService.issueTokenForAddress).toHaveBeenCalledWith(
        '0xSmartAccount',
        'listener',
      );
      expect(result).toEqual({ accessToken: 'tok-addr' });
    });

    it('local dev EOA: returns invalid_signature when verifyMessage fails', async () => {
      mockPublicClient.getChainId.mockResolvedValue(31337);
      mockPublicClient.verifyMessage.mockResolvedValue(false);
      const ctrl = makeController();

      const result = await ctrl.verify(body({ signerAddress: '0xEOA' }));

      expect(result).toEqual({ status: 'invalid_signature' });
      expect(mockAuthService.issueTokenForAddress).not.toHaveBeenCalled();
    });

    it('local dev EOA: returns invalid_nonce when nonce does not match', async () => {
      mockPublicClient.getChainId.mockResolvedValue(31337);
      mockPublicClient.verifyMessage.mockResolvedValue(true);
      mockNonceService.consume.mockReturnValue(false);
      const ctrl = makeController();

      const result = await ctrl.verify(body({ signerAddress: '0xEOA' }));

      expect(result).toEqual({ status: 'invalid_nonce' });
    });

    // Path 2: Counterfactual smart account (no deployed code)
    it('counterfactual SA: skips ERC-1271, validates nonce only', async () => {
      mockPublicClient.getChainId.mockResolvedValue(1); // non-local chain
      mockPublicClient.getCode.mockResolvedValue('0x'); // no code
      const ctrl = makeController();

      const result = await ctrl.verify(body());

      // Should NOT call verifyMessage for the SA
      expect(mockPublicClient.verifyMessage).not.toHaveBeenCalled();
      expect(mockNonceService.consume).toHaveBeenCalledWith('0xSmartAccount', 'nonce-123');
      expect(mockAuthService.issueTokenForAddress).toHaveBeenCalledWith(
        '0xsmartaccount', // lowercased
        'listener',
      );
    });

    it('counterfactual SA: returns invalid_nonce on mismatch', async () => {
      mockPublicClient.getChainId.mockResolvedValue(1);
      mockPublicClient.getCode.mockResolvedValue(null);
      mockNonceService.consume.mockReturnValue(false);
      const ctrl = makeController();

      const result = await ctrl.verify(body());

      expect(result).toEqual({ status: 'invalid_nonce' });
    });

    // Path 3: Deployed SA, ERC-1271 passes
    it('deployed SA: ERC-1271 passes — issues token after nonce check', async () => {
      mockPublicClient.getChainId.mockResolvedValue(1);
      mockPublicClient.getCode.mockResolvedValue('0x6080604052'); // has code
      mockPublicClient.verifyMessage.mockResolvedValue(true);
      const ctrl = makeController();

      const result = await ctrl.verify(body());

      expect(mockNonceService.consume).toHaveBeenCalledWith('0xSmartAccount', 'nonce-123');
      expect(mockAuthService.issueTokenForAddress).toHaveBeenCalledWith(
        '0xSmartAccount',
        'listener',
      );
    });

    // Path 4: Deployed SA, all verification fails → nonce-gated passkey fallback
    it('deployed SA: all verification fails → nonce-gated passkey fallback', async () => {
      mockPublicClient.getChainId.mockResolvedValue(1);
      mockPublicClient.getCode.mockResolvedValue('0x6080604052');
      mockPublicClient.verifyMessage.mockResolvedValue(false); // ERC-1271 fails
      const ctrl = makeController();

      const result = await ctrl.verify(body());

      // Falls through to nonce-gated passkey fallback
      expect(mockNonceService.consume).toHaveBeenCalledWith('0xSmartAccount', 'nonce-123');
      expect(mockAuthService.issueTokenForAddress).toHaveBeenCalledWith(
        '0xsmartaccount', // lowercased
        'listener',
      );
    });

    // ----- Nonce regex extraction -----
    it('extracts nonce from message using regex', async () => {
      mockPublicClient.getChainId.mockResolvedValue(1);
      mockPublicClient.getCode.mockResolvedValue('0x'); // counterfactual
      const ctrl = makeController();

      await ctrl.verify(body({ message: 'Hello\nNonce: my-custom-nonce-42' }));

      expect(mockNonceService.consume).toHaveBeenCalledWith('0xSmartAccount', 'my-custom-nonce-42');
    });

    it('extracts empty string when message has no Nonce line', async () => {
      mockPublicClient.getChainId.mockResolvedValue(1);
      mockPublicClient.getCode.mockResolvedValue('0x');
      const ctrl = makeController();

      await ctrl.verify(body({ message: 'No nonce here' }));

      expect(mockNonceService.consume).toHaveBeenCalledWith('0xSmartAccount', '');
    });

    // ----- Error wrapping -----
    it('catches exceptions and returns { status: "error", message }', async () => {
      mockPublicClient.getChainId.mockRejectedValue(new Error('RPC down'));
      const ctrl = makeController();

      const result = await ctrl.verify(body());

      expect(result).toEqual({ status: 'error', message: 'RPC down' });
    });

    // ----- Role passthrough -----
    it('passes explicit role to issueTokenForAddress', async () => {
      mockPublicClient.getChainId.mockResolvedValue(1);
      mockPublicClient.getCode.mockResolvedValue('0x');
      const ctrl = makeController();

      await ctrl.verify(body({ role: 'artist' }));

      expect(mockAuthService.issueTokenForAddress).toHaveBeenCalledWith(
        expect.any(String),
        'artist',
      );
    });
  });
});
