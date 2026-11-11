import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { FileInterceptor } from "@nestjs/platform-express";
import { AdminAudit, auditCode, auditNumber, auditRef } from "../admin_audit/admin_audit.interceptor";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { AttachRemixWatermarkEvidenceDto } from "./remix-watermark-admin.dto";
import {
  REMIX_WATERMARK_DETECT_MAX_CLIP_BYTES,
  REMIX_WATERMARK_EVIDENCE_SUBJECT_TYPES,
  RemixWatermarkDetectionService,
} from "./remix-watermark-detection.service";

const DETECTION_STATUSES = ["pending", "processing", "matched", "no_match", "failed"] as const;

function resultOf(context: { result: unknown }): Record<string, unknown> {
  return (context.result ?? {}) as Record<string, unknown>;
}

/**
 * Admin check of an audio clip for the remix render watermark (#2575).
 * Admin only: a match leads to the render's licence trail.
 */
@Controller("admin/remix-watermark")
@UseGuards(AuthGuard("jwt"), RolesGuard)
@Roles("admin")
export class RemixWatermarkAdminController {
  constructor(private readonly detections: RemixWatermarkDetectionService) {}

  /** Recent checks, and whether a key is configured to check with. */
  @Get("detections")
  @AdminAudit("remix_watermark.detect_viewed", () => ({ detail: {} }))
  async list() {
    return { ...this.detections.status(), detections: await this.detections.list() };
  }

  /** Starts a check of the uploaded clip. Poll the returned id for the result. */
  @Post("detections")
  @HttpCode(202)
  @UseInterceptors(
    FileInterceptor("clip", { limits: { fileSize: REMIX_WATERMARK_DETECT_MAX_CLIP_BYTES } }),
  )
  @AdminAudit("remix_watermark.detect_started", (c) => ({
    detail: {
      detectionId: auditRef(resultOf(c).id),
      clipSha256: auditRef(resultOf(c).clipSha256),
      clipBytes: auditNumber(resultOf(c).clipBytes),
    },
  }))
  start(@UploadedFile() clip?: Express.Multer.File) {
    return this.detections.start(clip?.buffer);
  }

  @Get("detections/:id")
  @AdminAudit("remix_watermark.detect_viewed", (c) => ({
    detail: {
      detectionId: auditRef(c.params.id),
      status: auditCode(resultOf(c).status, DETECTION_STATUSES),
    },
  }))
  get(@Param("id") id: string) {
    return this.detections.get(id);
  }

  /** Attaches a match to a dispute, release or track as a typed evidence item. */
  @Post("detections/:id/evidence")
  @AdminAudit("remix_watermark.evidence_attached", (c) => {
    const body = (c.body ?? {}) as Record<string, unknown>;
    return {
      detail: {
        detectionId: auditRef(c.params.id),
        evidenceId: auditRef(resultOf(c).evidenceId),
        subjectType: auditCode(body.subjectType, REMIX_WATERMARK_EVIDENCE_SUBJECT_TYPES),
        subjectId: auditRef(body.subjectId),
      },
    };
  })
  attach(
    @Req() req: { user: { userId: string } },
    @Param("id") id: string,
    @Body() dto: AttachRemixWatermarkEvidenceDto,
  ) {
    return this.detections.attachEvidence(id, dto, req.user.userId);
  }
}
