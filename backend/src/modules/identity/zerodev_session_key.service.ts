import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { prisma } from '../../db/prisma';
import { SessionKeyService } from './session_key.service';

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
  permissions: SessionKeyPermissions;
  validUntil: Date;
  txHash: string | null;
  createdAt: Date;
}

/**
 * ZeroDevSessionKeyService — Backend-side delegate that RECEIVES and USES
 * session keys granted by the user from the frontend.
 *
 * Self-custodial model:
 * 1. User signs session key grant tx on frontend (holds root key)
 * 2. Frontend sends serialized session key to backend
 * 3. This service stores it and uses it for agent purchases
 * 4. User can revoke on-chain from frontend at any time
 *
 * The backend NEVER holds the root key. It only holds a delegated
 * session key with on-chain constraints.
 */
@Injectable()
export class ZeroDevSessionKeyService {
  private readonly logger = new Logger(ZeroDevSessionKeyService.name);
  private readonly skipBundler: boolean;

  constructor(
    private readonly config: ConfigService,
    private readonly sessionKeyService: SessionKeyService,
  ) {
    this.skipBundler = this.config.get<string>('AA_SKIP_BUNDLER') === 'true';
  }

  /**
   * Register a session key that was created and signed by the user on the frontend.
   * The backend stores it for later use in agent purchases.
   */
  async registerSessionKey(
    userId: string,
    serializedKey: string,
    permissions: SessionKeyPermissions,
    validUntil: Date,
    txHash?: string,
  ): Promise<RegisteredSessionKey> {
    // Revoke any existing active session keys for this user
    await this.revokeAllActive(userId);

    const sessionKey = await prisma.sessionKey.create({
      data: {
        userId,
        serializedKey,
        permissions: permissions as any,
        validUntil,
        txHash: txHash || null,
      },
    });

    this.logger.log(
      `Session key registered for user ${userId} (tx: ${txHash || 'pending'})`,
    );

    return {
      id: sessionKey.id,
      userId: sessionKey.userId,
      permissions,
      validUntil: sessionKey.validUntil,
      txHash: sessionKey.txHash,
      createdAt: sessionKey.createdAt,
    };
  }

  /**
   * Get the active (non-revoked, non-expired) session key for a user.
   */
  async getActiveSessionKey(userId: string) {
    const key = await prisma.sessionKey.findFirst({
      where: {
        userId,
        revokedAt: null,
        validUntil: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });

    return key;
  }

  /**
   * Mark a session key as revoked in the DB.
   * Called after the user signs the on-chain revocation tx on the frontend.
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

    this.logger.log(
      `Session key revoked for user ${userId} (tx: ${revokeTxHash || 'none'})`,
    );
  }

  /**
   * Validate that a user has an active, non-expired session key.
   * Returns the key if valid, null otherwise.
   */
  async validateSessionKey(userId: string) {
    if (this.skipBundler) {
      // In mock mode, delegate to the in-memory SessionKeyService
      return { valid: true, mock: true };
    }

    const key = await this.getActiveSessionKey(userId);
    if (!key) {
      return null;
    }

    return {
      valid: true,
      mock: false,
      id: key.id,
      permissions: key.permissions as unknown as SessionKeyPermissions,
      validUntil: key.validUntil,
      txHash: key.txHash,
    };
  }

  /**
   * Get the serialized session key for creating a session-key-scoped signer.
   * Used by AgentPurchaseService for on-chain purchases.
   */
  async getSerializedKey(userId: string): Promise<string | null> {
    const key = await this.getActiveSessionKey(userId);
    return key?.serializedKey || null;
  }

  /**
   * Revoke all active session keys for a user (used before registering a new one).
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
