import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import { EventBus } from "../shared/event_bus";
import { PrismaClient } from "@prisma/client";
import { Subscription } from "rxjs";
import {
  ContractDisputeFiledEvent,
  ContractDisputeResolvedEvent,
  ContractDisputeAppealedEvent,
} from "../../events/event_types";

const prisma = new PrismaClient();

interface NotificationPayload {
  walletAddress: string;
  type: string;
  title: string;
  message: string;
  disputeId?: string;
  releaseId?: string;
}

@Injectable()
export class NotificationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationService.name);
  private readonly subscriptions: Subscription[] = [];

  constructor(private readonly eventBus: EventBus) {}

  onModuleInit() {
    this.subscribeToDisputeEvents();
    this.logger.log("Notification service initialized — listening for dispute events");
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
      });

      this.logger.log(`Created notification ${notification.id} (${payload.type}) for ${payload.walletAddress}`);
      return notification;
    } catch (error) {
      this.logger.error(`Failed to create notification: ${error}`);
      return null;
    }
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
    prefs: { disputeFiled?: boolean; disputeResolved?: boolean; disputeAppealed?: boolean; evidenceSubmitted?: boolean },
  ) {
    return prisma.notificationPreference.upsert({
      where: { walletAddress },
      create: { walletAddress, ...prefs },
      update: prefs,
    });
  }
}
