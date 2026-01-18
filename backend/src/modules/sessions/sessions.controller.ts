import { Body, Controller, Get, Post, Query, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { SessionsService } from "./sessions.service";

@Controller("sessions")
export class SessionsController {
  constructor(private readonly sessionsService: SessionsService) {}

  @UseGuards(AuthGuard("jwt"))
  @Post("start")
  start(
    @Body()
    body: {
      userId: string;
      budgetCapUsd: number;
      preferences?: {
        mood?: string;
        energy?: "low" | "medium" | "high";
        genres?: string[];
        allowExplicit?: boolean;
        licenseType?: "personal" | "remix" | "commercial";
      };
    }
  ) {
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

  @UseGuards(AuthGuard("jwt"))
  @Post("agent/next")
  agentNext(
    @Body()
    body: {
      sessionId: string;
      preferences?: {
        mood?: string;
        energy?: "low" | "medium" | "high";
        genres?: string[];
        allowExplicit?: boolean;
        licenseType?: "personal" | "remix" | "commercial";
      };
    }
  ) {
    return this.sessionsService.agentNext(body);
  }

  @UseGuards(AuthGuard("jwt"))
  @Get("playlist")
  playlist(@Query("limit") limit?: string) {
    const parsed = limit ? Number(limit) : 10;
    return this.sessionsService.getPlaylist(Number.isNaN(parsed) ? 10 : parsed);
  }
}
