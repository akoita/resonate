/**
 * NotificationService.getNotificationWalletAddress — Integration Test (Testcontainers)
 *
 * The mark-as-read route resolves a notification's owning wallet before
 * marking it read, so it can answer 404 for notifications the caller does
 * not own. Runs against real Postgres.
 *
 * Run: npm run test:integration
 */

import { prisma } from "../db/prisma";
import { EventBus } from "../modules/shared/event_bus";
import { NotificationService } from "../modules/notifications/notification.service";

const PREFIX = `notifowner_${Date.now()}_`;
const WALLET = `0x${Date.now().toString(16).padStart(40, "d")}`.slice(0, 42);

describe("NotificationService.getNotificationWalletAddress (integration)", () => {
  const service = new NotificationService(new EventBus());

  beforeAll(async () => {
    await prisma.notification.create({
      data: {
        id: `${PREFIX}notif`,
        walletAddress: WALLET,
        type: "dispute_filed",
        title: "Test",
        message: "Test notification",
      },
    });
  });

  afterAll(async () => {
    await prisma.notification.deleteMany({ where: { id: { startsWith: PREFIX } } }).catch(() => {});
    await prisma.$disconnect();
  });

  it("returns the owning wallet address for an existing notification", async () => {
    await expect(service.getNotificationWalletAddress(`${PREFIX}notif`)).resolves.toBe(WALLET);
  });

  it("returns null for an unknown id", async () => {
    await expect(service.getNotificationWalletAddress(`${PREFIX}missing`)).resolves.toBeNull();
  });
});
