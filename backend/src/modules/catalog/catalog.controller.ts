import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { CatalogService } from "./catalog.service";

@Controller("catalog")
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  @UseGuards(AuthGuard("jwt"))
  @Post()
  create(
    @Body()
    body: {
      artistId: string;
      title: string;
      releaseType?: string;
      releaseTitle?: string;
      primaryArtist?: string;
      featuredArtists?: string[];
      genre?: string;
      isrc?: string;
      label?: string;
      releaseDate?: string;
      explicit?: boolean;
    },
  ) {
    return this.catalogService.createTrack(body);
  }

  @UseGuards(AuthGuard("jwt"))
  @Get(":trackId")
  getTrack(@Param("trackId") trackId: string) {
    return this.catalogService.getTrack(trackId);
  }

  @UseGuards(AuthGuard("jwt"))
  @Get()
  search(@Query("q") query?: string) {
    return this.catalogService.search(query ?? "");
  }
}
