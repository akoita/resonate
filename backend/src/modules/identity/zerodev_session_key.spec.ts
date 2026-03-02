// Mock prisma — must be declared before import due to jest.mock hoisting
jest.mock("../../db/prisma", () => ({
  prisma: {
    sessionKey: {
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    keyAuditLog: {
      create: jest.fn(),
    },
  },
}));

import { prisma } from "../../db/prisma";
import { ZeroDevSessionKeyService } from "./zerodev_session_key.service";

const mockPrismaSessionKey = (prisma as any).sessionKey;

const mockConfig = {
  get: jest.fn(() => undefined),
};

const mockCryptoService = {
  encrypt: jest.fn(async (val: string) => `enc:${val}`),
  decrypt: jest.fn(async (val: string) => val.startsWith('enc:') ? val.slice(4) : val),
  isEnabled: true,
};

const mockKeyAuditService = {
  log: jest.fn(async () => {}),
};

function createService(): ZeroDevSessionKeyService {
  return new (ZeroDevSessionKeyService as any)(mockConfig, mockCryptoService, mockKeyAuditService);
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
  describe("createPendingSession", () => {
    it("should revoke existing keys and create a new one with agent key", async () => {
      mockPrismaSessionKey.updateMany.mockResolvedValue({ count: 1 });
      mockPrismaSessionKey.create.mockResolvedValue({
        id: "sk-1",
        userId: "user-1",
        agentPrivateKey: "0xfake_private_key",
        agentAddress: "0xAgentAddr",
        permissions: samplePermissions,
        validUntil: new Date("2030-01-01"),
        createdAt: new Date(),
      });

      const service = createService();
      const result = await service.createPendingSession(
        "user-1",
        samplePermissions,
        new Date("2030-01-01"),
      );

      // Should revoke all existing active keys first
      expect(mockPrismaSessionKey.updateMany).toHaveBeenCalledWith({
        where: { userId: "user-1", revokedAt: null },
        data: expect.objectContaining({ revokedAt: expect.any(Date) }),
      });

      // Should create the new key with agent key fields
      expect(mockPrismaSessionKey.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: "user-1",
          agentPrivateKey: expect.any(String),
          agentAddress: expect.any(String),
          permissions: samplePermissions,
          validUntil: new Date("2030-01-01"),
        }),
      });

      expect(result.id).toBe("sk-1");
      expect(result.agentAddress).toBeDefined();
    });
  });

  describe("activateSessionKey", () => {
    it("should store approval data on a pending session key", async () => {
      mockPrismaSessionKey.findFirst.mockResolvedValue({
        id: "sk-pending",
        userId: "user-1",
        agentPrivateKey: "0xkey",
        agentAddress: "0xAddr",
        approvalData: null,
      });
      mockPrismaSessionKey.update.mockResolvedValue({
        id: "sk-pending",
        userId: "user-1",
        agentAddress: "0xAddr",
        agentPrivateKey: "0xkey",
        approvalData: "serialized_approval",
        permissions: samplePermissions,
        validUntil: new Date("2030-01-01"),
        txHash: "0xgrant",
        createdAt: new Date(),
      });

      const service = createService();
      const result = await service.activateSessionKey(
        "user-1",
        "serialized_approval",
        "0xgrant",
      );

      expect(result.id).toBe("sk-pending");
      expect(result.agentAddress).toBe("0xAddr");
    });

    it("should throw when no pending session exists", async () => {
      mockPrismaSessionKey.findFirst.mockResolvedValue(null);

      const service = createService();
      await expect(
        service.activateSessionKey("user-missing", "data"),
      ).rejects.toThrow("No pending session key found");
    });
  });

  describe("getActiveSessionKey", () => {
    it("should return the most recent activated, non-revoked, non-expired key", async () => {
      const mockKey = {
        id: "sk-3",
        userId: "user-3",
        agentPrivateKey: "0xkey",
        agentAddress: "0xAddr",
        approvalData: "approval_data",
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
          approvalData: { not: null },
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
        approvalData: "data",
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
        approvalData: "data",
      });

      const service = createService();
      const result = await service.validateSessionKey("user-5");

      expect(result).toEqual({
        valid: true,
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
  });

  describe("getAgentKeyData", () => {
    it("should return the agent key data for sending transactions", async () => {
      mockPrismaSessionKey.findFirst.mockResolvedValue({
        id: "sk-6",
        agentPrivateKey: "0xprivate_key",
        agentAddress: "0xAgentAddr",
        approvalData: "the_approval_data",
        validUntil: new Date("2030-01-01"),
        revokedAt: null,
      });

      const service = createService();
      const result = await service.getAgentKeyData("user-6");

      expect(result).not.toBeNull();
      expect(result!.agentPrivateKey.toString()).toBe("0xprivate_key");
      expect(result!.agentAddress).toBe("0xAgentAddr");
      expect(result!.approvalData).toBe("the_approval_data");

      // Verify zero-after-use pattern
      result!.agentPrivateKey.zero();
      expect(result!.agentPrivateKey.isZeroed).toBe(true);
      expect(() => result!.agentPrivateKey.toString()).toThrow("zeroed");
    });

    it("should return null when no active key", async () => {
      mockPrismaSessionKey.findFirst.mockResolvedValue(null);

      const service = createService();
      const result = await service.getAgentKeyData("user-none");

      expect(result).toBeNull();
    });
  });
});
