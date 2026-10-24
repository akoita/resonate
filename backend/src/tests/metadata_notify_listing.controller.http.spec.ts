/**
 * MetadataController notify-listing route — HTTP Contract Test (#2041)
 *
 * POST /metadata/notify-listing records listing intents for `sellerAddress`:
 *   - 401 without a JWT
 *   - 400 for a missing/malformed sellerAddress or malformed `tiers`
 *   - 403 when sellerAddress is not one of the caller's addresses
 *   - 201 for the seller, and for admin/operator support access
 * Nothing is written or broadcast on a refusal. Persistence and tier matching
 * are covered against real Postgres in multi_tier_listing.integration.spec.ts;
 * the accepted requests here carry no transactionHash/stemId, so they only
 * broadcast.
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
import { authToken, createControllerTestApp } from './e2e-helpers';
import { writeAdminAuditEvent } from '../modules/admin_audit/admin_audit_event';

jest.mock('../modules/admin_audit/admin_audit_event', () => ({
  ...jest.requireActual('../modules/admin_audit/admin_audit_event'),
  writeAdminAuditEvent: jest.fn().mockResolvedValue(undefined),
}));
const mockAudit = writeAdminAuditEvent as jest.Mock;

const SMART_ACCOUNT = `0x${'a1'.repeat(20)}`;
const OWNER_EOA = `0x${'b2'.repeat(20)}`;
const OTHER_WALLET = `0x${'c3'.repeat(20)}`;

const tier = (licenseType: string, ordinal: unknown, extra: Record<string, unknown> = {}) => ({
  licenseType,
  pricePerUnit: '1000',
  amount: '1',
  ordinal,
  ...extra,
});

describe('MetadataController notify-listing (HTTP)', () => {
  let app: INestApplication;
  const contractsService = { getCallerWalletAddresses: jest.fn() };
  const indexerService = { indexTransaction: jest.fn() };
  const eventBus = { publish: jest.fn() };

  beforeAll(async () => {
    app = await createControllerTestApp(MetadataController, [
      { provide: ContractsService, useValue: contractsService },
      { provide: IndexerService, useValue: indexerService },
      { provide: NotificationService, useValue: {} },
      { provide: EventBus, useValue: eventBus },
      { provide: RightsRouteReassessmentService, useValue: {} },
      { provide: TrustedSourceService, useValue: {} },
    ]);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    contractsService.getCallerWalletAddresses.mockImplementation(async (userId: string) =>
      userId === SMART_ACCOUNT ? new Set([SMART_ACCOUNT, OWNER_EOA]) : new Set<string>(),
    );
  });

  const post = (body: Record<string, unknown>, token?: string) => {
    const req = request(app.getHttpServer()).post('/metadata/notify-listing');
    if (token) req.set('Authorization', `Bearer ${token}`);
    return req.send(body);
  };
  const sellerBody = (extra: Record<string, unknown> = {}) => ({
    tokenId: '7',
    sellerAddress: OWNER_EOA,
    tiers: [tier('personal', 0), tier('remix', 1)],
    ...extra,
  });

  const expectNothingDone = () => {
    expect(indexerService.indexTransaction).not.toHaveBeenCalled();
    expect(eventBus.publish).not.toHaveBeenCalled();
  };

  it('401 without a JWT', async () => {
    await post(sellerBody()).expect(401);
    expectNothingDone();
  });

  it.each([
    ['a missing sellerAddress', { sellerAddress: undefined }],
    ['a malformed sellerAddress', { sellerAddress: '0x1234' }],
  ])('400 for %s', async (_label, extra) => {
    await post(sellerBody(extra), authToken(SMART_ACCOUNT)).expect(400);
    expectNothingDone();
  });

  it('403 when the sellerAddress is not one of the caller addresses', async () => {
    await post(sellerBody({ sellerAddress: OTHER_WALLET }), authToken(SMART_ACCOUNT)).expect(403);
    expectNothingDone();
  });

  it('403 for the agent role (only admin/operator bypass)', async () => {
    await post(sellerBody(), authToken(OTHER_WALLET, 'agent')).expect(403);
    expectNothingDone();
  });

  it('201 for the seller, including a linked owner address in any letter case', async () => {
    await post(sellerBody({ sellerAddress: OWNER_EOA.toUpperCase().replace(/^0X/, '0x') }), authToken(SMART_ACCOUNT))
      .expect(201);
    expect(eventBus.publish).toHaveBeenCalledTimes(2);
    expect(eventBus.publish.mock.calls.map(([event]) => [event.licenseType, event.sellerAddress])).toEqual([
      ['personal', OWNER_EOA],
      ['remix', OWNER_EOA],
    ]);
  });

  it.each(['admin', 'operator'])('201 for %s support access', async (role) => {
    await post(sellerBody({ sellerAddress: OTHER_WALLET }), authToken('support-user', role)).expect(201);
    expect(eventBus.publish).toHaveBeenCalledTimes(2);
    // #2380: recording a listing for someone else's address is one audit row.
    expect(mockAudit).toHaveBeenCalledTimes(1);
    expect(mockAudit).toHaveBeenCalledWith({
      actorUserId: 'support-user',
      action: 'listing_intent.support_recorded',
      targetUserId: null,
      detail: { sellerAddress: OTHER_WALLET },
    });
  });

  it('writes no audit row for the seller or a refused caller (#2380)', async () => {
    await post(sellerBody(), authToken(SMART_ACCOUNT)).expect(201);
    await post(sellerBody({ sellerAddress: OTHER_WALLET }), authToken(SMART_ACCOUNT)).expect(403);
    contractsService.getCallerWalletAddresses.mockResolvedValueOnce(new Set([OTHER_WALLET]));
    await post(sellerBody({ sellerAddress: OTHER_WALLET }), authToken('admin-1', 'admin')).expect(201);
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it.each([
    ['an empty array', []],
    ['more than three tiers', [tier('personal', 0), tier('remix', 1), tier('commercial', 2), tier('personal', 3)]],
    ['a duplicate licenseType', [tier('remix', 0), tier('remix', 1)]],
    ['a duplicate ordinal', [tier('personal', 0), tier('remix', 0)]],
    ['an unknown licenseType', [tier('exclusive', 0)]],
    ['a negative ordinal', [tier('personal', -1)]],
    ['a fractional ordinal', [tier('personal', 0.5)]],
    ['a string ordinal', [tier('personal', '0')]],
    ['a non-numeric price', [tier('personal', 0, { pricePerUnit: '1e18' })]],
    ['a missing amount', [tier('personal', 0, { amount: undefined })]],
    ['a non-numeric listingId', [tier('personal', 0, { listingId: '0x01' })]],
    ['a non-array tiers', { licenseType: 'personal' }],
  ])('400 for %s and writes nothing', async (_label, tiers) => {
    await post(sellerBody({ transactionHash: '0x' + 'a'.repeat(64), tiers }), authToken(SMART_ACCOUNT)).expect(400);
    expectNothingDone();
    expect(contractsService.getCallerWalletAddresses).not.toHaveBeenCalled();
  });
});
