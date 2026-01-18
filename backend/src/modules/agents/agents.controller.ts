import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { Roles } from "../auth/roles.decorator";
import { AgentEvaluationService } from "./agent_evaluation.service";
import { AgentOrchestratorService } from "./agent_orchestrator.service";
import { AgentRunnerService } from "./agent_runner.service";

@Controller("agents")
export class AgentsController {
  constructor(
    private readonly agentRunner: AgentRunnerService,
    private readonly orchestrator: AgentOrchestratorService,
    private readonly evaluator: AgentEvaluationService
  ) {}

  @UseGuards(AuthGuard("jwt"))
  @Roles("admin")
  @Post("run")
  run(@Body() body: {
    sessionId: string;
    userId: string;
    trackId: string;
    recentTrackIds: string[];
    budgetRemainingUsd: number;
    preferences: {
      mood?: string;
      energy?: "low" | "medium" | "high";
      genres?: string[];
      allowExplicit?: boolean;
      licenseType?: "personal" | "remix" | "commercial";
    };
  }) {
    return this.agentRunner.run(body);
  }

  @UseGuards(AuthGuard("jwt"))
  @Roles("admin")
  @Post("orchestrate")
  orchestrate(@Body() body: {
    sessionId: string;
    userId: string;
    recentTrackIds: string[];
    budgetRemainingUsd: number;
    preferences: {
      mood?: string;
      energy?: "low" | "medium" | "high";
      genres?: string[];
      allowExplicit?: boolean;
      licenseType?: "personal" | "remix" | "commercial";
    };
  }) {
    return this.orchestrator.orchestrate(body);
  }

  @UseGuards(AuthGuard("jwt"))
  @Roles("admin")
  @Post("evaluate")
  evaluate(@Body() body: { sessions: Parameters<AgentEvaluationService["evaluate"]>[0] }) {
    return this.evaluator.evaluate(body.sessions);
  }
}
