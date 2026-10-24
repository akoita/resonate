import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  InternalServerErrorException,
  Param,
  Post,
  Request,
  UnauthorizedException,
  UseGuards,
  UseInterceptors,
  UploadedFiles,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { Throttle } from "@nestjs/throttler";
import { seconds } from "../shared/rate_limits";
import { IngestionService } from "./ingestion.service";
import { UploadFormDto } from "./ingestion.dto";
import { IngestionMultipartInterceptor } from "./ingestion-multipart.interceptor";
import {
  cleanupIngestionMultipartRequest,
  IngestionMultipartStorage,
} from "./ingestion-multipart.storage";

@Controller("ingestion")
export class IngestionController {
  constructor(private readonly ingestionService: IngestionService) { }

  @UseGuards(AuthGuard("jwt"))
  @Post("upload")
  @UseInterceptors(new IngestionMultipartInterceptor([
    { name: 'files', maxCount: 20 },
    { name: 'artwork', maxCount: 1 },
  ], {
    storage: new IngestionMultipartStorage(),
    limits: { files: 21, parts: 25 },
  }))
  @Throttle({ default: { limit: 20, ttl: seconds(60) } })
  async upload(
    @UploadedFiles() files: { files?: Express.Multer.File[], artwork?: Express.Multer.File[] },
    @Body() body: UploadFormDto,
    @Request() req: any,
  ): Promise<unknown> {
    try {
      let metadata = body.metadata;
      if (typeof metadata === "string") {
        try {
          metadata = JSON.parse(metadata);
        } catch (err) {
          throw new BadRequestException("Invalid metadata JSON string");
        }
      }
      return await this.ingestionService.handleFileUpload({
        artistId: body.artistId,
        userId: req.user?.userId,
        files: files?.files || [],
        artwork: files?.artwork?.[0],
        metadata,
        catalogTrackId: body.trackId,
        // The upload source is never taken from the client: trusted routing
        // comes only from the server-side trusted-source link.
      });
    } finally {
      await cleanupIngestionMultipartRequest(req);
    }
  }

  @UseGuards(AuthGuard("jwt"))
  @Post("releases/:releaseId/tracks/:trackId/audio")
  @UseInterceptors(new IngestionMultipartInterceptor([
    { name: "file", maxCount: 1 },
  ], {
    storage: new IngestionMultipartStorage(),
    limits: { files: 1, fields: 0, parts: 2, fileSize: 100 * 1024 * 1024 },
  }))
  @Throttle({ default: { limit: 5, ttl: seconds(60) } })
  async replaceTrackAudio(
    @Param("releaseId") releaseId: string,
    @Param("trackId") trackId: string,
    @UploadedFiles() files: { file?: Express.Multer.File[] },
    @Request() req: any,
  ) {
    try {
      const file = files?.file?.[0];
      if (!file) throw new BadRequestException("Select one audio file to replace this track");
      return await this.ingestionService.replaceTrackAudio(
        releaseId,
        trackId,
        req.user?.userId,
        file,
      );
    } finally {
      await cleanupIngestionMultipartRequest(req);
    }
  }

  @Post("progress/:releaseId/:trackId")
  handleProgress(
    @Param("releaseId") releaseId: string,
    @Param("trackId") trackId: string,
    @Body() body: { progress: number; audioRevision?: string },
    @Headers("x-internal-service-key") internalServiceKey?: string,
  ) {
    const configuredInternalKey = process.env.INTERNAL_SERVICE_KEY;
    if (configuredInternalKey) {
      if (internalServiceKey !== configuredInternalKey) {
        throw new UnauthorizedException("Invalid internal service key");
      }
    } else if (process.env.NODE_ENV === "production") {
      throw new InternalServerErrorException("INTERNAL_SERVICE_KEY must be set in production");
    }

    // Checked here rather than by a DTO so the key check above still runs first (#1890).
    if (typeof body?.progress !== "number" || !Number.isFinite(body.progress)) {
      throw new BadRequestException("progress must be a number");
    }
    if (body.audioRevision !== undefined && typeof body.audioRevision !== "string") {
      throw new BadRequestException("audioRevision must be a string");
    }
    return this.ingestionService.handleProgress(releaseId, trackId, body.progress, body.audioRevision);
  }

  @UseGuards(AuthGuard("jwt"))
  @Post("retry/:releaseId")
  retry(@Param("releaseId") releaseId: string, @Request() req: any) {
    return this.ingestionService.retryRelease(releaseId, req.user?.userId);
  }

  @UseGuards(AuthGuard("jwt"))
  @Post("cancel/:releaseId")
  cancel(@Param("releaseId") releaseId: string, @Request() req: any) {
    return this.ingestionService.cancelProcessing(releaseId, req.user?.userId);
  }

  @UseGuards(AuthGuard("jwt"))
  @Get("status/:trackId")
  status(@Param("trackId") trackId: string) {
    return this.ingestionService.getStatus(trackId);
  }

  /**
   * @deprecated Use POST /ingestion/upload with multipart form data for real processing.
   * This endpoint is retained for backwards compatibility and testing with mock processing.
   */
  @UseGuards(AuthGuard("jwt"))
  @Post("enqueue")
  enqueue(
    @Body() body: { artistId: string; fileUris: string[]; metadata?: any },
    @Request() req: any,
  ) {
    return this.ingestionService.enqueueUpload({ ...body, userId: req.user?.userId });
  }
}
