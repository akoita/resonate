import { Type } from "class-transformer";
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from "class-validator";
import type { AgentEvaluationService } from "./agent_evaluation.service";

/**
 * Agent run bodies (#2197). Type checks only. These are admin tooling routes
 * (`@Roles("admin")`) that hand the body to the runner as given.
 */
export class AgentRunPreferencesDto {
  @IsOptional()
  @IsString()
  mood?: string;

  @IsOptional()
  @IsIn(["low", "medium", "high"])
  energy?: "low" | "medium" | "high";

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  genres?: string[];

  @IsOptional()
  @IsBoolean()
  allowExplicit?: boolean;

  @IsOptional()
  @IsIn(["personal", "remix", "commercial"])
  licenseType?: "personal" | "remix" | "commercial";
}

export class OrchestrateAgentDto {
  @IsString()
  sessionId!: string;

  @IsString()
  userId!: string;

  @IsArray()
  @IsString({ each: true })
  recentTrackIds!: string[];

  @IsNumber()
  budgetRemainingUsd!: number;

  @IsObject()
  @ValidateNested()
  @Type(() => AgentRunPreferencesDto)
  preferences!: AgentRunPreferencesDto;
}

/** POST /agents/runtime takes the same body as orchestrate. */
export class RuntimeRunAgentDto extends OrchestrateAgentDto {}

export class RunAgentDto extends OrchestrateAgentDto {
  @IsString()
  trackId!: string;
}

export class EvaluateAgentDto {
  @IsArray()
  sessions!: Parameters<AgentEvaluationService["evaluate"]>[0];

  @IsOptional()
  @IsIn(["vertex", "langgraph", "local"])
  runtime?: "vertex" | "langgraph" | "local";
}
