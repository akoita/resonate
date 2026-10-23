import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AuthService } from '../modules/auth/auth.service';
import { EncryptionService } from '../modules/encryption/encryption.service';
import { X402Config } from '../modules/x402/x402.config';
import { X402Controller } from '../modules/x402/x402.controller';
import { authToken, createControllerTestApp } from './e2e-helpers';

jest.mock('../db/prisma', () => ({
  prisma: {
    x402Settlement: { findFirst: jest.fn() },
    stemPricing: { findUnique: jest.fn() },
  },
}));

const BUYER = '0x1111111111111111111111111111111111111111';
const STRANGER = '0x2222222222222222222222222222222222222222';
const TX_HASH = `0x${'a'.repeat(64)}`;
const ROUTE = '/api/stems/stem_1/x402/smart-account';

const mockAuthService = {
  isAddressForUser: jest.fn(async (userId: string, address: string) =>
    userId.toLowerCase() === address.toLowerCase(),
  ),
};

const mockConfig = {
  enabled: true,
  payoutAddress: '0x4444444444444444444444444444444444444444',
  network: 'eip155:84532',
  chainId: 84532,
  rpcUrl: 'https://sepolia.base.org',
};

describe('X402Controller smart-account download (HTTP contract)', () => {
  let app: INestApplication;
  let verifySpy: jest.SpyInstance;

  beforeAll(async () => {
    app = await createControllerTestApp(X402Controller, [
      { provide: X402Config, useValue: mockConfig },
      { provide: EncryptionService, useValue: {} },
      { provide: AuthService, useValue: mockAuthService },
    ]);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    // Stop at on-chain verification: these tests are about who may redeem.
    verifySpy = jest
      .spyOn(X402Controller.prototype as any, 'verifySmartAccountPayment')
      .mockRejectedValue(new Error('verification stubbed'));
  });

  afterEach(() => {
    verifySpy.mockRestore();
  });

  it('requires a signed-in buyer', async () => {
    await request(app.getHttpServer())
      .post(ROUTE)
      .send({ txHash: TX_HASH, payer: BUYER })
      .expect(401);

    expect(verifySpy).not.toHaveBeenCalled();
  });

  it('rejects a malformed transaction hash or payer before any work', async () => {
    await request(app.getHttpServer())
      .post(ROUTE)
      .set('Authorization', `Bearer ${authToken(BUYER)}`)
      .send({ txHash: '0x1234', payer: BUYER })
      .expect(400);
    await request(app.getHttpServer())
      .post(ROUTE)
      .set('Authorization', `Bearer ${authToken(BUYER)}`)
      .send({ txHash: TX_HASH, payer: 'not-an-address' })
      .expect(400);

    expect(verifySpy).not.toHaveBeenCalled();
  });

  it("refuses to redeem someone else's public payment", async () => {
    const response = await request(app.getHttpServer())
      .post(ROUTE)
      .set('Authorization', `Bearer ${authToken(STRANGER)}`)
      .send({ txHash: TX_HASH, payer: BUYER })
      .expect(403);

    expect(response.body.code).toBe('payer_not_linked');
    expect(verifySpy).not.toHaveBeenCalled();
  });

  it("lets the buyer redeem a payment from their own account", async () => {
    await request(app.getHttpServer())
      .post(ROUTE)
      .set('Authorization', `Bearer ${authToken(BUYER)}`)
      .send({ txHash: TX_HASH, payer: BUYER })
      .expect(402);

    expect(mockAuthService.isAddressForUser).toHaveBeenCalledWith(BUYER, BUYER);
    expect(verifySpy).toHaveBeenCalledWith('stem_1', expect.objectContaining({ payer: BUYER }));
  });
});
