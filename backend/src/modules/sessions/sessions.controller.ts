import { Body, Controller, Post } from "@nestjs/common";
import { SessionsService } from "./sessions.service";

@Controller("sessions")
export class SessionsController {
  constructor(private readonly sessionsService: SessionsService) {}

  @Post("start")
  start(@Body() body: { userId: string; budgetCapUsd: number }) {
    return this.sessionsService.startSession(body);
  }

  @Post("stop")
  stop(@Body() body: { sessionId: string }) {
    return this.sessionsService.stopSession(body.sessionId);
  }

  @Post("play")
  play(@Body() body: { sessionId: string; trackId: string; priceUsd: number }) {
    return this.sessionsService.playTrack(body);
  }
}
