import { BadRequestException, Body, Controller, Get, Param, Post, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import {
  AgentReputationFeedbackService,
  FEEDBACK_KINDS,
  SUBMITTER_ROLES,
  type FeedbackKind,
  type SubmitterRole,
} from "./agent_reputation_feedback.service";

type SubmitFeedbackBody = {
  submitterRole: SubmitterRole;
  feedbackKind: FeedbackKind;
  score: number;
  submitterIdentifier?: string | null;
  evidenceUri?: string | null;
  notes?: string | null;
  referenceType?: string | null;
  referenceId?: string | null;
};

function validateEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string,
): T {
  if (typeof value === "string" && (allowed as readonly string[]).includes(value)) {
    return value as T;
  }
  throw new BadRequestException(`${field} must be one of ${allowed.join(", ")}`);
}

@Controller("agents/:agentConfigId/reputation/feedback")
export class AgentReputationFeedbackController {
  constructor(private readonly feedbackService: AgentReputationFeedbackService) {}

  @Post()
  @UseGuards(AuthGuard("jwt"))
  async submit(
    @Req() req: any,
    @Param("agentConfigId") agentConfigId: string,
    @Body() body: SubmitFeedbackBody,
  ) {
    const submitterRole = validateEnum(body.submitterRole, SUBMITTER_ROLES, "submitterRole");
    const feedbackKind = validateEnum(body.feedbackKind, FEEDBACK_KINDS, "feedbackKind");
    if (typeof body.score !== "number") {
      throw new BadRequestException("score is required");
    }

    return this.feedbackService.submitFeedback({
      subjectAgentConfigId: agentConfigId,
      submitterUserId: req.user?.userId ?? null,
      submitterRole,
      submitterIdentifier: body.submitterIdentifier ?? null,
      feedbackKind,
      score: body.score,
      evidenceUri: body.evidenceUri ?? null,
      notes: body.notes ?? null,
      referenceType: body.referenceType ?? null,
      referenceId: body.referenceId ?? null,
    });
  }

  @Get()
  @UseGuards(AuthGuard("jwt"))
  async list(@Param("agentConfigId") agentConfigId: string) {
    return this.feedbackService.listFeedback(agentConfigId);
  }

  @Get("summary")
  @UseGuards(AuthGuard("jwt"))
  async summary(@Param("agentConfigId") agentConfigId: string) {
    return this.feedbackService.summarize(agentConfigId);
  }
}
