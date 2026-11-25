import { Body, Controller, Get, HttpCode, Param, Post, Put, Query, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { AdminAudit, auditNumber, auditResult } from "../admin_audit/admin_audit.interceptor";
import { OptionalJwtAuthGuard } from "../auth/optional-jwt.guard";
import { Roles } from "../auth/roles.decorator";
import { SaveCompositionDto } from "./composition.dto";
import { CompositionService } from "./composition.service";

type AuthedRequest = { user: { userId: string; role?: string } };
type OptionalRequest = { user?: { userId?: string; role?: string } };

/**
 * Composition details per track (#2669): writers, publisher, work code and the
 * cover or samples declaration, plus the operator usage export.
 */
@Controller()
export class CompositionController {
  constructor(private readonly composition: CompositionService) {}

  /**
   * GET /catalog/releases/:releaseId/composition — full details for the
   * artist, a manager or an operator; writer names and roles for everyone
   * else, on a public release only.
   */
  @UseGuards(OptionalJwtAuthGuard)
  @Get("catalog/releases/:releaseId/composition")
  get(@Req() req: OptionalRequest, @Param("releaseId") releaseId: string) {
    return this.composition.getForRelease(releaseId, { userId: req.user?.userId, role: req.user?.role });
  }

  /** PUT — replace one track's details. Release owner or a track-metadata manager. */
  @UseGuards(AuthGuard("jwt"))
  @Put("catalog/releases/:releaseId/tracks/:trackId/composition")
  save(
    @Req() req: AuthedRequest,
    @Param("releaseId") releaseId: string,
    @Param("trackId") trackId: string,
    @Body() body: SaveCompositionDto,
  ) {
    return this.composition.saveForTrack(releaseId, trackId, req.user.userId, body);
  }

  /** POST — copy one track's details to the other tracks of the release. */
  @UseGuards(AuthGuard("jwt"))
  @HttpCode(200)
  @Post("catalog/releases/:releaseId/tracks/:trackId/composition/copy")
  copy(@Req() req: AuthedRequest, @Param("releaseId") releaseId: string, @Param("trackId") trackId: string) {
    return this.composition.copyToRelease(releaseId, trackId, req.user.userId);
  }

  /** GET /admin/composition/usage-export — CSV of plays per track with composition details. */
  @UseGuards(AuthGuard("jwt"))
  @Roles("admin", "operator")
  @AdminAudit("composition.usage_exported", (c) => {
    const result = auditResult(c);
    return { detail: { rows: auditNumber(result.rows) } };
  })
  @Get("admin/composition/usage-export")
  usageExport(@Query("from") from?: string, @Query("to") to?: string) {
    return this.composition.usageExport(from, to);
  }
}
