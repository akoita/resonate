import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
  Res,
  StreamableFile,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { Throttle } from "@nestjs/throttler";
import { minutes } from "../shared/rate_limits";
import { CreateCrateRequestDto, UpdateCrateDto } from "./crate.dto";
import type {
  CreateCrateResponse,
  GetCrateResponse,
  ListCratesResponse,
  SwapCrateItemResponse,
} from "./crate.dto";
import { contentDisposition } from "./crate_export";
import { ExportCrateDto, type CrateExportManifestDto } from "./crate_export.dto";
import { CrateExportService } from "./crate_export.service";
import { CrateQuoteService } from "./crate_quote.service";
import { CreateCrateQuoteDto, SettleCrateQuoteDto } from "./crate_quote.dto";
import type { CrateQuoteDto } from "./crate_quote.dto";
import { CratesService } from "./crates.service";

/** Tracked per signed-in person where the guard has resolved them, else per IP. */
const trackByUser = (req: Record<string, any>) => req.user?.userId ?? req.ip;

/**
 * Crate Digger HTTP surface (#1962, docs/rfc/taste-engine.md §5.1-5.2).
 *
 * The user id comes from the JWT (`req.user.userId`) and nowhere else. Free for
 * everyone today; the entitlement is exposed on the crate DTO, not enforced
 * here (crate-entitlements.ts).
 */
@Controller("crates")
export class CratesController {
  constructor(
    private readonly crates: CratesService,
    private readonly quotes: CrateQuoteService,
    private readonly crateExports: CrateExportService,
  ) {}

  /**
   * Builds and persists a draft crate from text, a reference track or edited
   * filters. A request digs through a bounded catalog pool and ranks it, so it
   * carries its own throttle.
   */
  @UseGuards(AuthGuard("jwt"))
  @Throttle({ default: { limit: 20, ttl: minutes(1), getTracker: trackByUser } })
  @Post("requests")
  createRequest(
    @Req() req: any,
    @Body() body: CreateCrateRequestDto,
  ): Promise<CreateCrateResponse> {
    return this.crates.createFromRequest(req.user.userId, body);
  }

  /** The signed-in user's own crates, newest update first (max 50). */
  @UseGuards(AuthGuard("jwt"))
  @Get()
  listCrates(@Req() req: any): Promise<ListCratesResponse> {
    return this.crates.listCrates(req.user.userId);
  }

  /** The signed-in user's own crate; anyone else's is a 404. */
  @UseGuards(AuthGuard("jwt"))
  @Get(":id")
  getCrate(@Req() req: any, @Param("id") id: string): Promise<GetCrateResponse> {
    return this.crates.getCrate(req.user.userId, id);
  }

  /**
   * Edits the caller's crate: title, status and the full new order, removals
   * and locks of its lines. Anyone else's crate is a 404.
   */
  @UseGuards(AuthGuard("jwt"))
  @Throttle({ default: { limit: 20, ttl: minutes(1), getTracker: trackByUser } })
  @Patch(":id")
  updateCrate(
    @Req() req: any,
    @Param("id") id: string,
    @Body() body: UpdateCrateDto,
  ): Promise<GetCrateResponse> {
    return this.crates.updateCrate(req.user.userId, id, body);
  }

  /**
   * Replaces one unlocked line with the best-ranked candidate that fits the
   * crate's filters. Like a request, it digs through the catalog pool.
   */
  @UseGuards(AuthGuard("jwt"))
  @Throttle({ default: { limit: 20, ttl: minutes(1), getTracker: trackByUser } })
  @Post(":id/items/:trackId/swap")
  swapItem(
    @Req() req: any,
    @Param("id") id: string,
    @Param("trackId") trackId: string,
  ): Promise<SwapCrateItemResponse> {
    return this.crates.swapItem(req.user.userId, id, trackId);
  }

