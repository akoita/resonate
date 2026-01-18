import { Module } from "@nestjs/common";
import { EventBus } from "../shared/event_bus";
import { AgentPolicyService } from "./agent_policy.service";
import { AgentRunnerService } from "./agent_runner.service";
import { AgentsController } from "./agents.controller";

@Module({
  controllers: [AgentsController],
  providers: [EventBus, AgentPolicyService, AgentRunnerService],
})
export class AgentsModule {}
