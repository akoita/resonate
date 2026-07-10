import {
  BadRequestException,
  Controller,
  Get,
  Query,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { PunchlineEligibilityService } from "./punchline-eligibility.service";

@Controller("punchline")
export class PunchlineController {
  constructor(
    private readonly eligibilityService: PunchlineEligibilityService,
  ) {}

  /**
   * Explainable eligibility check for creating a Punchline Drop from a track
   * (#480). JWT-guarded; the create/publish APIs (#482) re-run the same gate
   * server-side. Returns allow/deny with typed reasons and the collectible
   * rights label so the UI can render the gate and the rights posture together.
   */
  @UseGuards(AuthGuard("jwt"))
  @Get("eligibility")
  checkEligibility(@Query("trackId") trackId?: string) {
    if (!trackId) {
      throw new BadRequestException("trackId query parameter is required");
    }
    return this.eligibilityService.checkEligibility(trackId);
  }
}
