import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { RemixService } from "./remix.service";

@Controller("remix")
export class RemixController {
  constructor(private readonly remixService: RemixService) {}

  @UseGuards(AuthGuard("jwt"))
  @Post("create")
  create(
    @Body()
    body: { creatorId: string; sourceTrackId: string; stemIds: string[]; title: string }
  ) {
    return this.remixService.createRemix(body);
  }

  @UseGuards(AuthGuard("jwt"))
  @Get(":remixId")
  get(@Param("remixId") remixId: string) {
    return this.remixService.getRemix(remixId);
  }
}
