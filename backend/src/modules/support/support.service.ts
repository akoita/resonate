import { randomUUID } from "crypto";
import { BadRequestException, HttpException, Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { EmailConfig } from "../email/email_config";
import { renderSupportReceiptEmail } from "../email/email_templates";
import { EMAIL_TRANSPORT, emailErrorCode, type EmailTransport } from "../email/email_transport";
import { writeStructuredLog } from "../shared/structured_logging";
import {
  SUPPORT_MESSAGE_MAX,
  SUPPORT_MESSAGE_MIN,
  SUPPORT_STATUSES,
  SUPPORT_TOPICS,
  type SupportStatus,
  type SupportTopic,
} from "./support.dto";

/**
 * Requests one person (or one reply address, when signed out) may send per
 * day (#2667). The per-IP throttle on the route stops bursts; this stops a
 * slow drip from one account or the form being used to flood an inbox.
 */
export const SUPPORT_REQUESTS_PER_DAY = 5;
const DAY_MS = 24 * 60 * 60 * 1000;
const LIST_LIMIT = 200;

export interface CreateSupportRequestInput {
  topic: SupportTopic;
  message: string;
  email?: string;
  website?: string;
}

export interface SupportRequestReceipt {
  id: string;
  status: SupportStatus;
  createdAt: Date;
  receiptSent: boolean;
}

export interface SupportRequestView {
  id: string;
  topic: string;
  message: string;
  status: string;
  signedIn: boolean;
  userId: string | null;
  /** Where to answer: the address given on the form, else the person's confirmed contact address. */
  replyTo: string | null;
  createdAt: string;
  statusChangedAt: string | null;
}

function tooMany(): HttpException {
  return new HttpException(
    {
      code: "support_rate_limited",
      message: "You have sent several messages today. We will answer them; try again tomorrow if you need to add something.",
    },
    429,
  );
}

@Injectable()
export class SupportService {
  constructor(
    @Optional() @Inject(EMAIL_TRANSPORT) private readonly transport?: EmailTransport | null,
    @Optional() private readonly emailConfig?: EmailConfig,
  ) {}

  /**
   * Store a support request from a signed-in person (`userId`) or a
   * signed-out visitor (`userId` null). A filled honeypot means a bot:
   * nothing is stored and the answer looks the same.
   */
  async create(userId: string | null, input: CreateSupportRequestInput): Promise<SupportRequestReceipt> {
    if (typeof input?.website === "string" && input.website.trim()) {
      return { id: randomUUID(), status: "new", createdAt: new Date(), receiptSent: false };
    }
    if (!(SUPPORT_TOPICS as readonly string[]).includes(input?.topic)) {
      throw new BadRequestException("topic is not recognised");
    }
    const message = typeof input.message === "string" ? input.message.trim() : "";
    if (message.length < SUPPORT_MESSAGE_MIN || message.length > SUPPORT_MESSAGE_MAX) {
      throw new BadRequestException({
        code: "support_message_length",
        message: `Write between ${SUPPORT_MESSAGE_MIN} and ${SUPPORT_MESSAGE_MAX} characters.`,
      });
    }
    const email = typeof input.email === "string" && input.email.trim() ? input.email.trim() : null;

    const since = new Date(Date.now() - DAY_MS);
    const scope: Prisma.SupportRequestWhereInput | null = userId
      ? { userId }
      : email
        ? { email: { equals: email, mode: "insensitive" } }
        : null;
    if (scope) {
      const recent = await prisma.supportRequest.count({ where: { AND: [scope, { createdAt: { gt: since } }] } });
      if (recent >= SUPPORT_REQUESTS_PER_DAY) throw tooMany();
    }

    const row = await prisma.supportRequest.create({
      data: { userId, email, topic: input.topic, message },
    });
    writeStructuredLog({
      level: "info",
      event: "support.request_created",
      message: "Support request received",
      requestId: row.id,
      topic: row.topic,
      signedIn: Boolean(userId),
    });

    const address = email ?? (userId ? await this.confirmedContactAddress(userId) : null);
    const receiptSent = address ? await this.sendReceipt(row.id, address) : false;
    return { id: row.id, status: row.status as SupportStatus, createdAt: row.createdAt, receiptSent };
  }

  /** Requests for the operator page, newest first; `status` narrows the list. */
  async list(status?: string): Promise<{ requests: SupportRequestView[]; counts: Record<SupportStatus, number> }> {
    if (status !== undefined && status !== "" && !(SUPPORT_STATUSES as readonly string[]).includes(status)) {
      throw new BadRequestException("status is not recognised");
    }
    const where: Prisma.SupportRequestWhereInput = status ? { status } : {};
    const [rows, grouped] = await Promise.all([
      prisma.supportRequest.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: LIST_LIMIT,
        include: { user: { select: { contactEmail: { select: { address: true, status: true } } } } },
      }),
      prisma.supportRequest.groupBy({ by: ["status"], _count: { _all: true } }),
    ]);
    const counts = { new: 0, answered: 0, closed: 0 } as Record<SupportStatus, number>;
    for (const group of grouped) {
      if ((SUPPORT_STATUSES as readonly string[]).includes(group.status)) {
        counts[group.status as SupportStatus] = group._count._all;
      }
    }
    return {
      counts,
      requests: rows.map((row) => {
        const contact = row.user?.contactEmail;
        return {
          id: row.id,
          topic: row.topic,
          message: row.message,
          status: row.status,
          signedIn: Boolean(row.userId),
          userId: row.userId,
          replyTo: row.email ?? (contact?.status === "confirmed" ? contact.address : null),
          createdAt: row.createdAt.toISOString(),
          statusChangedAt: row.statusChangedAt?.toISOString() ?? null,
        };
      }),
    };
  }

  /** Mark a request new, answered or closed. */
  async setStatus(id: string, status: string, actorUserId: string) {
    if (!(SUPPORT_STATUSES as readonly string[]).includes(status)) {
      throw new BadRequestException("status is not recognised");
    }
    const existing = await prisma.supportRequest.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw new NotFoundException("Support request not found");
    const row = await prisma.supportRequest.update({
      where: { id },
      data: { status, statusChangedAt: new Date(), statusChangedBy: actorUserId },
    });
    return { id: row.id, status: row.status, statusChangedAt: row.statusChangedAt?.toISOString() ?? null };
  }

  private async confirmedContactAddress(userId: string): Promise<string | null> {
    const contact = await prisma.contactEmail.findUnique({ where: { userId }, select: { address: true, status: true } });
    return contact?.status === "confirmed" ? contact.address : null;
  }

  /** Email a receipt with the reference. Never fails the request; skipped when email is off. */
  private async sendReceipt(requestId: string, address: string): Promise<boolean> {
    if (!this.transport || !this.emailConfig?.frontendUrl) return false;
    try {
      await this.transport.send(renderSupportReceiptEmail(address, requestId, this.emailConfig));
      return true;
    } catch (error) {
      writeStructuredLog({
        level: "warn",
        event: "support.receipt_send_failed",
        message: "Could not send a support request receipt",
        errorCode: emailErrorCode(error),
      });
      return false;
    }
  }
}
