import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { IngestionService } from "./ingestion.service";

@Controller("stems")
export class IngestionController {
  constructor(private readonly ingestionService: IngestionService) {}

  @UseGuards(AuthGuard("jwt"))
  @Post("upload")
  upload(@Body() body: { artistId: string; fileUris: string[] }) {
    return this.ingestionService.enqueueUpload(body);
  }

  @UseGuards(AuthGuard("jwt"))
  @Get("status/:trackId")
  status(@Param("trackId") trackId: string) {
    return this.ingestionService.getStatus(trackId);
  }
}
