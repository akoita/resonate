import { Body, Controller, Delete, Get, HttpCode, Post, Put, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { Throttle } from "@nestjs/throttler";
import { AllowWhileSuspended } from "../accounts/allow_while_suspended.decorator";
import { hours } from "../shared/rate_limits";
import { ContactEmailService } from "./contact_email.service";
import { ContactEmailPreferencesDto, SetContactEmailDto } from "./email.dto";

/**
 * Tracked per person where the JWT has been resolved, else per IP (see PrivacyController).
 * In practice that is per IP: the global ThrottlerGuard runs before this route's
 * AuthGuard, so `req.user` is not set yet. These limits are a second layer; the
 * per-account limit is enforced in `ContactEmailService.reserveConfirmationSend`.
 */
const perUser = (req: Record<string, any>) => req.user?.userId ?? req.ip;

/**
 * The signed-in person's optional notice-email address (#2169). Every mutating
 * route works for a suspended or closed account too (`@AllowWhileSuspended`):
 * a restricted person must stay reachable, and these routes only manage how
 * the platform contacts them.
 */
@Controller("me/contact-email")
@UseGuards(AuthGuard("jwt"))
export class ContactEmailController {
  constructor(private readonly contactEmail: ContactEmailService) {}

  @Get()
  get(@Req() req: any) {
    return this.contactEmail.getState(req.user.userId);
  }

  @Put()
  @AllowWhileSuspended()
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: hours(1), getTracker: perUser } })
  set(@Req() req: any, @Body() body: SetContactEmailDto) {
    return this.contactEmail.setAddress(req.user.userId, body.address);
  }

  @Post("resend")
  @AllowWhileSuspended()
  @HttpCode(200)
  @Throttle({ default: { limit: 3, ttl: hours(1), getTracker: perUser } })
  resend(@Req() req: any) {
    return this.contactEmail.resend(req.user.userId);
  }

  @Delete()
  @AllowWhileSuspended()
  @HttpCode(204)
  async remove(@Req() req: any) {
    await this.contactEmail.remove(req.user.userId);
  }

  @Put("preferences")
  @AllowWhileSuspended()
  @HttpCode(200)
  setPreferences(@Req() req: any, @Body() body: ContactEmailPreferencesDto) {
    return this.contactEmail.setPreferences(req.user.userId, body.optOuts);
  }
}