  /**
   * Prices the crate's lines (or the listed ones) from on-chain facts for the
   * DJ to approve (#1964). Nothing is bought here: the browser signs and sends
   * one batched user operation, then reports it to settle.
   */
  @UseGuards(AuthGuard("jwt"))
  @Throttle({ default: { limit: 20, ttl: minutes(1), getTracker: trackByUser } })
  @Post(":id/quote")
  createQuote(
    @Req() req: any,
    @Param("id") id: string,
    @Body() body: CreateCrateQuoteDto,
  ): Promise<CrateQuoteDto> {
    return this.quotes.createQuote(req.user.userId, id, body);
  }

  /** The caller's own quote of the crate; anyone else's is a 404. */
  @UseGuards(AuthGuard("jwt"))
  @Get(":id/quotes/:quoteId")
  getQuote(
    @Req() req: any,
    @Param("id") id: string,
    @Param("quoteId") quoteId: string,
  ): Promise<CrateQuoteDto> {
    return this.quotes.getQuote(req.user.userId, id, quoteId);
  }

  /**
   * Reports the transaction of an approved quote and verifies it from the
   * chain. 202 while the transaction has no receipt yet (retry); 200 once the
   * quote is settled, partial or failed, and on every later call.
   */
  @UseGuards(AuthGuard("jwt"))
  @Throttle({ default: { limit: 20, ttl: minutes(1), getTracker: trackByUser } })
  @Post(":id/quotes/:quoteId/settle")
  async settleQuote(
    @Req() req: any,
    @Param("id") id: string,
    @Param("quoteId") quoteId: string,
    @Body() body: SettleCrateQuoteDto,
    @Res({ passthrough: true }) res: { status(code: number): unknown },
  ): Promise<CrateQuoteDto> {
    const quote = await this.quotes.settleQuote(req.user.userId, id, quoteId, body);
    res.status(quote.status === "submitted" ? 202 : 200);
    return quote;
  }

  /**
   * What exporting the crate would contain (#1965): the stems the caller owns
   * under a standard license with their download file names, the lines left
   * out and why, and the limits of each format. Needs no folder. A crate with
   * nothing to export still answers 200 with empty `entries`.
   */
  @UseGuards(AuthGuard("jwt"))
  @Throttle({ default: { limit: 20, ttl: minutes(1), getTracker: trackByUser } })
  @Get(":id/export/manifest")
  exportManifest(@Req() req: any, @Param("id") id: string): Promise<CrateExportManifestDto> {
    return this.crateExports.getManifest(req.user.userId, id);
  }

  /**
   * The crate as a rekordbox XML or a Serato crate (#1965), listing the stems
   * the caller owns under a standard license. The body is `{ format, folder }`:
   * `folder` is the absolute path of the directory the DJ saved the stems in.
   * It is written into the file and is never stored or logged. It travels in
   * the body, not the URL, because proxies and load balancers log URLs. Export
   * never grants a right: the stems are downloaded through the licensed
   * `POST /encryption/download` path. Answers 200 with the file.
   */
  @UseGuards(AuthGuard("jwt"))
  @Throttle({ default: { limit: 20, ttl: minutes(1), getTracker: trackByUser } })
  @Post(":id/export")
  @HttpCode(200)
  async exportCrate(
    @Req() req: any,
    @Param("id") id: string,
    @Body() body: ExportCrateDto,
    @Res({ passthrough: true }) res: { set(headers: Record<string, string | number>): unknown },
  ): Promise<StreamableFile> {
    const file = await this.crateExports.exportFile(req.user.userId, id, {
      format: body?.format,
      folder: body?.folder,
    });
    res.set({
      "Content-Type": file.contentType,
      "Content-Length": file.body.length,
      "Content-Disposition": contentDisposition(file.fileName),
      // Private to the caller, and the folder is in the file.
      "Cache-Control": "no-store",
    });
    return new StreamableFile(file.body);
  }
}
