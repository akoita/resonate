import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { prisma } from '../../db/prisma';
import { CryptoService } from '../shared/crypto.service';
import { KeyAuditService } from '../shared/key_audit.service';
import { SensitiveBuffer } from '../shared/sensitive_buffer';

/**
 * Session key permissions as granted by the user on-chain.
 * These are the on-chain policies enforced by the smart account.
 */
export interface SessionKeyPermissions {
  target: string;       // Contract address (e.g., StemMarketplaceV2)
  function: string;     // Function selector (e.g., buy(uint256,uint256))
  totalCapWei: string;  // Monthly spending cap in wei
  perTxCapWei: string;  // Per-transaction cap in wei
  rateLimit: number;    // Max transactions per hour
}

export interface RegisteredSessionKey {
  id: string;
  userId: string;
  agentAddress: string;
  permissions: SessionKeyPermissions;
  validUntil: Date;
  txHash: string | null;
  createdAt: Date;
}

/**
 * AgentKeyData — Decrypted key material returned from getAgentKeyData().
 * The agentPrivateKey is wrapped in a SensitiveBuffer that MUST be zeroed
 * after use via the zero() method.
 */
export interface AgentKeyData {
  agentPrivateKey: SensitiveBuffer;
  agentAddress: string;
  approvalData: string;
}

/**
 * ZeroDevSessionKeyService — Agent-owned session key management.
 *
 * Security measures:
 * - Private key encrypted at rest (AES-256-GCM or GCP KMS)
 * - Decrypted key returned as SensitiveBuffer (zero after use)
 * - All key accesses audit-logged (who, when, what)
 * - Key rotation supported (new key + revoke old)
 */
@Injectable()
export class ZeroDevSessionKeyService {
  private readonly logger = new Logger(ZeroDevSessionKeyService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly cryptoService: CryptoService,
    private readonly keyAuditService: KeyAuditService,
  ) {}

  /**
   * Generate a new agent keypair for a user.
   */
  async generateAgentKey(userId: string): Promise<{ agentAddress: string; agentPrivateKey: string }> {
    const { generatePrivateKey, privateKeyToAccount } = await import('viem/accounts');

    const agentPrivateKey = generatePrivateKey();
    const agentAccount = privateKeyToAccount(agentPrivateKey);
    const agentAddress = agentAccount.address;

    this.logger.log(
      `Generated agent key for user ${userId}: ${agentAddress}`,
    );

    return { agentAddress, agentPrivateKey };
  }

