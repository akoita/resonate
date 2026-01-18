import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { CurationService } from "./curation.service";

@Controller("curation")
export class CurationController {
  constructor(private readonly curationService: CurationService) {}

  @UseGuards(AuthGuard("jwt"))
  @Post("stake")
  stake(@Body() body: { curatorId: string; amountUsd: number }) {
    return this.curationService.stake(body);
  }

  @UseGuards(AuthGuard("jwt"))
  @Get("stake/:curatorId")
  getStake(@Param("curatorId") curatorId: string) {
    return this.curationService.getStake(curatorId);
  }

  @UseGuards(AuthGuard("jwt"))
  @Post("report")
  report(@Body() body: { curatorId: string; trackId: string; reason: string }) {
    return this.curationService.report(body);
  }

  @UseGuards(AuthGuard("jwt"))
  @Get("reports")
  listReports() {
    return { reports: this.curationService.listReports() };
  }
}
