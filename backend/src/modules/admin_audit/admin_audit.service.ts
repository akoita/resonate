import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";
import {
  ADMIN_AUDIT_DEFAULT_PAGE_SIZE,
  ADMIN_AUDIT_MAX_PAGE_SIZE,
  ListAdminAuditEventsQueryDto,
} from "./admin_audit.dto";

export interface AdminAuditEventView {
  id: string;
  createdAt: string;
  actorUserId: string;
  action: string;
  targetUserId: string | null;
  outcome: string;
  detail: unknown;
}

export interface AdminAuditEventsPage {
  items: AdminAuditEventView[];
  page: number;
  pageSize: number;
  total: number;
}

function toInt(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
}

/**
 * Read side of the one admin audit log (#2173). Newest first, filterable by
 * action, outcome, actor, target and time. There is no update or delete here:
 * the log is append-only, written only by `writeAdminAuditEvent`.
 */
@Injectable()
export class AdminAuditService {
  async list(query: ListAdminAuditEventsQueryDto): Promise<AdminAuditEventsPage> {
    const page = Math.max(1, toInt(query.page, 1));
    const pageSize = Math.min(
      ADMIN_AUDIT_MAX_PAGE_SIZE,
      Math.max(1, toInt(query.pageSize, ADMIN_AUDIT_DEFAULT_PAGE_SIZE)),
    );

    const createdAt: Prisma.DateTimeFilter = {};
    if (query.from) createdAt.gte = new Date(query.from);
    if (query.to) createdAt.lte = new Date(query.to);
    const where: Prisma.AdminAuditEventWhereInput = {
      ...(query.action ? { action: query.action } : {}),
      ...(query.outcome ? { outcome: query.outcome } : {}),
      ...(query.actor ? { actorUserId: query.actor } : {}),
      ...(query.target ? { targetUserId: query.target } : {}),
      ...(Object.keys(createdAt).length > 0 ? { createdAt } : {}),
    };

    const [total, rows] = await Promise.all([
      prisma.adminAuditEvent.count({ where }),
      prisma.adminAuditEvent.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return {
      items: rows.map((row) => ({
        id: row.id,
        createdAt: row.createdAt.toISOString(),
        actorUserId: row.actorUserId,
        action: row.action,
        targetUserId: row.targetUserId,
        outcome: row.outcome,
        detail: row.detail,
      })),
      page,
      pageSize,
      total,
    };
  }
}
