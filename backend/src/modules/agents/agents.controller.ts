import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { Roles } from "../auth/roles.decorator";
import { AgentEvaluationService } from "./agent_evaluation.service";
import { AgentGoldenEvalService } from "./agent_golden_eval.service";
import { AgentOrchestratorService } from "./agent_orchestrator.service";
import { AgentRuntimeService } from "./agent_runtime.service";
import { AgentRunnerService } from "./agent_runner.service";
import { EvaluateAgentDto, OrchestrateAgentDto, RunAgentDto, RuntimeRunAgentDto } from "./agents.dto";

@Controller("agents")
export class AgentsController {
  constructor(
    private readonly agentRunner: AgentRunnerService,
    private readonly orchestrator: AgentOrchestratorService,
    private readonly evaluator: AgentEvaluationService,
    private readonly goldenEval: AgentGoldenEvalService,
    private readonly runtime: AgentRuntimeService
  ) {}

  @UseGuards(AuthGuard("jwt"))
  @Roles("admin")
  @Post("run")
  run(@Body() body: RunAgentDto) {
    return this.agentRunner.run(body);
  }

  @UseGuards(AuthGuard("jwt"))
  @Roles("admin")
  @Post("evaluate/golden")
  evaluateGolden() {
    return this.goldenEval.run();
  }

  @UseGuards(AuthGuard("jwt"))
  @Roles("admin")
  @Post("orchestrate")
  orchestrate(@Body() body: OrchestrateAgentDto) {
    return this.orchestrator.orchestrate(body);
  }

  @UseGuards(AuthGuard("jwt"))
  @Roles("admin")
  @Post("evaluate")
  evaluate(@Body() body: EvaluateAgentDto) {
    return this.evaluator.evaluate(body.sessions, { runtime: body.runtime });
  }

  @UseGuards(AuthGuard("jwt"))
  @Roles("admin")
  @Post("runtime")
  runtimeRun(@Body() body: RuntimeRunAgentDto) {
    return this.runtime.run(body);
  }
}
