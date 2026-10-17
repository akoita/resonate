/**
 * WalletController — E2E Test
 *
 * Tests the HTTP contract:
 *   - Guard enforcement (401 without JWT)
 *   - Role enforcement (403 without admin role on admin-only routes)
 *   - Routing
 */

import request from 'supertest';
import { ConflictException, ForbiddenException, INestApplication, NotFoundException } from '@nestjs/common';
import { WalletController } from '../modules/identity/wallet.controller';
import { WalletService } from '../modules/identity/wallet.service';
import { SessionKeyService } from '../modules/identity/session_key.service';
import { SocialRecoveryService } from '../modules/identity/social_recovery.service';
import { AgentWalletService } from '../modules/agents/agent_wallet.service';
import { AgentPurchaseService } from '../modules/agents/agent_purchase.service';

import { createControllerTestApp, authToken } from './e2e-helpers';

const mockWalletService = {
  fundWallet: jest.fn().mockResolvedValue({ ok: true }),
  setBudget: jest.fn().mockResolvedValue({ ok: true }),
  setProvider: jest.fn().mockResolvedValue({ ok: true }),
  refreshWallet: jest.fn().mockResolvedValue({ ok: true }),
  configurePaymaster: jest.fn(),
  getPaymasterStatus: jest.fn().mockReturnValue({}),
  resetPaymaster: jest.fn(),
  getWallet: jest.fn().mockResolvedValue({ balanceUsd: 100 }),
  getWalletForCaller: jest.fn().mockResolvedValue({ balanceUsd: 100 }),
};

const mockSessionKeyService = {
  issue: jest.fn().mockReturnValue({ token: 'sk' }),
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

describe('WalletController (e2e)', () => {
  let app: INestApplication;
  const listenerToken = authToken('user-1', 'listener');
  const adminToken = authToken('admin-1', 'admin');

  beforeAll(async () => {
    app = await createControllerTestApp(WalletController, [
      { provide: WalletService, useValue: mockWalletService },
      { provide: SessionKeyService, useValue: mockSessionKeyService },
      { provide: SocialRecoveryService, useValue: mockRecoveryService },
      { provide: AgentWalletService, useValue: mockAgentWalletService },
      { provide: AgentPurchaseService, useValue: mockAgentPurchaseService },
    ]);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => jest.clearAllMocks());

  // ----- Guard enforcement -----

  it('POST /wallet/fund → 401 without JWT', async () => {
    await request(app.getHttpServer())
      .post('/wallet/fund')
      .send({ userId: 'u1', amountUsd: 10 })
      .expect(401);
  });

  it('POST /wallet/fund → 201 for the caller\'s own wallet', async () => {
    await request(app.getHttpServer())
      .post('/wallet/fund')
      .set('Authorization', `Bearer ${listenerToken}`)
      .send({ userId: 'user-1', amountUsd: 10 })
      .expect(201);
    expect(mockWalletService.fundWallet).toHaveBeenCalledTimes(1);
  });

  it('POST /wallet/fund → 403 when naming another user, no change made', async () => {
    await request(app.getHttpServer())
      .post('/wallet/fund')
      .set('Authorization', `Bearer ${listenerToken}`)
      .send({ userId: 'u1', amountUsd: 10 })
      .expect(403);
    expect(mockWalletService.fundWallet).not.toHaveBeenCalled();
  });

  it('POST /wallet/fund → 201 when an admin names any user', async () => {
    await request(app.getHttpServer())
      .post('/wallet/fund')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ userId: 'u1', amountUsd: 10 })
      .expect(201);
  });

  it('POST /wallet/budget → 403 when naming another user, 201 for own wallet', async () => {
    await request(app.getHttpServer())
      .post('/wallet/budget')
      .set('Authorization', `Bearer ${listenerToken}`)
      .send({ userId: 'u1', monthlyCapUsd: 10 })
      .expect(403);
    expect(mockWalletService.setBudget).not.toHaveBeenCalled();
    await request(app.getHttpServer())
      .post('/wallet/budget')
      .set('Authorization', `Bearer ${listenerToken}`)
      .send({ userId: 'user-1', monthlyCapUsd: 10 })
      .expect(201);
  });

  it('GET /wallet/:userId → 401 without JWT', async () => {
    await request(app.getHttpServer())
      .get('/wallet/user-1')
      .expect(401);
  });

  it('GET /wallet/:userId → 200 and resolves the caller from the JWT', async () => {
    const res = await request(app.getHttpServer())
      .get('/wallet/user-1')
      .set('Authorization', `Bearer ${listenerToken}`)
      .expect(200);

    expect(res.body.balanceUsd).toBe(100);
    expect(mockWalletService.getWalletForCaller).toHaveBeenCalledWith(
      { userId: 'user-1', role: 'listener' },
      'user-1',
    );
  });

  it('GET /wallet/:userId → 403 when the service refuses the id', async () => {
    mockWalletService.getWalletForCaller.mockRejectedValueOnce(new ForbiddenException('refused'));
    await request(app.getHttpServer())
      .get('/wallet/someone-else')
      .set('Authorization', `Bearer ${listenerToken}`)
      .expect(403);
  });

  it('GET /wallet/:userId → 404 when the wallet does not exist', async () => {
    mockWalletService.getWalletForCaller.mockRejectedValueOnce(new NotFoundException('missing'));
    await request(app.getHttpServer())
      .get('/wallet/missing')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(404);
  });

  it('normalises an address-shaped JWT subject to lowercase', async () => {
    const checksummed = '0xAbCdEf0123456789aBcDeF0123456789AbCdEf01';
    await request(app.getHttpServer())
      .get(`/wallet/${checksummed}`)
      .set('Authorization', `Bearer ${authToken(checksummed)}`)
      .expect(200);
    expect(mockWalletService.getWalletForCaller).toHaveBeenCalledWith(
      { userId: checksummed.toLowerCase(), role: 'listener' },
      checksummed,
    );
  });

  // ----- Admin-only routing (role enforcement is via global RolesGuard in AppModule) -----

  it('POST /wallet/provider → 201 with admin JWT', async () => {
    await request(app.getHttpServer())
      .post('/wallet/provider')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ userId: 'u1', provider: 'erc4337' })
      .expect(201);
  });

  it('POST /wallet/provider → 409 when the sign-in verified address would be replaced (#2023)', async () => {
    mockWalletService.setProvider.mockRejectedValueOnce(
      new ConflictException({
        code: 'wallet_address_verified',
        message: 'This wallet\'s address was verified at sign-in and cannot be replaced by a provider-derived address.',
      }),
    );

    const res = await request(app.getHttpServer())
      .post('/wallet/provider')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ userId: 'u1', provider: 'local' })
      .expect(409);

    expect(res.body.code).toBe('wallet_address_verified');
  });

  // ----- Agent wallet routing -----

  it('POST /wallet/agent/enable → 201 with JWT', async () => {
    const res = await request(app.getHttpServer())
      .post('/wallet/agent/enable')
      .set('Authorization', `Bearer ${listenerToken}`)
      .expect(201);

    expect(res.body.agentAddress).toBeDefined();
  });

  it('GET /wallet/agent/status → 200 with JWT', async () => {
    await request(app.getHttpServer())
      .get('/wallet/agent/status')
      .set('Authorization', `Bearer ${listenerToken}`)
      .expect(200);
  });
});
