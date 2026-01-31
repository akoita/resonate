import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  Request,
  Res,
  StreamableFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
  BadRequestException,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { FileFieldsInterceptor } from "@nestjs/platform-express";
import { Response } from "express";
import { CatalogService } from "./catalog.service";

@Controller("catalog")
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) { }

  @Get("releases/:releaseId/artwork")
  async getReleaseArtwork(@Param("releaseId") releaseId: string, @Res({ passthrough: true }) res: Response) {
    const artwork = await this.catalogService.getReleaseArtwork(releaseId);
    if (!artwork) {
      res.status(404).send("Artwork not found");
      return;
    }
    res.set({
      "Content-Type": artwork.mimeType,
      "Cache-Control": "public, max-age=31536000",
    });
    return new StreamableFile(artwork.data);
  }

  @Get("stems/:stemId/blob")
  async getStemBlob(
    @Param("stemId") stemId: string,
    @Headers("range") range: string,
    @Res() res: Response
  ) {
    const stem = await this.catalogService.getStemBlob(stemId);
    if (!stem) {
      res.status(404).send("Stem data not found");
      return;
    }

    const fileSize = stem.data.length;

    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

      if (start >= fileSize) {
        res.status(416).set({
          'Content-Range': `bytes */${fileSize}`,
        }).send();
        return;
      }

      const chunksize = (end - start) + 1;
      const file = stem.data.subarray(start, end + 1);

      res.status(206).set({
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': stem.mimeType || 'audio/mpeg',
        'Cache-Control': 'public, max-age=31536000',
      });

      res.end(file);
      return;
    }

    res.set({
      'Content-Length': fileSize,
      'Content-Type': stem.mimeType || 'audio/mpeg',
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=31536000',
    });

    res.end(stem.data);
  }

  @UseGuards(AuthGuard("jwt"))
  @Get("me")
  listMe(@Request() req: any) {
    return this.catalogService.listByUserId(req.user.userId);
  }

  @UseGuards(AuthGuard("jwt"))
  @Post()
  create(
    @Request() req: any,
    @Body()
    body: {
      title: string;
      type?: string;
      primaryArtist?: string;
      featuredArtists?: string[];
      genre?: string;
      label?: string;
      releaseDate?: string;
      explicit?: boolean;
      tracks?: Array<{ title: string; position: number; explicit?: boolean }>;
    },
  ) {
    return this.catalogService.createRelease({
      ...body,
      userId: req.user.userId,
    });
  }

  @Get("published")
  listPublished(@Query("limit") limit?: string) {
    console.log(`[Catalog] Fetching published releases (limit: ${limit})`);
    const parsedLimit = limit ? Number(limit) : 20;
    return this.catalogService.listPublished(
      Number.isNaN(parsedLimit) ? 20 : parsedLimit,
    );
  }

  @Get("releases/:releaseId")
  getRelease(@Param("releaseId") releaseId: string) {
    return this.catalogService.getRelease(releaseId);
  }

  @Get("tracks/:trackId")
  getTrack(@Param("trackId") trackId: string) {
    return this.catalogService.getTrack(trackId);
  }

  @UseGuards(AuthGuard("jwt"))
  @Patch("releases/:releaseId")
  updateRelease(
    @Param("releaseId") releaseId: string,
    @Body() body: { title?: string; status?: string },
  ) {
    return this.catalogService.updateRelease(releaseId, body);
  }

  @UseGuards(AuthGuard("jwt"))
  @Patch("releases/:releaseId/artwork")
  @UseInterceptors(FileFieldsInterceptor([{ name: 'artwork', maxCount: 1 }]))
  async updateArtwork(
    @Param("releaseId") releaseId: string,
    @UploadedFiles() files: { artwork?: Express.Multer.File[] },
    @Request() req: any
  ) {
    const artwork = files.artwork?.[0];
    if (!artwork) throw new BadRequestException("No artwork file provided");
    return this.catalogService.updateReleaseArtwork(releaseId, req.user.userId, {
      buffer: artwork.buffer,
      mimetype: artwork.mimetype
    });
  }

  @Get("artist/:artistId")
  listByArtist(@Param("artistId") artistId: string) {
    return this.catalogService.listByArtist(artistId);
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
