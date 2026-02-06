import { Body, Controller, Get, Param, Post, UseGuards, UseInterceptors, UploadedFiles, BadRequestException } from "@nestjs/common";
import { FilesInterceptor, FileFieldsInterceptor } from "@nestjs/platform-express";
import { AuthGuard } from "@nestjs/passport";
import { Throttle } from "@nestjs/throttler";
import { IngestionService } from "./ingestion.service";

@Controller("ingestion")
export class IngestionController {
  constructor(private readonly ingestionService: IngestionService) { }

  @UseGuards(AuthGuard("jwt"))
  @Post("upload")
  @UseInterceptors(FileFieldsInterceptor([
    { name: 'files', maxCount: 20 },
    { name: 'artwork', maxCount: 1 },
  ]))
  @Throttle({ default: { limit: 20, ttl: 60 } })
  upload(
    @UploadedFiles() files: { files?: Express.Multer.File[], artwork?: Express.Multer.File[] },
    @Body()
    body: {
      artistId: string;
      metadata?: any; // Can be string (from FormData) or object (from JSON body)
    },
  ) {
    let metadata = body.metadata;
    if (typeof metadata === "string") {
      try {
        metadata = JSON.parse(metadata);
      } catch (err) {
        throw new BadRequestException("Invalid metadata JSON string");
      }
    }
    return this.ingestionService.handleFileUpload({
      artistId: body.artistId,
      files: files?.files || [],
      artwork: files?.artwork?.[0],
      metadata,
    });
  }

  @Post("progress/:releaseId/:trackId")
  handleProgress(
    @Param("releaseId") releaseId: string,
    @Param("trackId") trackId: string,
    @Body() body: { progress: number },
  ) {
    return this.ingestionService.handleProgress(releaseId, trackId, body.progress);
  }

  @UseGuards(AuthGuard("jwt"))
  @Post("retry/:releaseId")
  retry(@Param("releaseId") releaseId: string) {
    return this.ingestionService.retryRelease(releaseId);
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
  ) {
    return this.ingestionService.enqueueUpload(body);
  }
}
