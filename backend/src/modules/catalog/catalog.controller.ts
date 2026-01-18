import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { CatalogService } from "./catalog.service";

@Controller("catalog")
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  @Post()
  create(@Body() body: { artistId: string; title: string }) {
    return this.catalogService.createTrack(body);
  }

  @Get(":trackId")
  getTrack(@Param("trackId") trackId: string) {
    return this.catalogService.getTrack(trackId);
  }

  @Get()
  search(@Query("q") query?: string) {
    return this.catalogService.search(query ?? "");
  }
}
