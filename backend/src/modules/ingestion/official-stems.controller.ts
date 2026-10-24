import {
  BadRequestException,
  Controller,
  Param,
  Post,
  Request,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { Throttle } from "@nestjs/throttler";
import { seconds } from "../shared/rate_limits";
import { cleanupIngestionMultipartRequest, IngestionMultipartStorage } from "./ingestion-multipart.storage";
import { IngestionMultipartInterceptor } from "./ingestion-multipart.interceptor";
import { OfficialStemsService } from "./official-stems.service";
import { OFFICIAL_STEM_MAX_FILE_BYTES, OFFICIAL_STEM_TYPES } from "./official-stems.validation";

/**
 * POST /ingestion/releases/:releaseId/tracks/:trackId/official-stems (#1976)
 *
 * Multipart, one optional file field per stem type (`vocals`, `drums`, `bass`,
 * `guitar`, `piano`, `other`), each a WAV or FLAC. A field name outside that
 * list is refused by the parser (400), so the stem type is never inferred from
 * a file name. See OfficialStemsService for the checks and the authority rule.
 */
@Controller("ingestion")
export class OfficialStemsController {
  constructor(private readonly officialStems: OfficialStemsService) {}

  @UseGuards(AuthGuard("jwt"))
  @Post("releases/:releaseId/tracks/:trackId/official-stems")
  @UseInterceptors(
    new IngestionMultipartInterceptor(
      OFFICIAL_STEM_TYPES.map((name) => ({ name, maxCount: 1 })),
      {
        storage: new IngestionMultipartStorage(),
        limits: {
          files: OFFICIAL_STEM_TYPES.length,
          fields: 0,
          parts: OFFICIAL_STEM_TYPES.length + 1,
          fileSize: OFFICIAL_STEM_MAX_FILE_BYTES,
        },
      },
    ),
  )
  @Throttle({ default: { limit: 5, ttl: seconds(60) } })
  async upload(
    @Param("releaseId") releaseId: string,
    @Param("trackId") trackId: string,
    @UploadedFiles() files: Record<string, Express.Multer.File[] | undefined> | undefined,
    @Request() req: any,
  ) {
    try {
      const byType: Record<string, Express.Multer.File | undefined> = {};
      for (const type of OFFICIAL_STEM_TYPES) {
        byType[type] = files?.[type]?.[0];
      }
      if (!Object.values(byType).some(Boolean)) {
        throw new BadRequestException({
          code: "official_stems_rejected",
          message: `Add at least one stem file (${OFFICIAL_STEM_TYPES.join(", ")}) as WAV or FLAC.`,
          issues: [{ code: "no_files", message: "No stem file was sent." }],
        });
      }
      return await this.officialStems.uploadPackage({
        releaseId,
        trackId,
        userId: req.user?.userId,
        files: byType,
      });
    } finally {
      await cleanupIngestionMultipartRequest(req);
    }
  }
}
