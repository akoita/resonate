import { NotificationService } from "./notification.service";
import { EventBus } from "../shared/event_bus";
import { Subject } from "rxjs";

// ─── mocks ──────────────────────────────────────────────

const mockEventBus = {
  subscribe: jest.fn().mockReturnValue({ unsubscribe: jest.fn() }),
  publish: jest.fn(),
} as unknown as EventBus;

// Mock Prisma
jest.mock("@prisma/client", () => {
  const mockNotification = {
    create: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  };
  const mockPreference = {
    findUnique: jest.fn(),
    upsert: jest.fn(),
  };
  const mockDispute = {
    findFirst: jest.fn(),
  };
  return {
    PrismaClient: jest.fn().mockImplementation(() => ({
      notification: mockNotification,
      notificationPreference: mockPreference,
      dispute: mockDispute,
    })),
    __mockNotification: mockNotification,
    __mockPreference: mockPreference,
    __mockDispute: mockDispute,
  };
});

// Get mock references
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { __mockNotification, __mockPreference } = require("@prisma/client");

function createService(): NotificationService {
  return new NotificationService(mockEventBus);
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("NotificationService", () => {
  describe("createNotification", () => {
    it("should persist notification and emit event", async () => {
      __mockPreference.findUnique.mockResolvedValue(null); // no prefs = all enabled
      __mockNotification.create.mockResolvedValue({
        id: "notif-1",
        walletAddress: "0xabc",
        type: "dispute_filed",
        title: "Content Flagged",
        message: "Your content has been flagged.",
      });

      const service = createService();
      service.onModuleInit(); // subscribe to events
      const result = await service.createNotification({
        walletAddress: "0xabc",
        type: "dispute_filed",
        title: "Content Flagged",
        message: "Your content has been flagged.",
        disputeId: "d-1",
      });

      expect(result).toBeTruthy();
      expect(__mockNotification.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          walletAddress: "0xabc",
          type: "dispute_filed",
        }),
      });
      expect(mockEventBus.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          eventName: "notification.created",
          walletAddress: "0xabc",
          type: "dispute_filed",
        }),
      );
    });

    it("should skip notification when preference is disabled", async () => {
      __mockPreference.findUnique.mockResolvedValue({
        walletAddress: "0xabc",
        disputeFiled: false, // disabled
        disputeResolved: true,
        disputeAppealed: true,
        evidenceSubmitted: true,
      });

      const service = createService();
      service.onModuleInit();
      const result = await service.createNotification({
        walletAddress: "0xabc",
        type: "dispute_filed",
        title: "Content Flagged",
        message: "Your content has been flagged.",
      });

      expect(result).toBeNull();
      expect(__mockNotification.create).not.toHaveBeenCalled();
      expect(mockEventBus.publish).not.toHaveBeenCalled();
    });
  });

  describe("getNotifications", () => {
    it("should fetch paginated notifications", async () => {
      __mockNotification.findMany.mockResolvedValue([
        { id: "1", type: "dispute_filed", read: false },
        { id: "2", type: "dispute_resolved", read: true },
      ]);

      const service = createService();
      const result = await service.getNotifications("0xabc", 20, 0);

      expect(__mockNotification.findMany).toHaveBeenCalledWith({
        where: { walletAddress: "0xabc" },
        orderBy: { createdAt: "desc" },
        take: 20,
        skip: 0,
      });
      expect(result).toHaveLength(2);
    });
  });

  describe("getUnreadCount", () => {
    it("should return unread count", async () => {
      __mockNotification.count.mockResolvedValue(3);

      const service = createService();
      const result = await service.getUnreadCount("0xabc");

      expect(__mockNotification.count).toHaveBeenCalledWith({
        where: { walletAddress: "0xabc", read: false },
      });
      expect(result).toBe(3);
    });
  });

  describe("markAsRead", () => {
    it("should mark notification as read", async () => {
      __mockNotification.update.mockResolvedValue({ id: "notif-1", read: true });

      const service = createService();
      const result = await service.markAsRead("notif-1");

      expect(__mockNotification.update).toHaveBeenCalledWith({
        where: { id: "notif-1" },
        data: { read: true },
      });
      expect(result.read).toBe(true);
    });
  });

  describe("markAllAsRead", () => {
    it("should mark all unread notifications as read", async () => {
      __mockNotification.updateMany.mockResolvedValue({ count: 5 });

      const service = createService();
      const result = await service.markAllAsRead("0xabc");

      expect(__mockNotification.updateMany).toHaveBeenCalledWith({
        where: { walletAddress: "0xabc", read: false },
        data: { read: true },
      });
      expect(result.count).toBe(5);
    });
  });

  describe("preferences", () => {
    it("should upsert default preferences on get", async () => {
      __mockPreference.upsert.mockResolvedValue({
        walletAddress: "0xabc",
        disputeFiled: true,
        disputeResolved: true,
        disputeAppealed: true,
        evidenceSubmitted: true,
      });

      const service = createService();
      const result = await service.getPreferences("0xabc");

      expect(__mockPreference.upsert).toHaveBeenCalledWith({
        where: { walletAddress: "0xabc" },
        create: { walletAddress: "0xabc" },
        update: {},
      });
      expect(result.disputeFiled).toBe(true);
    });

    it("should update specific preferences", async () => {
      __mockPreference.upsert.mockResolvedValue({
        walletAddress: "0xabc",
        disputeFiled: false,
        disputeResolved: true,
        disputeAppealed: true,
        evidenceSubmitted: true,
      });

      const service = createService();
      const result = await service.updatePreferences("0xabc", { disputeFiled: false });

      expect(__mockPreference.upsert).toHaveBeenCalledWith({
        where: { walletAddress: "0xabc" },
        create: { walletAddress: "0xabc", disputeFiled: false },
        update: { disputeFiled: false },
      });
      expect(result.disputeFiled).toBe(false);
    });
  });

  describe("event subscriptions", () => {
    it("should subscribe to 3 dispute events on init", () => {
      const service = createService();
      service.onModuleInit();

      expect(mockEventBus.subscribe).toHaveBeenCalledWith(
        "contract.dispute_filed",
        expect.any(Function),
      );
      expect(mockEventBus.subscribe).toHaveBeenCalledWith(
        "contract.dispute_resolved",
        expect.any(Function),
      );
      expect(mockEventBus.subscribe).toHaveBeenCalledWith(
        "contract.dispute_appealed",
        expect.any(Function),
      );
    });
  });

  describe("cleanup", () => {
    it("should unsubscribe all on destroy", () => {
      const service = createService();
      service.onModuleInit();
      service.onModuleDestroy();

      // 3 subscriptions from init
      expect(mockEventBus.subscribe).toHaveBeenCalledTimes(3);
    });
  });
});
