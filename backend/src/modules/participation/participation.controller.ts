import { Body, Controller, Get, Param, Patch, Post, Request, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { Roles } from "../auth/roles.decorator";
import { AdminAudit, auditRef } from "../admin_audit/admin_audit.interceptor";
import { AcceptParticipationDto, ConsentChoicesDto } from "./participation.dto";
import { ParticipationService } from "./participation.service";

/**
 * The artist participation agreement and consent choices (#2666).
 */
@Controller()
export class ParticipationController {
  constructor(private readonly participation: ParticipationService) {}

  /** The current agreement text, version and hash. Public, so it can be read before signing up. */
  @Get("participation/agreement")
  agreement() {
    const { version, text, textHash, placeholder, available } = this.participation.agreement();
    return { version, text, textHash, placeholder, available };
  }

  @UseGuards(AuthGuard("jwt"))
  @Get("artists/:id/participation")
  status(@Request() req: { user: { userId: string } }, @Param("id") id: string) {
    return this.participation.status(req.user.userId, id);
  }

  @UseGuards(AuthGuard("jwt"))
  @Post("artists/:id/participation/accept")
  accept(@Request() req: { user: { userId: string } }, @Param("id") id: string, @Body() body: AcceptParticipationDto) {
    return this.participation.accept(req.user.userId, id, body);
  }

  @UseGuards(AuthGuard("jwt"))
  @Patch("artists/:id/participation/choices")
  updateChoices(@Request() req: { user: { userId: string } }, @Param("id") id: string, @Body() body: ConsentChoicesDto) {
    return this.participation.updateChoices(req.user.userId, id, body);
  }

  /** Operators: the accepted versions, choices and their history for one artist. */
  @UseGuards(AuthGuard("jwt"))
  @Roles("admin", "operator")
  @Get("admin/artists/:id/participation")
  @AdminAudit("artist_participation.viewed", (c) => ({ detail: { artistId: auditRef(c.params.id) } }))
  describeForOperator(@Param("id") id: string) {
    return this.participation.describeForOperator(id);
  }
}
