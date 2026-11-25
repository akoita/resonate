import { Body, Controller, Get, Post, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { IsBoolean, IsNumber, IsOptional } from "class-validator";
import { prisma } from "../../db/prisma";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { AdminAudit, auditBody, auditBoolean, auditNumber } from "../admin_audit/admin_audit.interceptor";
import {
  RENDITION_ELIGIBLE_WHERE,
  STREAM_RENDITION_MAX_FAILURES,
  StreamRenditionService,
} from "./stream_rendition.service";

/** `POST /admin/stems/stream-renditions/backfill`. */
export class StreamRenditionBackfillDto {
  @IsOptional()
  @IsNumber()
  limit?: number;

  /** Re-admit stems whose rendition failed too often to the sweep. */
  @IsOptional()
  @IsBoolean()
  retryFailed?: boolean;
}

/**
 * Operator view and backfill of streaming renditions (#2661). The background
 * sweep does the same work on its own; this route lets an operator drive a
 * backfill to `remaining: 0` and see the count.
 */
@Controller("admin/stems/stream-renditions")
export class StreamRenditionAdminController {
  constructor(private readonly renditions: StreamRenditionService) {}

  @UseGuards(AuthGuard("jwt"), RolesGuard)
  @Roles("admin")
  @Get()
  async status() {
    const [remaining, failed, ready] = await Promise.all([
      this.renditions.remaining(),
      prisma.stem.count({
        where: { ...RENDITION_ELIGIBLE_WHERE, streamUri: null, streamFailureCount: { gte: STREAM_RENDITION_MAX_FAILURES } },
      }),
      prisma.stem.count({ where: { ...RENDITION_ELIGIBLE_WHERE, streamUri: { not: null } } }),
    ]);
    return { ready, remaining, failed };
  }

  /** Batch-bounded (1-50 per run, default 10); re-run until `remaining` is 0. */
  @UseGuards(AuthGuard("jwt"), RolesGuard)
  @Roles("admin")
  @Post("backfill")
  @AdminAudit("maintenance.stream_renditions_backfill_run", (c) => ({
    detail: { limit: auditNumber(auditBody(c).limit), retryFailed: auditBoolean(auditBody(c).retryFailed) },
  }))
  async backfill(@Body() body: StreamRenditionBackfillDto) {
    if (body?.retryFailed === true) {
      await prisma.stem.updateMany({
        where: { ...RENDITION_ELIGIBLE_WHERE, streamUri: null, streamFailureCount: { gte: STREAM_RENDITION_MAX_FAILURES } },
        data: { streamFailureCount: 0, streamFailedAt: null },
      });
    }
    const limit = typeof body?.limit === "number" && Number.isFinite(body.limit) ? Math.trunc(body.limit) : 10;
    return this.renditions.runSweep(Math.max(1, Math.min(limit, 50)));
  }
}
