import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { SessionsService } from "./sessions.service";

@Controller("sessions")
export class SessionsController {
  constructor(private readonly sessionsService: SessionsService) {}

  @UseGuards(AuthGuard("jwt"))
  @Post("start")
  start(@Body() body: { userId: string; budgetCapUsd: number }) {
    return this.sessionsService.startSession(body);
  }

  @UseGuards(AuthGuard("jwt"))
  @Post("stop")
  stop(@Body() body: { sessionId: string }) {
    return this.sessionsService.stopSession(body.sessionId);
  }

  @UseGuards(AuthGuard("jwt"))
  @Post("play")
  play(@Body() body: { sessionId: string; trackId: string; priceUsd: number }) {
    return this.sessionsService.playTrack(body);
  }
}
