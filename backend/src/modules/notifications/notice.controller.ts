import { Body, Controller, Get, HttpCode, Param, Post, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { AllowWhileSuspended } from "../accounts/allow_while_suspended.decorator";
import { RequireStepUp } from "../admin_step_up/require_step_up.decorator";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
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
  broadcast(@Req() req: any, @Body() body: unknown) {
    const input = parseBroadcastNoticeInput(body);
    return this.notices.sendBroadcast(input, { userId: req.user.userId, role: req.user.role });
  }

  @UseGuards(AuthGuard("jwt"), RolesGuard)
  @Roles("admin", "operator")
  @Post("targeted")
  targeted(@Req() req: any, @Body() body: unknown) {
    const input = parseTargetedNoticeInput(body);
    return this.notices.sendTargeted(input, { userId: req.user.userId, role: req.user.role });
  }
}
