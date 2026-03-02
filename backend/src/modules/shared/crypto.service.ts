import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "crypto";

/**
 * CryptoService — Encrypts agent private keys before database storage.
 *
 * Supports three modes via KMS_PROVIDER env var:
 *
 * 1. "local" (default) — AES-256-GCM with a local KEK from AGENT_KEY_ENCRYPTION_KEY env var.
 *    Good for development and staging.
 *
 * 2. "gcp-kms" — Google Cloud KMS. The encryption key lives inside Google's HSM
 *    and NEVER leaves Google's infrastructure. Each encrypt/decrypt call is an
 *    API request to Cloud KMS. The key material is hardware-protected.
 *    Requires: GCP_KMS_KEY_NAME (full resource name of the CryptoKey)
 *
 * 3. No provider — plaintext fallback with warning. Only for initial development.
 *
 * Storage format prefixes:
 *   "enc:"    — locally encrypted (AES-256-GCM, nonce + ciphertext + authTag)
 *   "kms:"    — GCP KMS encrypted (base64 ciphertext from KMS)
 *   "plain:"  — plaintext fallback (no encryption)
 *   <no prefix> — legacy data (pre-encryption, treated as plaintext)
 */
@Injectable()
export class CryptoService implements OnModuleInit {
  private readonly logger = new Logger(CryptoService.name);

  // Local encryption key (for "local" provider)
  private localKek: Buffer | null = null;

  // GCP KMS client (for "gcp-kms" provider)
  private kmsClient: any = null;
  private kmsKeyName: string | null = null;

  // Active provider
  private provider: "local" | "gcp-kms" | "none" = "none";

  private static readonly ALGORITHM = "aes-256-gcm";
  private static readonly NONCE_LENGTH = 12; // 96-bit IV for GCM
  private static readonly TAG_LENGTH = 16;   // 128-bit auth tag

  constructor(private readonly config: ConfigService) {}

  async onModuleInit() {
    const provider = this.config.get<string>("KMS_PROVIDER") || "local";

    if (provider === "gcp-kms") {
      await this.initGcpKms();
    } else if (provider === "local") {
      this.initLocal();
    } else {
      this.logger.warn(
        `Unknown KMS_PROVIDER "${provider}" — falling back to plaintext. ` +
        `Set KMS_PROVIDER to "local" or "gcp-kms".`,
      );
    }
  }

  /**
   * Initialize local AES-256-GCM encryption with env var KEK.
   */
  private initLocal(): void {
    const keyHex = this.config.get<string>("AGENT_KEY_ENCRYPTION_KEY");
    if (!keyHex) {
      this.logger.warn(
        "AGENT_KEY_ENCRYPTION_KEY not set — agent private keys will be stored in PLAINTEXT. " +
        "Set this env var to a 64-character hex string for production use.",
      );
      return;
    }

    if (keyHex.length !== 64) {
      throw new Error(
        `AGENT_KEY_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes). Got ${keyHex.length} characters.`,
      );
    }

    this.localKek = Buffer.from(keyHex, "hex");
    this.provider = "local";
    this.logger.log("Agent key encryption initialized (local AES-256-GCM)");
  }

