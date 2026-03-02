import { Injectable, Logger } from "@nestjs/common";
import { prisma } from "../../db/prisma";

/**
 * Audit actions for key access tracking.
 */
export type KeyAuditAction =
  | "decrypt"     // Private key decrypted from DB
  | "sign"        // Key used to sign a transaction
  | "rotate"      // Key was rotated (new key generated)
  | "revoke"      // Key was revoked
  | "enable"      // Key was created/enabled
  | "activate";   // Session key was activated with approval data

/**
 * KeyAuditService — Append-only audit log for all agent key operations.
 *
 * Every time a private key is decrypted, used for signing, rotated, or revoked,
 * a log entry is written. This creates an immutable trail of:
 *   WHO accessed the key (userId)
 *   WHAT they did (action)
 *   WHEN it happened (createdAt)
 *   WHY / context (listingId, txHash, agentAddress, etc.)
 */
@Injectable()
export class KeyAuditService {
  private readonly logger = new Logger(KeyAuditService.name);

  /**
   * Log an audit event for key access.
   *
   * @param userId - The user whose key was accessed
   * @param action - What operation was performed
   * @param context - Additional metadata (agent address, tx hash, listing ID, etc.)
   */
  async log(
    userId: string,
    action: KeyAuditAction,
    context: Record<string, unknown> = {},
  ): Promise<void> {
    try {
      await prisma.keyAuditLog.create({
        data: {
          userId,
          action,
          agentAddress: (context.agentAddress as string) || null,
          context: context as any,
        },
      });

      this.logger.log(
        `[AUDIT] ${action} | user=${userId} | agent=${context.agentAddress || "N/A"} | ${
          context.txHash ? `tx=${context.txHash}` : ""
        }${context.listingId ? `listing=${context.listingId}` : ""}`,
      );
    } catch (error) {
      // Audit logging should never block the main flow
      this.logger.error(
        `Failed to write audit log: ${error instanceof Error ? error.message : error}`,
      );
    }
  }
}
