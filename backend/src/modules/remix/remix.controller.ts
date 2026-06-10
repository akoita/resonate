import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { RemixService } from "./remix.service";
import { RemixEligibilityService } from "./remix-eligibility.service";
import {
  RemixProjectService,
  type RemixProjectStemUpdate,
} from "./remix-project.service";
import {
  RemixGenerationProviderError,
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
      force?: boolean;
    } = {},
  ) {
    try {
      return await this.projectService.generateDraft(req.user.userId, id, {
        constraints: body?.constraints,
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
}
