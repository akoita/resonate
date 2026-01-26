import { Body, Controller, Get, Param, Post, UseGuards, UseInterceptors, UploadedFiles } from "@nestjs/common";
import { FilesInterceptor } from "@nestjs/platform-express";
import { AuthGuard } from "@nestjs/passport";
import { Throttle } from "@nestjs/throttler";
import { IngestionService } from "./ingestion.service";

@Controller("stems")
export class IngestionController {
  constructor(private readonly ingestionService: IngestionService) { }

  @UseGuards(AuthGuard("jwt"))
  @Post("upload")
  @UseInterceptors(FilesInterceptor("files"))
  @Throttle({ default: { limit: 20, ttl: 60 } })
  upload(
    @UploadedFiles() files: Express.Multer.File[],
    @Body()
    body: {
      artistId: string;
      metadata?: string; // Metadata is sent as a JSON string in FormData
    },
  ) {
    const metadata = body.metadata ? JSON.parse(body.metadata) : undefined;
    return this.ingestionService.handleFileUpload({
      artistId: body.artistId,
      files,
      metadata,
    });
  }

  @UseGuards(AuthGuard("jwt"))
  @Get("status/:trackId")
  status(@Param("trackId") trackId: string) {
    return this.ingestionService.getStatus(trackId);
  }
}
