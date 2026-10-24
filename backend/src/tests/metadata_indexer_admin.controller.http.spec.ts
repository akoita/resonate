/**
 * MetadataController indexer maintenance routes — HTTP Contract Test
 *
 * POST /metadata/indexer/reset and POST /metadata/indexer/reindex-tx move the
 * indexer cursor or force a transaction through the handlers again, so they are
 * admin-only (the follow-up named in
 * audit/security_best_practices_report_marketplace_sold_indexing.md):
 *   - 401 without a JWT
 *   - 403 for every non-admin role, with nothing reset or reindexed
 *   - 403 step_up_required for an admin without a fresh step-up proof (#2362)
 *   - accepted for an admin with a proof, with the body passed through and one audit record
 * GET /metadata/indexer/status stays public (read-only).
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
import { writeAdminAuditEvent } from '../modules/admin_audit/admin_audit_event';
import { authToken, confirmedBearer, createControllerTestApp, expectStepUpRequired } from './e2e-helpers';

jest.mock('../modules/admin_audit/admin_audit_event', () => ({
  ...jest.requireActual('../modules/admin_audit/admin_audit_event'),
  writeAdminAuditEvent: jest.fn().mockResolvedValue(undefined),
}));
const mockAudit = writeAdminAuditEvent as jest.Mock;

const TX = `0x${'ab'.repeat(32)}`;

describe('MetadataController indexer maintenance routes (HTTP)', () => {
  let app: INestApplication;
  const indexerService = {
    resetIndexer: jest.fn().mockResolvedValue(undefined),
    indexTransaction: jest.fn().mockResolvedValue({ processed: 1 }),
    getStatus: jest.fn().mockResolvedValue({ enabled: true, chains: [] }),
  };

  beforeAll(async () => {
    app = await createControllerTestApp(MetadataController, [
      { provide: ContractsService, useValue: {} },
      { provide: IndexerService, useValue: indexerService },
      { provide: NotificationService, useValue: {} },
      { provide: EventBus, useValue: { publish: jest.fn() } },
      { provide: RightsRouteReassessmentService, useValue: {} },
      { provide: TrustedSourceService, useValue: {} },
    ]);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => jest.clearAllMocks());

  const server = () => app.getHttpServer();
  const bearer = (role: string) => ({ Authorization: `Bearer ${authToken('u-1', role)}` });
  const routes: Array<[string, Record<string, unknown>]> = [
    ['/metadata/indexer/reset', { chainId: 31337, fromBlock: 1 }],
    ['/metadata/indexer/reindex-tx', { txHash: TX, chainId: 31337, force: true }],
  ];

  it.each(routes)('POST %s requires a JWT (401)', async (path, body) => {
    await request(server()).post(path).send(body).expect(401);
    expect(indexerService.resetIndexer).not.toHaveBeenCalled();
    expect(indexerService.indexTransaction).not.toHaveBeenCalled();
  });

  it.each(['listener', 'artist', 'curator', 'agent', 'operator'])(
    'rejects the %s role on both routes (403)',
    async (role) => {
      for (const [path, body] of routes) {
        await request(server()).post(path).set(bearer(role)).send(body).expect(403);
      }
      expect(indexerService.resetIndexer).not.toHaveBeenCalled();
      expect(indexerService.indexTransaction).not.toHaveBeenCalled();
    },
  );

  it.each(routes)('POST %s needs a fresh step-up proof (#2362)', async (path, body) => {
    await expectStepUpRequired(app, 'post', path, { userId: 'u-1', role: 'admin' }, body);
    expect(indexerService.resetIndexer).not.toHaveBeenCalled();
    expect(indexerService.indexTransaction).not.toHaveBeenCalled();
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it('lets an admin with a proof reset the cursor, and records it', async () => {
    await request(server())
      .post('/metadata/indexer/reset')
      .set(confirmedBearer('u-1', 'admin'))
      .send({ chainId: 31337, fromBlock: 7 })
      .expect(201);
    expect(indexerService.resetIndexer).toHaveBeenCalledWith(31337, 7n);
    expect(mockAudit).toHaveBeenCalledWith({
      actorUserId: 'u-1',
      action: 'indexer.reset',
      targetUserId: null,
      detail: { chainId: 31337, fromBlock: 7 },
    });
  });

  it('lets an admin with a proof reindex a transaction, and records it', async () => {
    await request(server())
      .post('/metadata/indexer/reindex-tx')
      .set(confirmedBearer('u-1', 'admin'))
      .send({ txHash: TX, chainId: 31337, force: true })
      .expect(201);
    expect(indexerService.indexTransaction).toHaveBeenCalledWith(TX, 31337, { force: true });
    expect(mockAudit).toHaveBeenCalledWith({
      actorUserId: 'u-1',
      action: 'indexer.tx_reindexed',
      targetUserId: null,
      detail: { chainId: 31337, txHash: TX, force: true },
    });
  });

  it('records nothing for a refused operator or a failed reindex', async () => {
    await request(server()).post('/metadata/indexer/reset').set(confirmedBearer('u-2', 'operator')).send(routes[0][1]).expect(403);
    indexerService.indexTransaction.mockRejectedValueOnce(new Error('rpc down'));
    await request(server()).post('/metadata/indexer/reindex-tx').set(confirmedBearer('u-1', 'admin')).send(routes[1][1]).expect(500);
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it('keeps the read-only status public', async () => {
    await request(server()).get('/metadata/indexer/status').expect(200);
  });
});
