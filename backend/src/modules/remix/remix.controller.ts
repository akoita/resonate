import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { Response } from "express";
import { RemixService } from "./remix.service";
import { RemixEligibilityService } from "./remix-eligibility.service";
import {
  RemixProjectService,
  type RemixProjectStemUpdate,
} from "./remix-project.service";
import {
  RemixGenerationProviderError,
  validateRemixGenerationConstraints,
  type RemixGenerationConstraints,
  type RemixGenerationErrorCode,
} from "./remix-generation.provider";

const GENERATION_ERROR_STATUS: Record<RemixGenerationErrorCode, number> = {
  provider_disabled: 503,
  provider_unavailable: 503,
  invalid_input: 400,
  provider_rejected: 422,
};

@Controller("remix")
export class RemixController {
  constructor(
    private readonly remixService: RemixService,
    private readonly eligibilityService: RemixEligibilityService,
    private readonly projectService: RemixProjectService,
  ) {}

  @UseGuards(AuthGuard("jwt"))
  @Get("eligibility")
  checkEligibility(
    @Req() req: any,
    @Query("trackId") trackId?: string,
    @Query("stemIds") stemIds?: string,
  ) {
    if (!trackId) {
      throw new BadRequestException("trackId query parameter is required");
    }
    const parsedStemIds = stemIds
      ? stemIds
          .split(",")
          .map((stemId) => stemId.trim())
          .filter(Boolean)
      : undefined;
    return this.eligibilityService.checkEligibility({
      userId: req.user.userId,
      trackId,
      stemIds: parsedStemIds,
    });
  }

  @UseGuards(AuthGuard("jwt"))
  @Post("projects")
  createProject(
    @Req() req: any,
    @Body()
    body: {
      sourceTrackId: string;
      stemIds: string[];
      title: string;
      mode?: string;
      prompt?: string | null;
    },
  ) {
    return this.projectService.createProject({
      userId: req.user.userId,
      sourceTrackId: body.sourceTrackId,
      stemIds: body.stemIds,
      title: body.title,
      mode: body.mode,
      prompt: body.prompt,
    });
  }

  @UseGuards(AuthGuard("jwt"))
  @Get("projects")
  listProjects(@Req() req: any) {
    return this.projectService.listProjects(req.user.userId);
  }

  @UseGuards(AuthGuard("jwt"))
  @Get("projects/:id/draft-audio")
  async getDraftAudio(
    @Req() req: any,
    @Param("id") id: string,
    @Headers("range") range: string,
    @Res() res: Response,
  ) {
    const audio = await this.projectService.getDraftAudio(req.user.userId, id);
    this.sendAudioResponse(audio, range, res);
  }

  @UseGuards(AuthGuard("jwt"))
  @Get("projects/:id")
  getProject(@Req() req: any, @Param("id") id: string) {
    return this.projectService.getProject(req.user.userId, id);
  }

  @UseGuards(AuthGuard("jwt"))
  @Patch("projects/:id")
  updateProject(
    @Req() req: any,
    @Param("id") id: string,
    @Body()
    body: {
      title?: string;
      prompt?: string | null;
      status?: string;
      mode?: string;
      stems?: RemixProjectStemUpdate[];
    },
  ) {
    return this.projectService.updateProject(req.user.userId, id, body);
  }

  @UseGuards(AuthGuard("jwt"))
  @Post("projects/:id/generate")
  async generateDraft(
    @Req() req: any,
    @Param("id") id: string,
    @Body()
    body: {
      constraints?: RemixGenerationConstraints;
      retry?: boolean;
      force?: boolean;
    } = {},
  ) {
    // Bounds before any project/provider work (#1162): out-of-range
    // durations or tempos must never reach a paid provider.
    const constraintProblems = validateRemixGenerationConstraints(
      body?.constraints,
    );
    if (constraintProblems.length > 0) {
      throw new BadRequestException({
        message: "Invalid generation constraints",
        problems: constraintProblems,
      });
    }
    try {
      return await this.projectService.generateDraft(req.user.userId, id, {
        constraints: body?.constraints,
        retry: body?.retry,
        force: body?.force,
      });
    } catch (error) {
      if (error instanceof RemixGenerationProviderError) {
        // Normalized provider error contract consumed by the studio panel.
        throw new HttpException(
          {
            code: error.code,
            message: error.message,
            retryable: error.retryable,
          },
          GENERATION_ERROR_STATUS[error.code],
        );
      }
      throw error;
    }
  }

  /**
   * Legacy compatibility endpoint. Creates an in-memory remix record for the
   * early event-flow experiment. Durable remix work must use
   * POST /remix/projects; this endpoint is slated for removal with the Remix
   * Studio frontend slices (#894+).
   */
  @UseGuards(AuthGuard("jwt"))
  @Post("create")
  create(
    @Req() req: any,
    @Body()
    body: { sourceTrackId: string; stemIds: string[]; title: string },
  ) {
    return this.remixService.createRemix({
      // Creator identity always comes from the JWT, never the request body.
      creatorId: req.user.userId,
      sourceTrackId: body.sourceTrackId,
      stemIds: body.stemIds,
      title: body.title,
    });
  }

  /** Legacy compatibility read for the in-memory remix experiment. */
  @UseGuards(AuthGuard("jwt"))
  @Get(":remixId")
  get(@Param("remixId") remixId: string) {
    return this.remixService.getRemix(remixId);
  }

  private sendAudioResponse(
    audio: { data: Buffer; mimeType?: string | null },
    range: string,
    res: Response,
  ) {
    const fileSize = audio.data.length;
    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = Number.parseInt(parts[0], 10);
      const parsedEnd = parts[1] ? Number.parseInt(parts[1], 10) : fileSize - 1;
      if (!Number.isFinite(start) || start >= fileSize) {
        res.status(416).set({ "Content-Range": `bytes */${fileSize}` }).send();
        return;
      }
      const boundedEnd = Number.isFinite(parsedEnd)
        ? Math.min(parsedEnd, fileSize - 1)
        : fileSize - 1;
      if (boundedEnd < start) {
        res.status(416).set({ "Content-Range": `bytes */${fileSize}` }).send();
        return;
      }
      const chunk = audio.data.subarray(start, boundedEnd + 1);
      res.status(206).set({
        "Content-Range": `bytes ${start}-${boundedEnd}/${fileSize}`,
        "Accept-Ranges": "bytes",
        "Content-Length": chunk.length,
        "Content-Type": audio.mimeType || "audio/mpeg",
        "Cache-Control": "private, no-store",
      });
      res.end(chunk);
      return;
    }

    res.set({
      "Content-Length": fileSize,
      "Content-Type": audio.mimeType || "audio/mpeg",
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, no-store",
    });
    res.end(audio.data);
  }
}
