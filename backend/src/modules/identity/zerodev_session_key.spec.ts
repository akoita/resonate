// Mock prisma — must be declared before import due to jest.mock hoisting
jest.mock("../../db/prisma", () => ({
  prisma: {
    sessionKey: {
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
  },
}));

import { prisma } from "../../db/prisma";
import { ZeroDevSessionKeyService } from "./zerodev_session_key.service";

const mockPrismaSessionKey = (prisma as any).sessionKey;

const mockConfig = {
  get: jest.fn((key: string) => {
    if (key === "AA_SKIP_BUNDLER") return "false";
    return undefined;
  }),
};

const mockSessionKeyService = {
  issue: jest.fn(),
  validate: jest.fn(),
  revoke: jest.fn(),
};

function createService(): ZeroDevSessionKeyService {
  return new (ZeroDevSessionKeyService as any)(mockConfig, mockSessionKeyService);
}

const samplePermissions = {
  target: "0xMarketplace",
  function: "buy(uint256,uint256)",
  totalCapWei: "1000000000000000000",
  perTxCapWei: "100000000000000000",
  rateLimit: 10,
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe("ZeroDevSessionKeyService", () => {
  describe("registerSessionKey", () => {
    it("should revoke existing keys and create a new one", async () => {
      mockPrismaSessionKey.updateMany.mockResolvedValue({ count: 1 });
      mockPrismaSessionKey.create.mockResolvedValue({
        id: "sk-1",
        userId: "user-1",
        serializedKey: "ser_key_data",
        permissions: samplePermissions,
        validUntil: new Date("2030-01-01"),
        txHash: "0xabc",
        createdAt: new Date(),
      });

      const service = createService();
      const result = await service.registerSessionKey(
        "user-1",
        "ser_key_data",
        samplePermissions,
        new Date("2030-01-01"),
        "0xabc",
      );

      // Should revoke all existing active keys first
      expect(mockPrismaSessionKey.updateMany).toHaveBeenCalledWith({
        where: { userId: "user-1", revokedAt: null },
        data: expect.objectContaining({ revokedAt: expect.any(Date) }),
      });

      // Should create the new key
      expect(mockPrismaSessionKey.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: "user-1",
          serializedKey: "ser_key_data",
          validUntil: new Date("2030-01-01"),
          txHash: "0xabc",
        }),
      });

      expect(result.id).toBe("sk-1");
      expect(result.permissions).toEqual(samplePermissions);
    });

    it("should handle missing txHash", async () => {
      mockPrismaSessionKey.updateMany.mockResolvedValue({ count: 0 });
      mockPrismaSessionKey.create.mockResolvedValue({
        id: "sk-2",
        userId: "user-2",
        serializedKey: "data",
        permissions: samplePermissions,
        validUntil: new Date("2030-01-01"),
        txHash: null,
        createdAt: new Date(),
      });

      const service = createService();
      const result = await service.registerSessionKey(
        "user-2",
        "data",
        samplePermissions,
        new Date("2030-01-01"),
        // no txHash
      );

      expect(result.txHash).toBeNull();
    });
  });

  describe("getActiveSessionKey", () => {
    it("should return the most recent non-revoked, non-expired key", async () => {
      const mockKey = {
        id: "sk-3",
        userId: "user-3",
        serializedKey: "key_data",
        validUntil: new Date("2030-01-01"),
        revokedAt: null,
      };
      mockPrismaSessionKey.findFirst.mockResolvedValue(mockKey);

      const service = createService();
      const result = await service.getActiveSessionKey("user-3");

      expect(result).toEqual(mockKey);
      expect(mockPrismaSessionKey.findFirst).toHaveBeenCalledWith({
        where: {
          userId: "user-3",
          revokedAt: null,
          validUntil: { gt: expect.any(Date) },
        },
        orderBy: { createdAt: "desc" },
      });
    });

    it("should return null when no active key exists", async () => {
      mockPrismaSessionKey.findFirst.mockResolvedValue(null);

      const service = createService();
      const result = await service.getActiveSessionKey("user-none");

      expect(result).toBeNull();
    });
  });

  describe("markRevoked", () => {
    it("should mark the active key as revoked with txHash", async () => {
      mockPrismaSessionKey.findFirst.mockResolvedValue({
        id: "sk-4",
        userId: "user-4",
      });
      mockPrismaSessionKey.update.mockResolvedValue({});

      const service = createService();
      await service.markRevoked("user-4", "0xrevoke_hash");

      expect(mockPrismaSessionKey.update).toHaveBeenCalledWith({
        where: { id: "sk-4" },
        data: {
          revokedAt: expect.any(Date),
          revokeTxHash: "0xrevoke_hash",
        },
      });
    });

    it("should not fail when no active key exists", async () => {
      mockPrismaSessionKey.findFirst.mockResolvedValue(null);

      const service = createService();
      await expect(service.markRevoked("user-none")).resolves.toBeUndefined();
      expect(mockPrismaSessionKey.update).not.toHaveBeenCalled();
    });
  });

  describe("validateSessionKey", () => {
    it("should return valid key data when active key exists", async () => {
      mockPrismaSessionKey.findFirst.mockResolvedValue({
        id: "sk-5",
        validUntil: new Date("2030-01-01"),
        txHash: "0xtx",
        permissions: samplePermissions,
      });

      const service = createService();
      const result = await service.validateSessionKey("user-5");

      expect(result).toEqual({
        valid: true,
        mock: false,
        id: "sk-5",
        permissions: samplePermissions,
        validUntil: new Date("2030-01-01"),
        txHash: "0xtx",
      });
    });

    it("should return null when no active key", async () => {
      mockPrismaSessionKey.findFirst.mockResolvedValue(null);

      const service = createService();
      const result = await service.validateSessionKey("user-none");

      expect(result).toBeNull();
    });

    it("should return mock valid when skipBundler is true", async () => {
      const mockConfigSkip = {
        get: jest.fn((key: string) => {
          if (key === "AA_SKIP_BUNDLER") return "true";
          return undefined;
        }),
      };
      const service = new (ZeroDevSessionKeyService as any)(
        mockConfigSkip,
        mockSessionKeyService,
      );

      const result = await service.validateSessionKey("user-any");
      expect(result).toEqual({ valid: true, mock: true });
    });
  });

  describe("getSerializedKey", () => {
    it("should return the serialized key data", async () => {
      mockPrismaSessionKey.findFirst.mockResolvedValue({
        id: "sk-6",
        serializedKey: "the_serialized_key",
        validUntil: new Date("2030-01-01"),
        revokedAt: null,
      });

      const service = createService();
      const result = await service.getSerializedKey("user-6");

      expect(result).toBe("the_serialized_key");
    });

    it("should return null when no active key", async () => {
      mockPrismaSessionKey.findFirst.mockResolvedValue(null);

      const service = createService();
      const result = await service.getSerializedKey("user-none");

      expect(result).toBeNull();
    });
  });
});
