import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { IngestionService } from "./ingestion.service";

@Controller("stems")
export class IngestionController {
  constructor(private readonly ingestionService: IngestionService) {}

  @Post("upload")
  upload(@Body() body: { artistId: string; fileUris: string[] }) {
    return this.ingestionService.enqueueUpload(body);
  }

  @Get("status/:trackId")
  status(@Param("trackId") trackId: string) {
    return this.ingestionService.getStatus(trackId);
  }
}
