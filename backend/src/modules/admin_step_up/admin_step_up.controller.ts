import { Body, Controller, HttpCode, Post, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { VerifyAdminStepUpDto } from "./admin_step_up.dto";
import { AdminStepUpService } from "./admin_step_up.service";

/**
 * Step-up confirmation for destructive admin actions (#2173). Open to the roles
 * that hold a destructive action (`admin` for account suspension and closure,
 * `admin` and `operator` for notices); the proof it issues is only ever checked
 * against the person who earned it.
 */
@Controller("admin/step-up")
export class AdminStepUpController {
  constructor(private readonly stepUp: AdminStepUpService) {}

  @UseGuards(AuthGuard("jwt"), RolesGuard)
  @Roles("admin", "operator")
  @HttpCode(200)
  @Post("challenge")
  challenge(@Req() req: any) {
    return this.stepUp.challenge(req.user.userId as string);
  }

  @UseGuards(AuthGuard("jwt"), RolesGuard)
  @Roles("admin", "operator")
  @HttpCode(200)
  @Post("verify")
  verify(@Req() req: any, @Body() body: VerifyAdminStepUpDto) {
    return this.stepUp.verify(req.user.userId as string, body);
  }
}
