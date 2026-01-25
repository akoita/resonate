import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { CatalogService } from "./catalog.service";

@Controller("catalog")
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) { }

  @UseGuards(AuthGuard("jwt"))
  @Post()
  create(
    @Request() req: any,
    @Body()
    body: {
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
    return this.catalogService.createTrack({
      ...body,
      userId: req.user.userId,
    });
  }

  @UseGuards(AuthGuard("jwt"))
  @Get(":trackId")
  getTrack(@Param("trackId") trackId: string) {
    return this.catalogService.getTrack(trackId);
  }

  @UseGuards(AuthGuard("jwt"))
  @Patch(":trackId")
  updateTrack(
    @Param("trackId") trackId: string,
    @Body() body: { title?: string; status?: string },
  ) {
    return this.catalogService.updateTrack(trackId, body);
  }

  @UseGuards(AuthGuard("jwt"))
  @Get("artist/:artistId")
  listByArtist(@Param("artistId") artistId: string) {
    return this.catalogService.listByArtist(artistId);
  }

  @Get("published")
  listPublished(@Query("limit") limit?: string) {
    const parsedLimit = limit ? Number(limit) : 20;
    return this.catalogService.listPublished(
      Number.isNaN(parsedLimit) ? 20 : parsedLimit,
    );
  }

  @UseGuards(AuthGuard("jwt"))
  @Get()
  search(
    @Query("q") query?: string,
    @Query("stemType") stemType?: string,
    @Query("hasIpnft") hasIpnft?: string,
    @Query("limit") limit?: string,
  ) {
    const parsedHasIpnft =
      hasIpnft === undefined ? undefined : hasIpnft === "true";
    const parsedLimit = limit ? Number(limit) : 50;
    return this.catalogService.search(query ?? "", {
      stemType,
      hasIpnft: parsedHasIpnft,
      limit: Number.isNaN(parsedLimit) ? 50 : parsedLimit,
    });
  }
}
