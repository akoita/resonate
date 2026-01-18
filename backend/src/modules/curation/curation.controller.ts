import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { Throttle } from "@nestjs/throttler";
import { Roles } from "../auth/roles.decorator";
import { CurationService } from "./curation.service";

@Controller("curation")
export class CurationController {
  constructor(private readonly curationService: CurationService) {}

  @UseGuards(AuthGuard("jwt"))
  @Post("stake")
  @Roles("curator", "admin")
  @Throttle({ default: { limit: 10, ttl: 60 } })
  stake(@Body() body: { curatorId: string; amountUsd: number }) {
    return this.curationService.stake(body);
  }

  @UseGuards(AuthGuard("jwt"))
  @Get("stake/:curatorId")
  @Roles("curator", "admin")
  getStake(@Param("curatorId") curatorId: string) {
    return this.curationService.getStake(curatorId);
  }

  @UseGuards(AuthGuard("jwt"))
  @Post("report")
  @Roles("curator", "admin")
  @Throttle({ default: { limit: 15, ttl: 60 } })
  report(@Body() body: { curatorId: string; trackId: string; reason: string }) {
    return this.curationService.report(body);
  }

  @UseGuards(AuthGuard("jwt"))
  @Get("reports")
  @Roles("admin")
  listReports() {
    return { reports: this.curationService.listReports() };
  }
}
