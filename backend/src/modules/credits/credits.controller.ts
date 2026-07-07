import { Body, Controller, Get, Post, Request, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { GrantCreditsDto } from "./credits.dto";
import { GenerationCreditsService } from "./generation-credits.service";

/**
 * Generation-credit meter endpoints (#1334).
 *
 * - GET  /credits/balance — the caller's own balance + recent ledger entries.
 * - POST /credits/grant   — operator/promo seed path (staging). Mirrors the
 *   operator-only lifecycle routes on the shows controller. Live fiat top-up is
 *   the deferred production flip and is intentionally NOT exposed here.
 */
@Controller("credits")
export class CreditsController {
  constructor(private readonly credits: GenerationCreditsService) {}

  @UseGuards(AuthGuard("jwt"))
  @Get("balance")
  getBalance(@Request() req: any) {
    return this.credits.getBalance(req.user.userId);
  }

  @UseGuards(AuthGuard("jwt"), RolesGuard)
  @Roles("admin", "operator")
  @Post("grant")
  async grant(@Body() dto: GrantCreditsDto) {
    const balanceCents = await this.credits.grant(
      dto.userId,
      dto.amountCents,
      dto.reason,
    );
    return { userId: dto.userId, balanceCents };
  }
}
