import { AesEncryptionProvider } from '../modules/encryption/providers/aes_encryption_provider';
import { privateKeyToAccount } from 'viem/accounts';

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

const ownerAccount = privateKeyToAccount('0x59c6995e998f97a5a004497e5da3a7b4f9b64e1df9fc13c37fed8ed7c85f9f42');
const allowedAccount = privateKeyToAccount('0x8b3a350cf5c34c9194ca3a545d00c5ad73f9454f8a93ff3ddf496a202d5f9b55');

const metadata = JSON.stringify({
  iv: '00',
  authTag: '00',
  keyId: 'stem-1',
  ownerAddress: ownerAccount.address.toLowerCase(),
  allowedAddresses: [allowedAccount.address.toLowerCase()],
  version: 1,
});

const signedAuthSig = async (
  account: typeof ownerAccount,
  message: string,
) => ({
  address: account.address,
  sig: await account.signMessage({ message }),
  signedMessage: message,
});

describe('AesEncryptionProvider access policy', () => {
  it('allows the owner or an explicitly allowed address', async () => {
    const provider = makeProvider();
    const ownerAuthSig = await signedAuthSig(ownerAccount, 'owner request');
    const allowedAuthSig = await signedAuthSig(allowedAccount, 'allowed request');

    await expect(provider.verifyAccess({
      metadata,
      requesterAddress: ownerAccount.address,
      authSig: ownerAuthSig,
    })).resolves.toBe(true);

    await expect(provider.verifyAccess({
      metadata,
      requesterAddress: allowedAccount.address,
      authSig: allowedAuthSig,
    })).resolves.toBe(true);
  });

  it('denies owner or allowlist claims without a valid signature', async () => {
    const provider = makeProvider();

    await expect(provider.verifyAccess({
      metadata,
      requesterAddress: ownerAccount.address,
      authSig: {
        address: ownerAccount.address,
        sig: '0xpretend-valid-owner-signature',
        signedMessage: 'owner request',
      },
    })).resolves.toBe(false);
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

  it('only allows keyless non-production bypasses for previews', async () => {
    const provider = makeProvider({
      INTERNAL_SERVICE_KEY: undefined,
      NODE_ENV: 'development',
    });

    await expect(provider.verifyAccess({
      metadata,
      requesterAddress: '0x0000000000000000000000000000000000000000',
      authSig: {
        address: '0x0000000000000000000000000000000000000000',
        sig: 'preview-authorized',
        signedMessage: 'preview request',
      },
    })).resolves.toBe(true);

    await expect(provider.verifyAccess({
      metadata,
      requesterAddress: '0x3333333333333333333333333333333333333333',
      authSig: {
        address: '0x3333333333333333333333333333333333333333',
        sig: 'x402-payment-verified',
        signedMessage: 'paid download request',
      },
    })).resolves.toBe(false);
  });
});
