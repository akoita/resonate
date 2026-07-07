import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import { EventBus } from "../shared/event_bus";
import { PrismaClient } from "@prisma/client";
import { Subscription } from "rxjs";
import {
  ContractDisputeFiledEvent,
  ContractDisputeResolvedEvent,
  ContractDisputeAppealedEvent,
  GenerationCreditsRequestedEvent,
} from "../../events/event_types";
import { parseEnvList } from "../../config/env";

const prisma = new PrismaClient();

/** Window in which a repeat credit request from the same user is coalesced. */
const CREDIT_REQUEST_DEDUPE_WINDOW_MS = 10 * 60 * 1000;

interface NotificationPayload {
  walletAddress: string;
  type: string;
  title: string;
  message: string;
  disputeId?: string;
  releaseId?: string;
  stemListingId?: string;
}

@Injectable()
export class NotificationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationService.name);
  private readonly subscriptions: Subscription[] = [];

  constructor(private readonly eventBus: EventBus) {}

  onModuleInit() {
    this.subscribeToDisputeEvents();
    this.subscribeToCreditRequests();
    this.logger.log("Notification service initialized — listening for dispute + credit-request events");
  }

  onModuleDestroy() {
    this.subscriptions.forEach((s) => s.unsubscribe());
    this.subscriptions.length = 0;
  }

  // ============ Event Bus Subscriptions ============

  private subscribeToDisputeEvents() {
    // DisputeFiled → notify content creator
    this.subscriptions.push(
      this.eventBus.subscribe("contract.dispute_filed", async (event: ContractDisputeFiledEvent) => {
        this.logger.log(`DisputeFiled: notifying creator for token ${event.tokenId}`);
        const creatorAddr = event.creatorAddress?.toLowerCase();
        if (!creatorAddr) return;

        await this.createNotification({
          walletAddress: creatorAddr,
          type: "dispute_filed",
          title: "Content Flagged",
          message: `Your content (Token #${event.tokenId}) has been flagged for review. A counter-stake of ${event.counterStake} wei was deposited.`,
          disputeId: event.disputeId,
        });
      }),
    );

    // DisputeResolved → notify both reporter and creator
    this.subscriptions.push(
      this.eventBus.subscribe("contract.dispute_resolved", async (event: ContractDisputeResolvedEvent) => {
        this.logger.log(`DisputeResolved: notifying parties for dispute ${event.disputeId}`);
        const outcomeMap: Record<string, string> = { "1": "upheld", "2": "rejected", "3": "inconclusive" };
        const outcome = outcomeMap[event.outcome] || "inconclusive";

        // Look up the dispute to find both parties
        const dispute = await prisma.dispute.findFirst({
          where: { disputeIdOnChain: event.disputeId },
        });

        if (dispute) {
          // Notify reporter
          await this.createNotification({
            walletAddress: dispute.reporterAddr,
            type: "dispute_resolved",
            title: `Dispute ${outcome === "upheld" ? "Upheld ✅" : outcome === "rejected" ? "Rejected ❌" : "Inconclusive ⚠️"}`,
            message: `Your report on Token #${dispute.tokenId} was ${outcome}. ${outcome === "upheld" ? "You can now claim your bounty." : outcome === "rejected" ? "Your counter-stake has been slashed." : "No action taken."}`,
            disputeId: event.disputeId,
          });

          // Notify creator
          await this.createNotification({
            walletAddress: dispute.creatorAddr,
            type: "dispute_resolved",
            title: `Dispute ${outcome === "upheld" ? "Upheld" : outcome === "rejected" ? "Rejected" : "Inconclusive"}`,
            message: `The dispute on your Token #${dispute.tokenId} was ${outcome}.`,
            disputeId: event.disputeId,
          });
        }
      }),
    );

    // DisputeAppealed → notify both parties
    this.subscriptions.push(
      this.eventBus.subscribe("contract.dispute_appealed", async (event: ContractDisputeAppealedEvent) => {
        this.logger.log(`DisputeAppealed: notifying parties for dispute ${event.disputeId}`);

        const dispute = await prisma.dispute.findFirst({
          where: { disputeIdOnChain: event.disputeId },
        });

        if (dispute) {
          const isReporterAppealing = event.appealerAddress?.toLowerCase() === dispute.reporterAddr;
          const otherParty = isReporterAppealing ? dispute.creatorAddr : dispute.reporterAddr;

          await this.createNotification({
            walletAddress: otherParty,
            type: "dispute_appealed",
            title: "Dispute Appealed",
            message: `The decision on Token #${dispute.tokenId} has been appealed (appeal #${event.appealNumber}). The dispute will be re-evaluated.`,
            disputeId: event.disputeId,
          });

          // Also notify the appealer as confirmation
          await this.createNotification({
            walletAddress: event.appealerAddress?.toLowerCase() || "",
            type: "dispute_appealed",
            title: "Appeal Submitted",
            message: `Your appeal on Token #${dispute.tokenId} (appeal #${event.appealNumber}) has been submitted. The dispute is now pending re-evaluation.`,
            disputeId: event.disputeId,
          });
        }
      }),
    );
  }

  private subscribeToCreditRequests() {
    // A user out of generation credits (#1334) → notify every configured
    // operator/admin so they can grant a top-up. Fans out to the same in-app
    // NotificationBell operators already use; the operator then runs
    // `make grant-credits` (or POST /credits/grant).
    this.subscriptions.push(
      this.eventBus.subscribe(
        "generation.credits_requested",
        async (event: GenerationCreditsRequestedEvent) => {
          const requesterId = event.userId?.toLowerCase();
          if (!requesterId) return;

          const operators = this.resolveOperatorWallets();
          if (operators.length === 0) {
            this.logger.warn(
              "Credit request received but no OPERATOR_ADDRESSES/ADMIN_ADDRESSES configured — nobody to notify",
            );
            return;
          }

          // Coalesce repeat requests (reloads, double-clicks) within the window
          // so a user cannot flood operators.
          const since = new Date(Date.now() - CREDIT_REQUEST_DEDUPE_WINDOW_MS);
          const recent = await prisma.notification.findFirst({
            where: {
              type: "credits_requested",
              message: { contains: requesterId },
              createdAt: { gte: since },
            },
          });
          if (recent) {
            this.logger.log(`Credit request from ${requesterId} coalesced (recent notification exists)`);
            return;
          }

          const note = event.note?.trim();
          const message =
            `A user is out of generation credits and asked for a top-up: ${requesterId}.` +
            (note ? ` Note: "${note}".` : "") +
            ` Grant with: make grant-credits USER=${requesterId} AMOUNT=<cents>.`;

          for (const walletAddress of operators) {
            await this.createNotification({
              walletAddress,
              type: "credits_requested",
              title: "Credit request",
              message,
            });
          }
          this.logger.log(`Credit request from ${requesterId} → notified ${operators.length} operator(s)`);
        },
      ),
    );
  }

  /** Configured operator + admin wallets (lower-cased, de-duplicated). */
  private resolveOperatorWallets(): string[] {
    const operators = parseEnvList(process.env.OPERATOR_ADDRESSES, { lowercase: true });
    const admins = parseEnvList(process.env.ADMIN_ADDRESSES, { lowercase: true });
    return Array.from(new Set([...operators, ...admins]));
  }

  // ============ Core Methods ============

  async createNotification(payload: NotificationPayload) {
    try {
      // Check notification preferences
      const prefs = await prisma.notificationPreference.findUnique({
        where: { walletAddress: payload.walletAddress },
      });

      // Default is all enabled; only skip if explicitly disabled
      if (prefs) {
        const prefMap: Record<string, boolean> = {
          dispute_filed: prefs.disputeFiled,
          dispute_resolved: prefs.disputeResolved,
          dispute_appealed: prefs.disputeAppealed,
          evidence_submitted: prefs.evidenceSubmitted,
          listing_expiring_soon: prefs.listingExpiringSoon,
          listing_expired: prefs.listingExpired,
        };
        if (prefMap[payload.type] === false) {
          this.logger.log(`Skipping notification (disabled by preference): ${payload.type} for ${payload.walletAddress}`);
          return null;
        }
      }

      const notification = await prisma.notification.create({
        data: {
          walletAddress: payload.walletAddress,
          type: payload.type,
          title: payload.title,
          message: payload.message,
          disputeId: payload.disputeId,
          releaseId: payload.releaseId,
          stemListingId: payload.stemListingId,
        },
      });

      // Emit internal event for WebSocket gateway to pick up
      this.eventBus.publish({
        eventName: "notification.created" as const,
        eventVersion: 1,
        occurredAt: new Date().toISOString(),
        walletAddress: payload.walletAddress,
        notificationId: notification.id,
        type: payload.type,
        title: payload.title,
        message: payload.message,
        disputeId: payload.disputeId,
        releaseId: payload.releaseId,
        stemListingId: payload.stemListingId,
      });

      this.logger.log(`Created notification ${notification.id} (${payload.type}) for ${payload.walletAddress}`);
      return notification;
    } catch (error) {
      this.logger.error(`Failed to create notification: ${error}`);
      return null;
    }
  }

  async createListingLifecycleNotification(payload: NotificationPayload & { stemListingId: string }) {
    const existing = await prisma.notification.findFirst({
      where: {
        walletAddress: payload.walletAddress,
        type: payload.type,
        stemListingId: payload.stemListingId,
      },
    });
    if (existing) return existing;

    return this.createNotification(payload);
  }

  async getNotifications(walletAddress: string, limit = 20, offset = 0) {
    return prisma.notification.findMany({
      where: { walletAddress },
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
    });
  }

  async getUnreadCount(walletAddress: string) {
    return prisma.notification.count({
      where: { walletAddress, read: false },
    });
  }

  async markAsRead(notificationId: string) {
    return prisma.notification.update({
      where: { id: notificationId },
      data: { read: true },
    });
  }

  async markAllAsRead(walletAddress: string) {
    return prisma.notification.updateMany({
      where: { walletAddress, read: false },
      data: { read: true },
    });
  }

  async getPreferences(walletAddress: string) {
    return prisma.notificationPreference.upsert({
      where: { walletAddress },
      create: { walletAddress },
      update: {},
    });
  }

  async updatePreferences(
    walletAddress: string,
    prefs: {
      disputeFiled?: boolean;
      disputeResolved?: boolean;
      disputeAppealed?: boolean;
      evidenceSubmitted?: boolean;
      listingExpiringSoon?: boolean;
      listingExpired?: boolean;
    },
  ) {
    return prisma.notificationPreference.upsert({
      where: { walletAddress },
      create: { walletAddress, ...prefs },
      update: prefs,
    });
  }
}
