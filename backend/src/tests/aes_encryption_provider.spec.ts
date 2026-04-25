import { AesEncryptionProvider } from '../modules/encryption/providers/aes_encryption_provider';

const makeProvider = (overrides: Record<string, string | undefined> = {}) => {
  const config = {
    get: jest.fn((key: string) => {
      const values: Record<string, string | undefined> = {
        ENCRYPTION_SECRET: 'test-encryption-secret',
        NODE_ENV: 'production',
        INTERNAL_SERVICE_KEY: 'internal-test-key',
        ...overrides,
      };
      return values[key];
    }),
  };

  return new AesEncryptionProvider(config as any);
};

const metadata = JSON.stringify({
  iv: '00',
  authTag: '00',
  keyId: 'stem-1',
  ownerAddress: '0x1111111111111111111111111111111111111111',
  allowedAddresses: ['0x2222222222222222222222222222222222222222'],
  version: 1,
});

describe('AesEncryptionProvider access policy', () => {
  it('allows the owner or an explicitly allowed address', async () => {
    const provider = makeProvider();

    await expect(provider.verifyAccess({
      metadata,
      requesterAddress: '0x1111111111111111111111111111111111111111',
      authSig: {
        address: '0x1111111111111111111111111111111111111111',
        sig: 'not-used-for-owner',
        signedMessage: 'owner request',
      },
    })).resolves.toBe(true);

    await expect(provider.verifyAccess({
      metadata,
      requesterAddress: '0x2222222222222222222222222222222222222222',
      authSig: {
        address: '0x2222222222222222222222222222222222222222',
        sig: 'not-used-for-allowed-address',
        signedMessage: 'allowed request',
      },
    })).resolves.toBe(true);
  });

  it('allows backend-verified preview and payment bypasses only with the internal key', async () => {
    const provider = makeProvider();

    await expect(provider.verifyAccess({
      metadata,
      requesterAddress: '0x0000000000000000000000000000000000000000',
      authSig: {
        address: '0x0000000000000000000000000000000000000000',
        sig: 'preview-authorized',
        signedMessage: 'preview request',
        internalKey: 'internal-test-key',
      } as any,
    })).resolves.toBe(true);

    await expect(provider.verifyAccess({
      metadata,
      requesterAddress: '0x3333333333333333333333333333333333333333',
      authSig: {
        address: '0x3333333333333333333333333333333333333333',
        sig: 'x402-payment-verified',
        signedMessage: 'paid download request',
        internalKey: 'internal-test-key',
      } as any,
    })).resolves.toBe(true);
  });

  it('denies arbitrary wallet signatures for protected full-stem decrypts', async () => {
    const provider = makeProvider();

    await expect(provider.verifyAccess({
      metadata,
      requesterAddress: '0x3333333333333333333333333333333333333333',
      authSig: {
        address: '0x3333333333333333333333333333333333333333',
        sig: '0xpretend-valid-wallet-signature',
        signedMessage: 'wallet request',
      },
    })).resolves.toBe(false);
  });

  it('denies forged internal bypasses with the wrong internal key', async () => {
    const provider = makeProvider();

    await expect(provider.verifyAccess({
      metadata,
      requesterAddress: '0x3333333333333333333333333333333333333333',
      authSig: {
        address: '0x3333333333333333333333333333333333333333',
        sig: 'ownership-verified',
        signedMessage: 'download request',
        internalKey: 'wrong-key',
      } as any,
    })).resolves.toBe(false);
  });
});
