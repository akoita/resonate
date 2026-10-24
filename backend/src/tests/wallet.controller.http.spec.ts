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

import { writeAdminAuditEvent } from '../modules/admin_audit/admin_audit_event';
import { createControllerTestApp, authToken, confirmedBearer, expectStepUpRequired } from './e2e-helpers';

jest.mock('../modules/admin_audit/admin_audit_event', () => ({
  ...jest.requireActual('../modules/admin_audit/admin_audit_event'),
  writeAdminAuditEvent: jest.fn().mockResolvedValue(undefined),
}));
const mockAudit = writeAdminAuditEvent as jest.Mock;

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

  it('records an admin changing another user\'s wallet, not their own or the owner\'s (#2380)', async () => {
    await request(app.getHttpServer())
      .post('/wallet/fund')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ userId: 'u1', amountUsd: 10 })
      .expect(201);
    await request(app.getHttpServer())
      .post('/wallet/budget')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ userId: 'u1', monthlyCapUsd: 10 })
      .expect(201);
    expect(mockAudit).toHaveBeenCalledTimes(2);
    expect(mockAudit).toHaveBeenCalledWith({ actorUserId: 'admin-1', action: 'wallet.support_changed', targetUserId: 'u1', detail: { change: 'fund' } });
    expect(mockAudit).toHaveBeenCalledWith({ actorUserId: 'admin-1', action: 'wallet.support_changed', targetUserId: 'u1', detail: { change: 'budget' } });

    mockAudit.mockClear();
    await request(app.getHttpServer())
      .post('/wallet/fund')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ userId: 'admin-1', amountUsd: 10 })
      .expect(201);
    await request(app.getHttpServer())
      .post('/wallet/fund')
      .set('Authorization', `Bearer ${listenerToken}`)
      .send({ userId: 'user-1', amountUsd: 10 })
      .expect(201);
    await request(app.getHttpServer())
      .post('/wallet/fund')
      .set('Authorization', `Bearer ${listenerToken}`)
      .send({ userId: 'u1', amountUsd: 10 })
      .expect(403);
    expect(mockAudit).not.toHaveBeenCalled();
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

  // ----- Value rules (#2361): the real service rejects before touching the DB -----

  describe('amount value rules', () => {
    let rulesApp: INestApplication;

    beforeAll(async () => {
      const realWallet = new WalletService(
        { publish: jest.fn() } as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
      );
      rulesApp = await createControllerTestApp(WalletController, [
        { provide: WalletService, useValue: realWallet },
        { provide: SessionKeyService, useValue: mockSessionKeyService },
        { provide: SocialRecoveryService, useValue: mockRecoveryService },
        { provide: AgentWalletService, useValue: mockAgentWalletService },
        { provide: AgentPurchaseService, useValue: mockAgentPurchaseService },
      ]);
    });

    afterAll(async () => {
      await rulesApp.close();
    });

    it.each([0, -5, 10_001])('POST /wallet/fund → 400 for amountUsd %p', async (amountUsd) => {
      await request(rulesApp.getHttpServer())
        .post('/wallet/fund')
        .set('Authorization', `Bearer ${listenerToken}`)
        .send({ userId: 'user-1', amountUsd })
        .expect(400);
    });

    it.each([-1, 10_001])('POST /wallet/budget → 400 for monthlyCapUsd %p', async (monthlyCapUsd) => {
      await request(rulesApp.getHttpServer())
        .post('/wallet/budget')
        .set('Authorization', `Bearer ${listenerToken}`)
        .send({ userId: 'user-1', monthlyCapUsd })
        .expect(400);
    });

    it('answers with a clear message', async () => {
      const res = await request(rulesApp.getHttpServer())
        .post('/wallet/fund')
        .set('Authorization', `Bearer ${listenerToken}`)
        .send({ userId: 'user-1', amountUsd: -5 })
        .expect(400);
      expect(JSON.stringify(res.body)).toContain('amountUsd must be greater than 0');
    });
  });

  // ----- Admin step-up and audit (#2362) -----

  describe('admin wallet routes: step-up and audit (#2362)', () => {
    const recoveryRoutes: Array<[string, Record<string, unknown>, () => jest.Mock]> = [
      ['/wallet/guardians', { userId: 'u1', guardians: ['0xg1', '0xg2'], required: 2 }, () => mockRecoveryService.setGuardians],
      ['/wallet/recovery/request', { userId: 'u1', newOwner: '0xnew', required: 2 }, () => mockRecoveryService.requestRecovery],
      ['/wallet/recovery/approve', { requestId: 'r1', guardian: '0xg1' }, () => mockRecoveryService.approveRecovery],
    ];

    beforeEach(() => jest.clearAllMocks());

    it.each(recoveryRoutes)('POST %s needs a fresh step-up proof', async (path, body, service) => {
      await expectStepUpRequired(app, 'post', path, { userId: 'admin-1', role: 'admin' }, body);
      expect(service()).not.toHaveBeenCalled();
      expect(mockAudit).not.toHaveBeenCalled();
    });

    it('records guardians set as a count, never the addresses', async () => {
      await request(app.getHttpServer())
        .post('/wallet/guardians')
        .set(confirmedBearer('admin-1', 'admin'))
        .send({ userId: 'u1', guardians: ['0xg1', '0xg2'], required: 2 })
        .expect(201);
      expect(mockAudit).toHaveBeenCalledWith({
        actorUserId: 'admin-1',
        action: 'wallet.guardians_set',
        targetUserId: 'u1',
        detail: { guardianCount: 2, required: 2 },
      });
    });

    it('records a recovery request for the account and an approval by its request id', async () => {
      await request(app.getHttpServer())
        .post('/wallet/recovery/request')
        .set(confirmedBearer('admin-1', 'admin'))
        .send({ userId: 'u1', newOwner: '0xnew', required: 2 })
        .expect(201);
      await request(app.getHttpServer())
        .post('/wallet/recovery/approve')
        .set(confirmedBearer('admin-1', 'admin'))
        .send({ requestId: 'r1', guardian: '0xg1' })
        .expect(201);
      expect(mockAudit).toHaveBeenNthCalledWith(1, {
        actorUserId: 'admin-1',
        action: 'wallet.recovery_requested',
        targetUserId: 'u1',
        detail: { newOwner: '0xnew', required: 2 },
      });
      expect(mockAudit).toHaveBeenNthCalledWith(2, {
        actorUserId: 'admin-1',
        action: 'wallet.recovery_approved',
        targetUserId: null,
        detail: { requestId: 'r1' },
      });
    });

    it('records provider, session key and paymaster changes without step-up', async () => {
      const auth = { Authorization: `Bearer ${adminToken}` };
      await request(app.getHttpServer()).post('/wallet/provider').set(auth).send({ userId: 'u1', provider: 'erc4337' }).expect(201);
      await request(app.getHttpServer()).post('/wallet/refresh').set(auth).send({ userId: 'u1' }).expect(201);
      await request(app.getHttpServer()).post('/wallet/session-key').set(auth).send({ userId: 'u1', scope: 'purchase', ttlSeconds: 60 }).expect(201);
      await request(app.getHttpServer()).post('/wallet/paymaster/reset').set(auth).send({ userId: 'u1' }).expect(201);
      await request(app.getHttpServer()).post('/wallet/paymaster').set(auth).send({ sponsorMaxUsd: 5, paymasterAddress: '0xpm' }).expect(201);
      expect(mockAudit.mock.calls.map(([event]) => [event.action, event.targetUserId, event.detail])).toEqual([
        ['wallet.provider_set', 'u1', { provider: 'erc4337' }],
        ['wallet.refreshed', 'u1', undefined],
        ['wallet.session_key_issued', 'u1', { scope: 'purchase', ttlSeconds: 60 }],
        ['wallet.paymaster_reset', 'u1', undefined],
        ['wallet.paymaster_configured', null, { sponsorMaxUsd: 5, paymasterAddress: '0xpm' }],
      ]);
    });

    it('does not record the read-only paymaster status, a validation, or a refused caller', async () => {
      const auth = { Authorization: `Bearer ${adminToken}` };
      await request(app.getHttpServer()).get('/wallet/paymaster').set(auth).expect(200);
      await request(app.getHttpServer()).post('/wallet/session-key/validate').set(auth).send({ token: 't', scope: 'purchase' }).expect(201);
      await request(app.getHttpServer()).post('/wallet/provider').set('Authorization', `Bearer ${listenerToken}`).send({ userId: 'u1', provider: 'local' }).expect(403);
      expect(mockAudit).not.toHaveBeenCalled();
    });
  });
});
