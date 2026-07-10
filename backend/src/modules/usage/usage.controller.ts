import { Controller, Get, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { UsageService } from "./usage.service";

@Controller("usage")
export class UsageController {
  constructor(private readonly usageService: UsageService) {}

  /**
   * Unified usage summary (#1422): credits balance + per-kind usage limits +
   * plan tier for the authenticated user. Powers the Usage & Billing surface.
   */
  @UseGuards(AuthGuard("jwt"))
  @Get("summary")
  async summary(@Req() req: any) {
    const userId = req.user?.userId || req.user?.id || req.user?.sub;
    return this.usageService.getSummary(userId);
  }
}
