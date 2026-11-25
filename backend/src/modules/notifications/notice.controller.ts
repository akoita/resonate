import { Body, Controller, Get, HttpCode, Param, Post, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { AllowWhileSuspended } from "../accounts/allow_while_suspended.decorator";
import { AdminAudit, auditRef } from "../admin_audit/admin_audit.interceptor";
import { RequireStepUp } from "../admin_step_up/require_step_up.decorator";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { BroadcastNoticeDto, TargetedNoticeDto } from "./notice.dto";
import { NoticeService } from "./notice.service";
import { parseBroadcastNoticeInput, parseTargetedNoticeInput } from "./notice_validation";

/**
 * Platform notices (#2146). Sending is operator/admin only; reading is for
 * the signed-in person, who only ever sees their own targeted notices and the
 * broadcasts for their audience. A broadcast reaches everyone in its audience and
 * cannot be recalled, so it also needs a fresh step-up proof (#2173).
 */
@Controller("notices")
export class NoticeController {
  constructor(private readonly notices: NoticeService) {}

  @UseGuards(AuthGuard("jwt"))
  @Get()
  list(@Req() req: any) {
    return this.notices.listForUser(req.user.userId, req.user.role);
  }

  /**
   * GET /notices/status — public (#2667): the active service status, if any,
   * for the sign-in screen. No session needed.
   */
  @Get("status")
  status() {
    return this.notices.currentStatus();
  }

  @UseGuards(AuthGuard("jwt"))
  @AllowWhileSuspended()
  @HttpCode(200)
  @Post(":id/read")
  markRead(@Req() req: any, @Param("id") id: string) {
    return this.notices.markRead(req.user.userId, req.user.role, id);
  }

  @UseGuards(AuthGuard("jwt"), RolesGuard)
  @Roles("admin", "operator")
  @Get("sent")
  listSent() {
    return this.notices.listSentBroadcasts();
  }

  @UseGuards(AuthGuard("jwt"), RolesGuard)
  @Roles("admin", "operator")
  @RequireStepUp()
  @Post("broadcast")
  broadcast(@Req() req: any, @Body() body: BroadcastNoticeDto) {
    const input = parseBroadcastNoticeInput(body);
    return this.notices.sendBroadcast(input, { userId: req.user.userId, role: req.user.role });
  }

  @UseGuards(AuthGuard("jwt"), RolesGuard)
  @Roles("admin", "operator")
  @Post("targeted")
  targeted(@Req() req: any, @Body() body: TargetedNoticeDto) {
    const input = parseTargetedNoticeInput(body);
    return this.notices.sendTargeted(input, { userId: req.user.userId, role: req.user.role });
  }

  /** End a broadcast now (#2667): clears its banner and the status line. */
  @UseGuards(AuthGuard("jwt"), RolesGuard)
  @Roles("admin", "operator")
  @AdminAudit("notice.broadcast_ended", (c) => ({ detail: { noticeId: auditRef(c.params.id) } }))
  @HttpCode(200)
  @Post(":id/end")
  end(@Param("id") id: string) {
    return this.notices.endBroadcast(id);
  }
}
