/**
 * MetadataController rights routes: admin branches are audited (#2380).
 *
 * - POST /metadata/evidence/bundles: a privileged evidence role is admin-only and
 *   writes one audit row (role code and ids); a creator bundle writes none.
 * - GET rights-reassessments / release-rights reads pass the signed-in caller to
 *   the service as the audit actor (the row itself is covered against Postgres in
 *   admin_branch_audit.integration.spec.ts).
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
import { authToken, createControllerTestApp } from './e2e-helpers';

jest.mock('../modules/admin_audit/admin_audit_event', () => ({
  ...jest.requireActual('../modules/admin_audit/admin_audit_event'),
  writeAdminAuditEvent: jest.fn().mockResolvedValue(undefined),
}));
const mockAudit = writeAdminAuditEvent as jest.Mock;

const mockContractsService = {
  createEvidenceBundle: jest.fn().mockResolvedValue({ id: 'bundle-1' }),
  getLatestReleaseRightsUpgradeRequest: jest.fn().mockResolvedValue({ id: 'req-1' }),
};
const mockReassessments = {
  createReassessmentFromEvidenceBundle: jest.fn().mockResolvedValue(undefined),
  listReleaseHistory: jest.fn().mockResolvedValue([]),
};

describe('MetadataController rights routes (HTTP, #2380)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createControllerTestApp(MetadataController, [
      { provide: ContractsService, useValue: mockContractsService },
      { provide: IndexerService, useValue: {} },
      { provide: NotificationService, useValue: {} },
      { provide: EventBus, useValue: { publish: jest.fn() } },
      { provide: RightsRouteReassessmentService, useValue: mockReassessments },
      { provide: TrustedSourceService, useValue: {} },
    ]);
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => jest.clearAllMocks());

  const bundle = (submittedByRole: string) => ({
    subjectType: 'release',
    subjectId: 'rel-1',
    submittedByRole,
    purpose: 'rights_review',
    summary: 'free text that must never reach the log',
  });
  const post = (role: string, userId: string, body: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post('/metadata/evidence/bundles')
      .set('Authorization', `Bearer ${authToken(userId, role)}`)
      .send(body);

  it('an admin submitting platform evidence is recorded with role code and ids only', async () => {
    await post('admin', 'admin-1', bundle('trusted_source')).expect(201);
    expect(mockAudit).toHaveBeenCalledTimes(1);
    expect(mockAudit).toHaveBeenCalledWith({
      actorUserId: 'admin-1',
      action: 'rights_evidence.privileged_submitted',
      targetUserId: null,
      detail: { evidenceRole: 'trusted_source', subjectType: 'release', subjectId: 'rel-1' },
    });
  });

  it('a creator bundle, and a refused privileged role, write no audit row', async () => {
    await post('listener', '0x' + 'a1'.repeat(20), bundle('creator')).expect(201);
    await post('operator', 'operator-1', bundle('ops')).expect(403);
    await post('listener', 'user-1', bundle('system')).expect(403);
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it('passes the signed-in caller to the history and latest-request reads as the audit actor', async () => {
    const header = { Authorization: `Bearer ${authToken('admin-1', 'admin')}` };
    await request(app.getHttpServer()).get('/metadata/rights-reassessments/releases/rel-1').set(header).expect(200);
    await request(app.getHttpServer()).get('/metadata/release-rights/releases/rel-1').set(header).expect(200);
    expect(mockReassessments.listReleaseHistory).toHaveBeenCalledWith(
      'rel-1', 'admin-1', 'admin', expect.objectContaining({ userId: 'admin-1', role: 'admin' }),
    );
    expect(mockContractsService.getLatestReleaseRightsUpgradeRequest).toHaveBeenCalledWith(
      'rel-1', 'admin-1', 'admin', expect.objectContaining({ userId: 'admin-1', role: 'admin' }),
    );
  });
});
