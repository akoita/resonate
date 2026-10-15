/**
 * MetadataController collection route — HTTP Contract Test (#2139)
 *
 * GET /metadata/collection/:walletAddress is owner-only:
 *   - 401 without a JWT
 *   - 400 for a malformed address
 *   - 403 for a listener asking for another wallet (generic message)
 *   - 200 for the caller's own userId / Wallet.address / Wallet.ownerAddress
 *   - 200 for admin/operator support access
 *
 * ContractsService is mocked at the controller boundary; the address-set
 * resolution itself is covered against real Postgres in
 * metadata.controller.integration.spec.ts.
 */

import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { MetadataController } from '../modules/contracts/metadata.controller';
import { ContractsService } from '../modules/contracts/contracts.service';
import { IndexerService } from '../modules/contracts/indexer.service';
import { NotificationService } from '../modules/notifications/notification.service';
import { EventBus } from '../modules/shared/event_bus';
import { RightsRouteReassessmentService } from '../modules/rights/rights-route-reassessment.service';
import { TrustedSourceService } from '../modules/rights/trusted-source.service';
import { createControllerTestApp, authToken } from './e2e-helpers';

const SMART_ACCOUNT = `0x${'a1'.repeat(20)}`;
const OWNER_EOA = `0x${'b2'.repeat(20)}`;
const OTHER_WALLET = `0x${'c3'.repeat(20)}`;

const mockContractsService = {
  getCallerWalletAddresses: jest.fn(),
  getStemsByOwner: jest.fn(),
};

describe('MetadataController collection route (HTTP)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createControllerTestApp(MetadataController, [
      { provide: ContractsService, useValue: mockContractsService },
      { provide: IndexerService, useValue: {} },
      { provide: NotificationService, useValue: {} },
      { provide: EventBus, useValue: { publish: jest.fn() } },
      { provide: RightsRouteReassessmentService, useValue: {} },
      { provide: TrustedSourceService, useValue: {} },
    ]);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockContractsService.getCallerWalletAddresses.mockImplementation(async (userId: string) =>
      userId === SMART_ACCOUNT ? new Set([SMART_ACCOUNT, OWNER_EOA]) : new Set<string>(),
    );
    mockContractsService.getStemsByOwner.mockResolvedValue([
      {
        id: 'stem-1',
        type: 'vocals',
        title: 'Vocals',
        trackId: 'track-1',
        licenseType: 'remix',
        holding: 'purchased',
      },
    ]);
  });

  it('401 without a JWT and never reads holdings', async () => {
    await request(app.getHttpServer()).get(`/metadata/collection/${SMART_ACCOUNT}`).expect(401);
    expect(mockContractsService.getStemsByOwner).not.toHaveBeenCalled();
  });

  it('400 for a malformed wallet address', async () => {
    await request(app.getHttpServer())
      .get('/metadata/collection/not-an-address')
      .set('Authorization', `Bearer ${authToken(SMART_ACCOUNT)}`)
      .expect(400);
    expect(mockContractsService.getStemsByOwner).not.toHaveBeenCalled();
  });

  it("403 for a listener reading another wallet's collection, without revealing holdings", async () => {
    const res = await request(app.getHttpServer())
      .get(`/metadata/collection/${OTHER_WALLET}`)
      .set('Authorization', `Bearer ${authToken(SMART_ACCOUNT)}`)
      .expect(403);
    expect(JSON.stringify(res.body)).not.toContain('stem-1');
    expect(mockContractsService.getStemsByOwner).not.toHaveBeenCalled();
  });

  it('403 for a non-wallet user id with no linked wallet', async () => {
    await request(app.getHttpServer())
      .get(`/metadata/collection/${OTHER_WALLET}`)
      .set('Authorization', `Bearer ${authToken('user-without-wallet')}`)
      .expect(403);
  });

  it('403 for the agent role on another wallet (only admin/operator bypass)', async () => {
    await request(app.getHttpServer())
      .get(`/metadata/collection/${OTHER_WALLET}`)
      .set('Authorization', `Bearer ${authToken('agent-1', 'agent')}`)
      .expect(403);
  });

  it('200 for the caller reading their own address (userId)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/metadata/collection/${SMART_ACCOUNT}`)
      .set('Authorization', `Bearer ${authToken(SMART_ACCOUNT)}`)
      .expect(200);
    expect(res.body.total).toBe(1);
    expect(res.body.stems[0]).toEqual(
      expect.objectContaining({ id: 'stem-1', licenseType: 'remix', holding: 'purchased' }),
    );
    expect(mockContractsService.getCallerWalletAddresses).toHaveBeenCalledWith(SMART_ACCOUNT);
    expect(mockContractsService.getStemsByOwner).toHaveBeenCalledWith(SMART_ACCOUNT);
  });

  it('200 for the caller reading their own owner EOA, case-insensitively', async () => {
    const checksummedLike = `0x${OWNER_EOA.slice(2).toUpperCase()}`;
    await request(app.getHttpServer())
      .get(`/metadata/collection/${checksummedLike}`)
      .set('Authorization', `Bearer ${authToken(SMART_ACCOUNT)}`)
      .expect(200);
    expect(mockContractsService.getStemsByOwner).toHaveBeenCalledWith(checksummedLike);
  });

  it.each(['admin', 'operator'])('200 for %s support access to any wallet', async (role) => {
    await request(app.getHttpServer())
      .get(`/metadata/collection/${OTHER_WALLET}`)
      .set('Authorization', `Bearer ${authToken(`${role}-1`, role)}`)
      .expect(200);
    expect(mockContractsService.getCallerWalletAddresses).not.toHaveBeenCalled();
    expect(mockContractsService.getStemsByOwner).toHaveBeenCalledWith(OTHER_WALLET);
  });
});
