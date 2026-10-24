/**
 * MetadataController notification routes — HTTP Contract Test
 *
 * Every notification route requires a JWT and only serves the caller's own
 * addresses (wallet-auth userId, Wallet.address, Wallet.ownerAddress):
 *   - 401 without a JWT on all five routes
 *   - 400 for a malformed :address
 *   - 403 for another wallet's :address (generic message)
 *   - 200 for the caller's own address and linked owner/smart-account address
 *   - 404 when marking another account's (or an unknown) notification read
 *   - admin/operator may read any address; writes stay owner-only
 *
 * ContractsService and NotificationService are mocked at the controller
 * boundary; the address-set resolution itself is covered against real
 * Postgres in metadata.controller.integration.spec.ts.
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
import { writeAdminAuditEvent } from '../modules/admin_audit/admin_audit_event';

jest.mock('../modules/admin_audit/admin_audit_event', () => ({
  ...jest.requireActual('../modules/admin_audit/admin_audit_event'),
  writeAdminAuditEvent: jest.fn().mockResolvedValue(undefined),
}));
const mockAudit = writeAdminAuditEvent as jest.Mock;

const SMART_ACCOUNT = `0x${'a1'.repeat(20)}`;
const OWNER_EOA = `0x${'b2'.repeat(20)}`;
const OTHER_WALLET = `0x${'c3'.repeat(20)}`;

const mockContractsService = {
  getCallerWalletAddresses: jest.fn(),
};

const mockNotificationService = {
  getNotifications: jest.fn(),
  getUnreadCount: jest.fn(),
  getNotificationWalletAddress: jest.fn(),
  markAsRead: jest.fn(),
  markAllAsRead: jest.fn(),
  getPreferences: jest.fn(),
  updatePreferences: jest.fn(),
};

const ownToken = () => `Bearer ${authToken(SMART_ACCOUNT)}`;

describe('MetadataController notification routes (HTTP)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createControllerTestApp(MetadataController, [
      { provide: ContractsService, useValue: mockContractsService },
      { provide: IndexerService, useValue: {} },
      { provide: NotificationService, useValue: mockNotificationService },
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
    mockNotificationService.getNotifications.mockResolvedValue([{ id: 'notif-1', title: 'Private' }]);
    mockNotificationService.getUnreadCount.mockResolvedValue(1);
    mockNotificationService.getNotificationWalletAddress.mockImplementation(async (id: string) =>
      id === 'own-notif' ? OWNER_EOA : id === 'other-notif' ? OTHER_WALLET : null,
    );
    mockNotificationService.markAsRead.mockResolvedValue({ id: 'own-notif', read: true });
    mockNotificationService.markAllAsRead.mockResolvedValue({ count: 1 });
    mockNotificationService.getPreferences.mockResolvedValue({ disputeFiled: true });
    mockNotificationService.updatePreferences.mockResolvedValue({ disputeFiled: false });
  });

  const server = () => app.getHttpServer();

  describe('401 without a JWT', () => {
    it.each([
      ['get', `/metadata/notifications/${SMART_ACCOUNT}`],
      ['patch', '/metadata/notifications/own-notif/read'],
      ['patch', `/metadata/notifications/${SMART_ACCOUNT}/read-all`],
      ['get', `/metadata/notifications/${SMART_ACCOUNT}/preferences`],
      ['patch', `/metadata/notifications/${SMART_ACCOUNT}/preferences`],
    ] as const)('%s %s', async (method, path) => {
      await request(server())[method](path).expect(401);
      for (const fn of Object.values(mockNotificationService)) {
        expect(fn).not.toHaveBeenCalled();
      }
    });
  });

  describe('400 for a malformed address', () => {
    it.each([
      ['get', '/metadata/notifications/not-an-address'],
      ['patch', '/metadata/notifications/0x1234/read-all'],
      ['get', '/metadata/notifications/not-an-address/preferences'],
      ['patch', '/metadata/notifications/not-an-address/preferences'],
    ] as const)('%s %s', async (method, path) => {
      await request(server())[method](path).set('Authorization', ownToken()).expect(400);
      expect(mockNotificationService.getNotifications).not.toHaveBeenCalled();
      expect(mockNotificationService.markAllAsRead).not.toHaveBeenCalled();
      expect(mockNotificationService.getPreferences).not.toHaveBeenCalled();
      expect(mockNotificationService.updatePreferences).not.toHaveBeenCalled();
    });
  });

  describe("403 for another wallet's address", () => {
    it('GET notifications does not leak the feed', async () => {
      const res = await request(server())
        .get(`/metadata/notifications/${OTHER_WALLET}`)
        .set('Authorization', ownToken())
        .expect(403);
      expect(JSON.stringify(res.body)).not.toContain('Private');
      expect(mockNotificationService.getNotifications).not.toHaveBeenCalled();
      expect(mockNotificationService.getUnreadCount).not.toHaveBeenCalled();
    });

    it('PATCH read-all', async () => {
      await request(server())
        .patch(`/metadata/notifications/${OTHER_WALLET}/read-all`)
        .set('Authorization', ownToken())
        .expect(403);
      expect(mockNotificationService.markAllAsRead).not.toHaveBeenCalled();
    });

    it('GET preferences', async () => {
      await request(server())
        .get(`/metadata/notifications/${OTHER_WALLET}/preferences`)
        .set('Authorization', ownToken())
        .expect(403);
      expect(mockNotificationService.getPreferences).not.toHaveBeenCalled();
    });

    it('PATCH preferences', async () => {
      await request(server())
        .patch(`/metadata/notifications/${OTHER_WALLET}/preferences`)
        .set('Authorization', ownToken())
        .send({ disputeFiled: false })
        .expect(403);
      expect(mockNotificationService.updatePreferences).not.toHaveBeenCalled();
    });

    it('a user with no linked wallet', async () => {
      await request(server())
        .get(`/metadata/notifications/${OTHER_WALLET}`)
        .set('Authorization', `Bearer ${authToken('user-without-wallet')}`)
        .expect(403);
    });

    it('the agent role (only admin/operator read any address)', async () => {
      await request(server())
        .get(`/metadata/notifications/${OTHER_WALLET}`)
        .set('Authorization', `Bearer ${authToken('agent-1', 'agent')}`)
        .expect(403);
    });
  });

  describe('200 for the caller', () => {
    it('GET notifications for their own address (userId)', async () => {
      const res = await request(server())
        .get(`/metadata/notifications/${SMART_ACCOUNT}?limit=5&offset=2`)
        .set('Authorization', ownToken())
        .expect(200);
      expect(res.body).toEqual({ notifications: [{ id: 'notif-1', title: 'Private' }], unreadCount: 1 });
      expect(mockContractsService.getCallerWalletAddresses).toHaveBeenCalledWith(SMART_ACCOUNT);
      expect(mockNotificationService.getNotifications).toHaveBeenCalledWith(SMART_ACCOUNT, 5, 2);
    });

    it('GET notifications for their linked owner EOA, case-insensitively', async () => {
      const upper = `0x${OWNER_EOA.slice(2).toUpperCase()}`;
      await request(server())
        .get(`/metadata/notifications/${upper}`)
        .set('Authorization', ownToken())
        .expect(200);
      expect(mockNotificationService.getNotifications).toHaveBeenCalledWith(OWNER_EOA, 20, 0);
    });

    it('PATCH read-all for their own address', async () => {
      await request(server())
        .patch(`/metadata/notifications/${OWNER_EOA}/read-all`)
        .set('Authorization', ownToken())
        .expect(200);
      expect(mockNotificationService.markAllAsRead).toHaveBeenCalledWith(OWNER_EOA);
    });

    it('GET and PATCH preferences for their own address', async () => {
      await request(server())
        .get(`/metadata/notifications/${SMART_ACCOUNT}/preferences`)
        .set('Authorization', ownToken())
        .expect(200);
      expect(mockNotificationService.getPreferences).toHaveBeenCalledWith(SMART_ACCOUNT);

      await request(server())
        .patch(`/metadata/notifications/${SMART_ACCOUNT}/preferences`)
        .set('Authorization', ownToken())
        .send({ disputeFiled: false })
        .expect(200);
      expect(mockNotificationService.updatePreferences).toHaveBeenCalledWith(SMART_ACCOUNT, {
        disputeFiled: false,
      });
    });

    it('PATCH :id/read for a notification addressed to one of their addresses', async () => {
      await request(server())
        .patch('/metadata/notifications/own-notif/read')
        .set('Authorization', ownToken())
        .expect(200);
      expect(mockNotificationService.markAsRead).toHaveBeenCalledWith('own-notif');
    });
  });

  describe('404 marking a notification the caller does not own', () => {
    it.each(['other-notif', 'missing-notif'])('%s', async (id) => {
      const res = await request(server())
        .patch(`/metadata/notifications/${id}/read`)
        .set('Authorization', ownToken())
        .expect(404);
      expect(res.body.message).toBe('Notification not found');
      expect(mockNotificationService.markAsRead).not.toHaveBeenCalled();
    });

    it('admin cannot mark another account notification read', async () => {
      await request(server())
        .patch('/metadata/notifications/other-notif/read')
        .set('Authorization', `Bearer ${authToken('admin-1', 'admin')}`)
        .expect(404);
      expect(mockNotificationService.markAsRead).not.toHaveBeenCalled();
    });
  });

  describe('admin/operator support access', () => {
    it.each(['admin', 'operator'])('%s can read any address', async (role) => {
      const token = `Bearer ${authToken(`${role}-1`, role)}`;
      await request(server()).get(`/metadata/notifications/${OTHER_WALLET}`).set('Authorization', token).expect(200);
      await request(server())
        .get(`/metadata/notifications/${OTHER_WALLET}/preferences`)
        .set('Authorization', token)
        .expect(200);
      expect(mockNotificationService.getNotifications).toHaveBeenCalledWith(OTHER_WALLET, 20, 0);
      expect(mockNotificationService.getPreferences).toHaveBeenCalledWith(OTHER_WALLET);
      // #2380: each support read is one audit row (address only); the owner's own reads write none.
      expect(mockAudit).toHaveBeenCalledTimes(2);
      expect(mockAudit).toHaveBeenCalledWith({
        actorUserId: `${role}-1`,
        action: 'notifications.support_viewed',
        targetUserId: null,
        detail: { address: OTHER_WALLET },
      });
    });

    it('the owner reading their own notifications writes no audit row (#2380)', async () => {
      await request(server()).get(`/metadata/notifications/${SMART_ACCOUNT}`).set('Authorization', ownToken()).expect(200);
      await request(server()).get(`/metadata/notifications/${OWNER_EOA}/preferences`).set('Authorization', ownToken()).expect(200);
      expect(mockAudit).not.toHaveBeenCalled();
    });

    it.each(['admin', 'operator'])('%s cannot modify another address', async (role) => {
      const token = `Bearer ${authToken(`${role}-1`, role)}`;
      await request(server())
        .patch(`/metadata/notifications/${OTHER_WALLET}/read-all`)
        .set('Authorization', token)
        .expect(403);
      await request(server())
        .patch(`/metadata/notifications/${OTHER_WALLET}/preferences`)
        .set('Authorization', token)
        .send({ disputeFiled: false })
        .expect(403);
      expect(mockNotificationService.markAllAsRead).not.toHaveBeenCalled();
      expect(mockNotificationService.updatePreferences).not.toHaveBeenCalled();
      expect(mockAudit).not.toHaveBeenCalled();
    });
  });
});
