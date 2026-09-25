import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Request,
  UseGuards,
  ValidationPipe,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import {
  DismissCreditRequestDto,
  GrantCreditRequestDto,
  GrantCreditsDto,
  ListCreditRequestsQueryDto,
  RequestCreditsDto,
} from "./credits.dto";
import { GenerationCreditsService } from "./generation-credits.service";

/**
 * This app installs no global ValidationPipe, so every credits route that
 * takes a body or query validates its DTO explicitly with this route-scoped pipe.
 */
const validate = new ValidationPipe({ whitelist: true, transform: true });

/**
 * Generation-credit meter endpoints (#1334).
 *
 * - GET  /credits/balance — the caller's own balance + recent ledger entries.
 * - POST /credits/request — a user out of credits queues a request for an
 *   operator top-up (#1885: persisted, one pending request per user).
 * - POST /credits/grant   — operator/promo seed path (staging). Mirrors the
 *   operator-only lifecycle routes on the shows controller. Live fiat top-up is
 *   the deferred production flip and is intentionally NOT exposed here.
 * - GET  /credits/requests, POST /credits/requests/:id/{grant,dismiss} — the
 *   operator credit-request queue (#1885), admin/operator only.
 */
@Controller("credits")
export class CreditsController {
  constructor(private readonly credits: GenerationCreditsService) {}

  @UseGuards(AuthGuard("jwt"))
  @Get("balance")
  getBalance(@Request() req: any) {
    return this.credits.getBalance(req.user.userId);
  }

  @UseGuards(AuthGuard("jwt"))
  @Post("request")
  async request(@Request() req: any, @Body(validate) dto: RequestCreditsDto) {
    await this.credits.requestOperatorCredits(req.user.userId, dto.note);
    return { status: "notified" };
  }

  @UseGuards(AuthGuard("jwt"), RolesGuard)
  @Roles("admin", "operator")
  @Post("grant")
  async grant(@Body(validate) dto: GrantCreditsDto) {
    const balanceCents = await this.credits.grant(
      dto.userId,
      dto.amountCents,
      dto.reason,
    );
    return { userId: dto.userId, balanceCents };
  }

  @UseGuards(AuthGuard("jwt"), RolesGuard)
  @Roles("admin", "operator")
  @Get("requests")
  listRequests(@Query(validate) query: ListCreditRequestsQueryDto) {
    return this.credits.listCreditRequests(query.status ?? "pending");
  }

  @UseGuards(AuthGuard("jwt"), RolesGuard)
  @Roles("admin", "operator")
  @Post("requests/:id/grant")
  grantRequest(
    @Request() req: any,
    @Param("id") id: string,
    @Body(validate) dto: GrantCreditRequestDto,
  ) {
    return this.credits.grantCreditRequest(
      id,
      req.user.userId,
      dto.amountCents,
      dto.reason,
    );
  }

  @UseGuards(AuthGuard("jwt"), RolesGuard)
  @Roles("admin", "operator")
  @Post("requests/:id/dismiss")
  dismissRequest(
    @Request() req: any,
    @Param("id") id: string,
    @Body(validate) dto: DismissCreditRequestDto,
  ) {
    return this.credits.dismissCreditRequest(id, req.user.userId, dto.note);
  }
}
