import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { AdminAudit } from "../admin_audit/admin_audit.interceptor";
import { Roles } from "../auth/roles.decorator";
import { PreviewMeasuresService } from "./preview_measures.service";

/** Preview measures for the operator (#2670). Read-only, admin only, audited on view. */
@Controller("admin/preview-measures")
export class PreviewMeasuresController {
  constructor(private readonly measures: PreviewMeasuresService) {}

  /** GET /admin/preview-measures?from=&to= — at most 92 days; defaults to the last 28. */
  @UseGuards(AuthGuard("jwt"))
  @Roles("admin")
  @AdminAudit("preview_measures.viewed")
  @Get()
  get(@Query("from") from?: string, @Query("to") to?: string) {
    return this.measures.measures(from, to);
  }
}