  /**
   * Initialize GCP Cloud KMS.
   * Requires GCP_KMS_KEY_NAME env var with the full resource name:
   *   projects/{project}/locations/{location}/keyRings/{keyRing}/cryptoKeys/{key}
   *
   * Authentication uses Application Default Credentials (ADC):
   *   - On GCE/GKE/Cloud Run: automatic via metadata server
   *   - Local dev: `gcloud auth application-default login`
   *   - CI: GOOGLE_APPLICATION_CREDENTIALS env var pointing to service account JSON
   */
  private async initGcpKms(): Promise<void> {
    this.kmsKeyName = this.config.get<string>("GCP_KMS_KEY_NAME") || null;

    if (!this.kmsKeyName) {
      throw new Error(
        "KMS_PROVIDER=gcp-kms but GCP_KMS_KEY_NAME is not set. " +
        "Set it to: projects/{project}/locations/{location}/keyRings/{ring}/cryptoKeys/{key}",
      );
    }

    try {
      const { KeyManagementServiceClient } = await import("@google-cloud/kms");
      this.kmsClient = new KeyManagementServiceClient();
      this.provider = "gcp-kms";
      this.logger.log(
        `Agent key encryption initialized (GCP Cloud KMS: ${this.kmsKeyName})`,
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Failed to initialize GCP KMS client: ${msg}. ` +
        `Ensure @google-cloud/kms is installed and credentials are configured.`,
      );
    }
  }

  /**
   * Whether encryption is enabled (any provider active).
   */
  get isEnabled(): boolean {
    return this.provider !== "none";
  }

  /**
   * Get the active provider name.
   */
  get activeProvider(): string {
    return this.provider;
  }

  // ─── Encrypt ─────────────────────────────────────────────

  /**
   * Encrypt a plaintext string.
   * Routes to the active provider.
   */
  async encrypt(plaintext: string): Promise<string> {
    switch (this.provider) {
      case "local":
        return this.encryptLocal(plaintext);
      case "gcp-kms":
        return this.encryptGcpKms(plaintext);
      default:
        return `plain:${plaintext}`;
    }
  }

  /**
   * Local AES-256-GCM encryption.
   * Format: enc:base64(nonce[12] + ciphertext + authTag[16])
   */
  private encryptLocal(plaintext: string): string {
    if (!this.localKek) throw new Error("Local KEK not initialized");

    const nonce = randomBytes(CryptoService.NONCE_LENGTH);
    const cipher = createCipheriv(CryptoService.ALGORITHM, this.localKek, nonce);

    const encrypted = Buffer.concat([
      cipher.update(plaintext, "utf8"),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    const packed = Buffer.concat([nonce, encrypted, authTag]);
    return `enc:${packed.toString("base64")}`;
  }

  /**
   * GCP Cloud KMS encryption.
   * The plaintext is sent to Cloud KMS, which encrypts it with the
   * hardware-backed key (key material never leaves Google's HSM).
   * Format: kms:base64(ciphertext from KMS)
   */
  private async encryptGcpKms(plaintext: string): Promise<string> {
    if (!this.kmsClient || !this.kmsKeyName) {
      throw new Error("GCP KMS client not initialized");
    }

    const [result] = await this.kmsClient.encrypt({
      name: this.kmsKeyName,
      plaintext: Buffer.from(plaintext, "utf8"),
    });

    if (!result.ciphertext) {
      throw new Error("GCP KMS returned empty ciphertext");
    }

    const ciphertextBase64 = Buffer.isBuffer(result.ciphertext)
      ? result.ciphertext.toString("base64")
      : Buffer.from(result.ciphertext as Uint8Array).toString("base64");

    return `kms:${ciphertextBase64}`;
  }

  // ─── Decrypt ─────────────────────────────────────────────

  /**
   * Decrypt an encrypted blob back to plaintext.
   * Auto-detects the encryption format from the prefix.
   */
  async decrypt(encryptedBlob: string): Promise<string> {
    if (encryptedBlob.startsWith("plain:")) {
      return encryptedBlob.slice(6);
    }

    if (encryptedBlob.startsWith("enc:")) {
      return this.decryptLocal(encryptedBlob.slice(4));
    }

    if (encryptedBlob.startsWith("kms:")) {
      return this.decryptGcpKms(encryptedBlob.slice(4));
    }

    // Legacy unencrypted data (no prefix)
    this.logger.warn(
      "Decrypting legacy unencrypted data — re-enable agent wallet to encrypt",
    );
    return encryptedBlob;
  }

  /**
   * Local AES-256-GCM decryption.
   */
  private decryptLocal(base64Data: string): string {
    if (!this.localKek) {
      throw new Error(
        "Cannot decrypt locally: AGENT_KEY_ENCRYPTION_KEY is not set but data is locally encrypted",
      );
    }

    const packed = Buffer.from(base64Data, "base64");

    if (packed.length < CryptoService.NONCE_LENGTH + CryptoService.TAG_LENGTH) {
      throw new Error("Invalid encrypted data: too short");
    }

    const nonce = packed.subarray(0, CryptoService.NONCE_LENGTH);
    const authTag = packed.subarray(packed.length - CryptoService.TAG_LENGTH);
    const ciphertext = packed.subarray(
      CryptoService.NONCE_LENGTH,
      packed.length - CryptoService.TAG_LENGTH,
    );

    const decipher = createDecipheriv(CryptoService.ALGORITHM, this.localKek, nonce);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);

    return decrypted.toString("utf8");
  }

  /**
   * GCP Cloud KMS decryption.
   * The ciphertext is sent to Cloud KMS for decryption by the HSM.
   */
  private async decryptGcpKms(base64Data: string): Promise<string> {
    if (!this.kmsClient || !this.kmsKeyName) {
      throw new Error(
        "Cannot decrypt with GCP KMS: KMS client not initialized but data is KMS-encrypted",
      );
    }

    const ciphertext = Buffer.from(base64Data, "base64");

    const [result] = await this.kmsClient.decrypt({
      name: this.kmsKeyName,
      ciphertext,
    });

    if (!result.plaintext) {
      throw new Error("GCP KMS returned empty plaintext");
    }

    return Buffer.isBuffer(result.plaintext)
      ? result.plaintext.toString("utf8")
      : Buffer.from(result.plaintext as Uint8Array).toString("utf8");
  }
}
