/**
 * PaymentsController — HTTP contract (#1890)
 *
 *   - The prototype initiate / split-config / split / confirm routes are gone
 *     (404), so no caller can publish a fabricated `payment.settled` event.
 *   - POST /payments/dev/fund validates its body through the global
 *     ValidationPipe before the service runs.
 */

import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { PaymentsController } from '../modules/payments/payments.controller';
import { PaymentsService } from '../modules/payments/payments.service';
import { createControllerTestApp, authToken } from './e2e-helpers';

const WALLET = '0x' + 'a'.repeat(40);

const mockPaymentsService = {
  fundLocalDevWallet: jest.fn().mockResolvedValue({ status: 'funded' }),
  initiatePayment: jest.fn(),
  setSplitConfig: jest.fn(),
  splitPayment: jest.fn(),
  confirmOnChain: jest.fn(),
};

describe('PaymentsController (http)', () => {
  let app: INestApplication;
  const token = authToken('user-1');

  beforeAll(async () => {
    app = await createControllerTestApp(PaymentsController, [
      { provide: PaymentsService, useValue: mockPaymentsService },
    ]);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => jest.clearAllMocks());

  it.each([
    ['/payments/initiate', { sessionId: 's', amountUsd: 1_000_000, trackId: 't' }],
    ['/payments/split-config', { trackId: 't', artistPct: -50, mixerPct: 150 }],
    ['/payments/split', { paymentId: 'pay_1', artistPct: 100, mixerPct: 0 }],
    ['/payments/confirm', { paymentId: 'pay_1' }],
  ])('POST %s is no longer routed (404)', async (path, body) => {
    await request(app.getHttpServer())
      .post(path)
      .set('Authorization', `Bearer ${token}`)
      .send(body)
      .expect(404);

    expect(mockPaymentsService.initiatePayment).not.toHaveBeenCalled();
    expect(mockPaymentsService.setSplitConfig).not.toHaveBeenCalled();
    expect(mockPaymentsService.splitPayment).not.toHaveBeenCalled();
    expect(mockPaymentsService.confirmOnChain).not.toHaveBeenCalled();
  });

  it('POST /payments/dev/fund → 401 without JWT', async () => {
    await request(app.getHttpServer())
      .post('/payments/dev/fund')
      .send({ wallet: WALLET, assetId: 'usdc' })
      .expect(401);
  });

  it('POST /payments/dev/fund passes a valid body through unchanged', async () => {
    const body = { wallet: WALLET, assetId: 'usdc', amount: '25.5' };
    await request(app.getHttpServer())
      .post('/payments/dev/fund')
      .set('Authorization', `Bearer ${token}`)
      .send(body)
      .expect(201);

    expect(mockPaymentsService.fundLocalDevWallet).toHaveBeenCalledWith(body);
  });

  it('POST /payments/dev/fund accepts an omitted amount (web client default)', async () => {
    await request(app.getHttpServer())
      .post('/payments/dev/fund')
      .set('Authorization', `Bearer ${token}`)
      .send({ wallet: WALLET, assetId: 'usdc' })
      .expect(201);

    expect(mockPaymentsService.fundLocalDevWallet).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['missing assetId', { wallet: WALLET }],
    ['missing wallet', { assetId: 'usdc' }],
    ['non-string wallet', { wallet: 123, assetId: 'usdc' }],
    ['non-numeric amount', { wallet: WALLET, assetId: 'usdc', amount: 'abc' }],
    ['negative amount', { wallet: WALLET, assetId: 'usdc', amount: '-1' }],
    ['numeric (non-string) amount', { wallet: WALLET, assetId: 'usdc', amount: 5 }],
  ])('POST /payments/dev/fund → 400 for %s', async (_label, body) => {
    await request(app.getHttpServer())
      .post('/payments/dev/fund')
      .set('Authorization', `Bearer ${token}`)
      .send(body)
      .expect(400);

    expect(mockPaymentsService.fundLocalDevWallet).not.toHaveBeenCalled();
  });
});