  /**
   * Get the agent's public address for a user.
   */
  async getOrCreateAgentAddress(userId: string): Promise<string> {
    const existing = await prisma.sessionKey.findFirst({
      where: {
        userId,
        revokedAt: null,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (existing) {
      return existing.agentAddress;
    }

    const { agentAddress } = await this.generateAgentKey(userId);
    return agentAddress;
  }

  /**
   * Create a session key record with the agent's keypair.
   * Called during enable — before the user has signed the approval.
   */
  async createPendingSession(
    userId: string,
    permissions: SessionKeyPermissions,
    validUntil: Date,
  ): Promise<{ id: string; agentAddress: string; agentPrivateKey: string }> {
    // Revoke any existing active session keys
    await this.revokeAllActive(userId);

    const { agentAddress, agentPrivateKey } = await this.generateAgentKey(userId);

    // Encrypt the private key before storing in DB
    const encryptedKey = await this.cryptoService.encrypt(agentPrivateKey);

    const sessionKey = await prisma.sessionKey.create({
      data: {
        userId,
        agentPrivateKey: encryptedKey,
        agentAddress,
        permissions: permissions as any,
        validUntil,
      },
    });

    // Audit: key created
    await this.keyAuditService.log(userId, 'enable', { agentAddress });

    this.logger.log(
      `Created pending session key for user ${userId} (agent: ${agentAddress}, encrypted: ${this.cryptoService.isEnabled})`,
    );

    return {
      id: sessionKey.id,
      agentAddress,
      agentPrivateKey,
    };
  }

  /**
   * Activate a session key after the user signs the approval on-chain.
   */
  async activateSessionKey(
    userId: string,
    approvalData: string,
    txHash?: string,
  ): Promise<RegisteredSessionKey> {
    const pending = await prisma.sessionKey.findFirst({
      where: {
        userId,
        revokedAt: null,
        approvalData: null,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!pending) {
      throw new Error('No pending session key found — call enable first');
    }

    const updated = await prisma.sessionKey.update({
      where: { id: pending.id },
      data: {
        approvalData,
        txHash: txHash || null,
      },
    });

    // Audit: session key activated
    await this.keyAuditService.log(userId, 'activate', {
      agentAddress: updated.agentAddress,
      txHash: txHash || null,
    });

    this.logger.log(
      `Session key activated for user ${userId} (agent: ${updated.agentAddress}, tx: ${txHash || 'none'})`,
    );

    return {
      id: updated.id,
      userId: updated.userId,
      agentAddress: updated.agentAddress,
      permissions: updated.permissions as unknown as SessionKeyPermissions,
      validUntil: updated.validUntil,
      txHash: updated.txHash,
      createdAt: updated.createdAt,
    };
  }

  /**
   * Get the active (non-revoked, non-expired, activated) session key for a user.
   */
  async getActiveSessionKey(userId: string) {
    const key = await prisma.sessionKey.findFirst({
      where: {
        userId,
        revokedAt: null,
        approvalData: { not: null },
        validUntil: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });

    return key;
  }

  /**
   * Mark a session key as revoked in the DB.
   */
  async markRevoked(userId: string, revokeTxHash?: string): Promise<void> {
    const activeKey = await this.getActiveSessionKey(userId);
    if (!activeKey) {
      this.logger.warn(`No active session key to revoke for user ${userId}`);
      return;
    }

    await prisma.sessionKey.update({
      where: { id: activeKey.id },
      data: {
        revokedAt: new Date(),
        revokeTxHash: revokeTxHash || null,
      },
    });

    // Audit: key revoked
    await this.keyAuditService.log(userId, 'revoke', {
      agentAddress: activeKey.agentAddress,
      revokeTxHash: revokeTxHash || null,
    });

    this.logger.log(
      `Session key revoked for user ${userId} (tx: ${revokeTxHash || 'none'})`,
    );
  }

  /**
   * Validate that a user has an active, non-expired session key.
   */
  async validateSessionKey(userId: string) {
    const key = await this.getActiveSessionKey(userId);
    if (!key) {
      return null;
    }

    return {
      valid: true,
      id: key.id,
      permissions: key.permissions as unknown as SessionKeyPermissions,
      validUntil: key.validUntil,
      txHash: key.txHash,
    };
  }

  /**
   * Get the agent's private key and approval data for sending transactions.
   *
   * IMPORTANT: The returned SensitiveBuffer MUST be zeroed after use:
   *   const keyData = await service.getAgentKeyData(userId);
   *   try {
   *     await sign(keyData.agentPrivateKey.toString());
   *   } finally {
   *     keyData.agentPrivateKey.zero();
   *   }
   */
  async getAgentKeyData(userId: string): Promise<AgentKeyData | null> {
    const key = await this.getActiveSessionKey(userId);
    if (!key || !key.approvalData) return null;

    // Decrypt the private key from DB storage
    const decryptedKey = await this.cryptoService.decrypt(key.agentPrivateKey);

    // Wrap in SensitiveBuffer for zero-after-use
    const sensitiveKey = new SensitiveBuffer(decryptedKey);

    // Audit: key decrypted for transaction signing
    await this.keyAuditService.log(userId, 'decrypt', {
      agentAddress: key.agentAddress,
      reason: 'transaction_signing',
    });

    return {
      agentPrivateKey: sensitiveKey,
      agentAddress: key.agentAddress,
      approvalData: key.approvalData,
    };
  }

  /**
   * Rotate the agent's key — generates a new keypair, revokes the old one.
   * Returns the new agent address; frontend must re-approve permissions.
   */
  async rotateAgentKey(
    userId: string,
    permissions: SessionKeyPermissions,
    validityHours: number = 24,
  ): Promise<{ agentAddress: string; oldAgentAddress: string | null }> {
    // Get old key info for audit
    const oldKey = await this.getActiveSessionKey(userId);
    const oldAgentAddress = oldKey?.agentAddress || null;

    // Revoke old key + create new one (createPendingSession handles both)
    const validUntil = new Date(Date.now() + validityHours * 60 * 60 * 1000);
    const { agentAddress } = await this.createPendingSession(
      userId,
      permissions,
      validUntil,
    );

    // Audit: key rotated
    await this.keyAuditService.log(userId, 'rotate', {
      agentAddress,
      oldAgentAddress,
      reason: 'manual_rotation',
    });

    this.logger.log(
      `Key rotated for user ${userId}: ${oldAgentAddress || 'none'} → ${agentAddress}`,
    );

    return { agentAddress, oldAgentAddress };
  }

  /**
   * Revoke all active session keys for a user.
   */
  private async revokeAllActive(userId: string): Promise<void> {
    await prisma.sessionKey.updateMany({
      where: {
        userId,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });
  }
}
