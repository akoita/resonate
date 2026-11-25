import { Body, Controller, Get, Post, Request, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { Throttle } from "@nestjs/throttler";
import { seconds } from "../shared/rate_limits";
import { OptionalJwtAuthGuard } from "../auth/optional-jwt.guard";
import { InvitationCodeDto, JoinWaitlistDto } from "./invitations.dto";
import { InvitationsService } from "./invitations.service";

/**
 * Public side of invitation-only registration (#2662): what mode sign-up is
 * in, a read-only code check, the waiting list, and founding artists' own
 * listener codes. Code checks are rate limited so codes cannot be guessed.
 */
@Controller()
export class InvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  @Get("auth/registration")
  registration() {
    return this.invitations.registrationStatus();
  }

  @Post("auth/invitations/check")
  @Throttle({ default: { limit: 10, ttl: seconds(60) } })
  check(@Body() body: InvitationCodeDto) {
    return this.invitations.check(body.code);
  }

  /** A signed-in account uses an artist code (how a listener becomes a founding artist). */
  @UseGuards(AuthGuard("jwt"))
  @Post("invitations/redeem")
  @Throttle({ default: { limit: 10, ttl: seconds(60) } })
  redeem(@Request() req: any, @Body() body: InvitationCodeDto) {
    return this.invitations.redeemForExistingAccount(req.user.userId, body.code);
  }

  @UseGuards(AuthGuard("jwt"))
  @Get("invitations/mine")
  listMine(@Request() req: any) {
    return this.invitations.listMine(req.user.userId);
  }

  @UseGuards(AuthGuard("jwt"))
  @Post("invitations/mine")
  @Throttle({ default: { limit: 10, ttl: seconds(60) } })
  createMine(@Request() req: any) {
    return this.invitations.createMine(req.user.userId);
  }

  @UseGuards(OptionalJwtAuthGuard)
  @Post("waitlist")
  @Throttle({ default: { limit: 5, ttl: seconds(60) } })
  joinWaitlist(@Request() req: any, @Body() body: JoinWaitlistDto) {
    return this.invitations.joinWaitlist(body, req.user?.userId);
  }
}
