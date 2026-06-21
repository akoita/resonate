/**
 * EncryptionService.decryptForRender (#1214) — unit (no DB, no containers).
 *
 * The strict, in-memory decryption boundary the remix worker uses to turn an
 * eligible encrypted stem into plaintext for rendering. It must:
 *   - decrypt genuine ciphertext for the authorized internal purpose;
 *   - fail closed (never return ciphertext) on missing/invalid metadata,
 *     missing internal key, access denial, or corrupt ciphertext;
 *   - never write plaintext to the on-disk decrypted cache.
 */

import { existsSync, readdirSync } from "fs";
import { join } from "path";
import { ConfigService } from "@nestjs/config";
import {
  EncryptionService,
  RenderDecryptionError,
} from "../modules/encryption/encryption.service";
import { AesEncryptionProvider } from "../modules/encryption/providers/aes_encryption_provider";
import { NoopEncryptionProvider } from "../modules/encryption/providers/noop_encryption_provider";

const INTERNAL_KEY = "test-internal-key-1214";
const ENCRYPTION_SECRET = "test-encryption-secret-1214";

function configWith(env: Record<string, string | undefined>): ConfigService {
  return { get: (key: string) => env[key] } as unknown as ConfigService;
}

const RENDER_AUTH = {
  address: "0x0000000000000000000000000000000000000000",
  sig: "remix-render-authorized",
  signedMessage: "Remix render decryption authorization",
  internalKey: INTERNAL_KEY,
};

async function aesEncrypt(
  provider: AesEncryptionProvider,
  contentId: string,
  data: Buffer,
) {
  const payload = await provider.encrypt(data, {
    contentId,
    ownerAddress: "0x000000000000000000000000000000000000dEaD",
    allowedAddresses: [],
  });
  return { ciphertext: payload!.encryptedData, metadata: payload!.metadata };
}

describe("EncryptionService.decryptForRender (#1214)", () => {
  const env = {
    ENCRYPTION_SECRET,
    INTERNAL_SERVICE_KEY: INTERNAL_KEY,
    NODE_ENV: "test",
  };
  const config = configWith(env);
  const provider = new AesEncryptionProvider(config);
  const service = new EncryptionService(provider, config);
  const cacheDir = join(process.cwd(), "uploads", "decrypted_cache");

  function cacheFileCount(): number {
    if (!existsSync(cacheDir)) return 0;
    return readdirSync(cacheDir).length;
  }

  it("decrypts genuine ciphertext for the authorized internal purpose", async () => {
    const plaintext = Buffer.from("the real stem audio bytes");
    const { ciphertext, metadata } = await aesEncrypt(provider, "stem-a", plaintext);

    const result = await service.decryptForRender(ciphertext, metadata, RENDER_AUTH);

    expect(result.equals(plaintext)).toBe(true);
    // Decryption actually transformed the bytes.
    expect(result.equals(ciphertext)).toBe(false);
  });

  it("does not write plaintext to the decrypted cache", async () => {
    const { ciphertext, metadata } = await aesEncrypt(
      provider,
      "stem-no-cache",
      Buffer.from("secret audio"),
    );
    const before = cacheFileCount();
    await service.decryptForRender(ciphertext, metadata, RENDER_AUTH);
    expect(cacheFileCount()).toBe(before);
  });

  it("fails closed on empty/missing metadata", async () => {
    const { ciphertext } = await aesEncrypt(
      provider,
      "stem-b",
      Buffer.from("audio"),
    );
    await expect(
      service.decryptForRender(ciphertext, "", RENDER_AUTH),
    ).rejects.toMatchObject({ reason: "invalid_metadata" });
    await expect(
      service.decryptForRender(ciphertext, "{}", RENDER_AUTH),
    ).rejects.toBeInstanceOf(RenderDecryptionError);
  });

  it("fails closed on non-AES metadata (missing iv/authTag/keyId)", async () => {
    const { ciphertext } = await aesEncrypt(
      provider,
      "stem-c",
      Buffer.from("audio"),
    );
    await expect(
      service.decryptForRender(
        ciphertext,
        JSON.stringify({ scheme: "lit" }),
        RENDER_AUTH,
      ),
    ).rejects.toMatchObject({ reason: "invalid_metadata" });
  });

  it("denies access when the internal key is missing", async () => {
    const { ciphertext, metadata } = await aesEncrypt(
      provider,
      "stem-d",
      Buffer.from("audio"),
    );
    await expect(
      service.decryptForRender(ciphertext, metadata, {
        ...RENDER_AUTH,
        internalKey: undefined,
      }),
    ).rejects.toMatchObject({ reason: "unauthorized" });
  });

  it("denies access when the internal key is wrong", async () => {
    const { ciphertext, metadata } = await aesEncrypt(
      provider,
      "stem-e",
      Buffer.from("audio"),
    );
    await expect(
      service.decryptForRender(ciphertext, metadata, {
        ...RENDER_AUTH,
        internalKey: "not-the-key",
      }),
    ).rejects.toMatchObject({ reason: "unauthorized" });
  });

  it("maps corrupt ciphertext to a decryption failure (never returns it)", async () => {
    const { metadata } = await aesEncrypt(provider, "stem-f", Buffer.from("audio"));
    const corrupt = Buffer.from("not the original ciphertext at all");
    await expect(
      service.decryptForRender(corrupt, metadata, RENDER_AUTH),
    ).rejects.toMatchObject({ reason: "decryption_failed" });
  });

  it("fails closed when encryption is disabled (provider 'none')", async () => {
    const noopService = new EncryptionService(
      new NoopEncryptionProvider(),
      config,
    );
    await expect(
      noopService.decryptForRender(
        Buffer.from("ciphertext"),
        JSON.stringify({ iv: "0", authTag: "0", keyId: "x" }),
        RENDER_AUTH,
      ),
    ).rejects.toMatchObject({ reason: "encryption_disabled" });
  });
});
