import { CryptoService } from "./crypto.service";

function createLocalService(keyHex?: string): CryptoService {
  const mockConfig = {
    get: jest.fn((key: string) => {
      if (key === "AGENT_KEY_ENCRYPTION_KEY") return keyHex;
      if (key === "KMS_PROVIDER") return "local";
      return undefined;
    }),
  };
  const service = new (CryptoService as any)(mockConfig);
  // initLocal is sync so we can call onModuleInit synchronously for "local" provider
  (service as any).initLocal();
  return service;
}

function createNoKeyService(): CryptoService {
  const mockConfig = {
    get: jest.fn(() => undefined),
  };
  return new (CryptoService as any)(mockConfig);
  // Don't call init — provider stays "none"
}

describe("CryptoService", () => {
  // Valid 32-byte key (64 hex chars)
  const TEST_KEY = "a1b2c3d4e5f6071829304050607080901a2b3c4d5e6f071829304050607080ab";

  describe("local provider", () => {
    it("should encrypt and decrypt a string correctly", async () => {
      const service = createLocalService(TEST_KEY);
      const plaintext = "0xdeadbeef1234567890abcdef";

      const encrypted = await service.encrypt(plaintext);
      expect(encrypted).toMatch(/^enc:/);
      expect(encrypted).not.toContain(plaintext);

      const decrypted = await service.decrypt(encrypted);
      expect(decrypted).toBe(plaintext);
    });

    it("should produce different ciphertexts for the same plaintext (random nonce)", async () => {
      const service = createLocalService(TEST_KEY);
      const plaintext = "same-input";

      const enc1 = await service.encrypt(plaintext);
      const enc2 = await service.encrypt(plaintext);

      expect(enc1).not.toBe(enc2); // Different nonces
      expect(await service.decrypt(enc1)).toBe(plaintext);
      expect(await service.decrypt(enc2)).toBe(plaintext);
    });

    it("should reject tampered ciphertext (GCM auth tag)", async () => {
      const service = createLocalService(TEST_KEY);
      const encrypted = await service.encrypt("secret");

      const parts = encrypted.split(":");
      const corrupted = "enc:" + parts[1].slice(0, -4) + "AAAA";

      await expect(service.decrypt(corrupted)).rejects.toThrow();
    });

    it("should handle empty string", async () => {
      const service = createLocalService(TEST_KEY);
      const encrypted = await service.encrypt("");
      expect(await service.decrypt(encrypted)).toBe("");
    });

    it("should handle long private keys", async () => {
      const service = createLocalService(TEST_KEY);
      const longKey = "0x" + "ab".repeat(64);

      const encrypted = await service.encrypt(longKey);
      expect(await service.decrypt(encrypted)).toBe(longKey);
    });

    it("should report isEnabled as true", () => {
      const service = createLocalService(TEST_KEY);
      expect(service.isEnabled).toBe(true);
      expect(service.activeProvider).toBe("local");
    });
  });

  describe("no encryption", () => {
    it("should store with plain: prefix when no key is set", async () => {
      const service = createNoKeyService();
      const result = await service.encrypt("0xprivatekey");
      expect(result).toBe("plain:0xprivatekey");
    });

    it("should decrypt plain: prefixed data", async () => {
      const service = createNoKeyService();
      const result = await service.decrypt("plain:0xprivatekey");
      expect(result).toBe("0xprivatekey");
    });

    it("should handle legacy data without prefix", async () => {
      const service = createNoKeyService();
      const result = await service.decrypt("0xlegacy_raw_key");
      expect(result).toBe("0xlegacy_raw_key");
    });

    it("should report isEnabled as false", () => {
      const service = createNoKeyService();
      expect(service.isEnabled).toBe(false);
    });

    it("should throw on enc: data when local key is not set", async () => {
      const serviceWithKey = createLocalService(TEST_KEY);
      const encrypted = await serviceWithKey.encrypt("secret");

      const serviceNoKey = createNoKeyService();
      await expect(serviceNoKey.decrypt(encrypted)).rejects.toThrow(
        "Cannot decrypt locally",
      );
    });
  });

  describe("key validation", () => {
    it("should throw on invalid key length", () => {
      expect(() => createLocalService("tooshort")).toThrow(
        "must be exactly 64 hex characters",
      );
    });
  });

  describe("cross-provider decryption", () => {
    it("should decrypt locally-encrypted data", async () => {
      const service = createLocalService(TEST_KEY);
      const encrypted = await service.encrypt("secret");
      expect(encrypted).toMatch(/^enc:/);
      expect(await service.decrypt(encrypted)).toBe("secret");
    });

    it("should reject kms: prefixed data when KMS is not configured", async () => {
      const service = createLocalService(TEST_KEY);
      await expect(service.decrypt("kms:somedata")).rejects.toThrow(
        "KMS client not initialized",
      );
    });
  });
});
