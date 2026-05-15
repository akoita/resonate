import { Injectable, Logger } from "@nestjs/common";
import { GoogleGenerativeAI, SchemaType, type ResponseSchema } from "@google/generative-ai";
import {
  AgentModelRankingDecision,
  AgentRecommendationAdapter,
  AgentRecommendationInput,
  AgentRecommendationResult,
} from "./agent_recommendation.adapter";
import { AgentCandidateTrack } from "./agent_selector.service";
import { DeterministicRecommendationAdapter } from "./deterministic_recommendation.adapter";

const MODEL_TIMEOUT_MS = 15_000;
const MODEL_CANDIDATE_LIMIT = 12;
const DEFAULT_MIN_CONFIDENCE = 0.55;

const MODEL_RESPONSE_SCHEMA: ResponseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    summary: {
      type: SchemaType.STRING,
    },
    decisions: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          trackId: { type: SchemaType.STRING },
          action: { type: SchemaType.STRING, format: "enum", enum: ["select", "reject"] },
          relevance: { type: SchemaType.STRING, format: "enum", enum: ["exact", "semantic", "none"] },
          confidence: { type: SchemaType.NUMBER },
          rank: { type: SchemaType.INTEGER },
          explanation: { type: SchemaType.STRING },
          rejectionReason: { type: SchemaType.STRING },
        },
        required: ["trackId", "action", "relevance", "confidence", "rank"],
      },
    },
  },
  required: ["summary", "decisions"],
};

interface AgentModelRankingResponse {
  summary: string;
  decisions: AgentModelRankingDecision[];
}

@Injectable()
export class ModelAssistedRecommendationAdapter implements AgentRecommendationAdapter {
  readonly name = "model-assisted" as const;
  private readonly logger = new Logger(ModelAssistedRecommendationAdapter.name);

  constructor(private readonly deterministicAdapter: DeterministicRecommendationAdapter) {}

  async recommend(input: AgentRecommendationInput): Promise<AgentRecommendationResult> {
    const apiKey = process.env.GOOGLE_AI_API_KEY;
    if (!apiKey) {
      this.logger.warn("GOOGLE_AI_API_KEY not set; using deterministic recommendation adapter");
      return this.deterministicFallback(input, "missing_google_ai_api_key");
    }

    const candidateLimit = Math.max(input.limit, MODEL_CANDIDATE_LIMIT);
    const deterministic = await this.deterministicAdapter.recommend({
      ...input,
      limit: candidateLimit,
    });

    if (deterministic.selected.length === 0) {
      return {
        ...deterministic,
        strategy: this.name,
        trace: {
          strategy: this.name,
          fallbackReason: "no_deterministic_candidates",
          decisions: [],
        },
      };
    }

    try {
      const modelName = this.modelName();
      const response = await this.withTimeout(
        this.rankWithModel(apiKey, modelName, input, deterministic.selected),
        MODEL_TIMEOUT_MS,
      );
      return this.applyStrictGuards(input, deterministic, response, modelName);
    } catch (error) {
      this.logger.warn(`Model-assisted recommendation failed; using deterministic fallback: ${this.describeError(error)}`);
      return {
        ...this.limitDeterministic(deterministic, input.limit),
        strategy: "deterministic",
        trace: {
          strategy: "deterministic",
          fallbackReason: "model_adapter_failure",
        },
      };
    }
  }

  private async deterministicFallback(
    input: AgentRecommendationInput,
    fallbackReason: string,
  ): Promise<AgentRecommendationResult> {
    const result = await this.deterministicAdapter.recommend(input);
    return {
      ...result,
      strategy: "deterministic",
      trace: {
        strategy: "deterministic",
        fallbackReason,
      },
    };
  }

  private async rankWithModel(
    apiKey: string,
    modelName: string,
    input: AgentRecommendationInput,
    candidates: AgentCandidateTrack[],
  ): Promise<AgentModelRankingResponse> {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: modelName,
      systemInstruction: this.systemInstruction(),
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: MODEL_RESPONSE_SCHEMA,
      },
    });

    const response = await model.generateContent(this.userPrompt(input, candidates));
    const text = response.response.text();
    return this.parseResponse(text);
  }

  private applyStrictGuards(
    input: AgentRecommendationInput,
    deterministic: AgentRecommendationResult,
    response: AgentModelRankingResponse,
    modelName: string,
  ): AgentRecommendationResult {
    const minConfidence = this.minConfidence();
    const candidateById = new Map(deterministic.selected.map((candidate) => [candidate.id, candidate]));
    const rejected = [...deterministic.rejected];
    const selected: AgentCandidateTrack[] = [];
    const seen = new Set<string>();

    const rankedDecisions = [...response.decisions].sort((a, b) => {
      if (a.rank !== b.rank) return a.rank - b.rank;
      return b.confidence - a.confidence;
    });

    for (const decision of rankedDecisions) {
      if (seen.has(decision.trackId)) continue;
      seen.add(decision.trackId);

      const candidate = candidateById.get(decision.trackId);
      if (!candidate) {
        rejected.push({ trackId: decision.trackId, reason: "model_selected_unknown_candidate" });
        continue;
      }

      if (decision.action !== "select") {
        rejected.push({ trackId: decision.trackId, reason: decision.rejectionReason ?? "model_rejected" });
        continue;
      }

      if (input.recentTrackIds.includes(decision.trackId)) {
        rejected.push({ trackId: decision.trackId, reason: "recently_played" });
        continue;
      }

      if (decision.relevance === "none") {
        rejected.push({ trackId: decision.trackId, reason: "model_relevance_guard" });
        continue;
      }

      if (!Number.isFinite(decision.confidence) || decision.confidence < minConfidence) {
        rejected.push({ trackId: decision.trackId, reason: "model_confidence_guard" });
        continue;
      }

      if (selected.length < input.limit) {
        selected.push(this.withModelRecommendation(candidate, decision, response.summary, modelName));
      } else {
        rejected.push({ trackId: decision.trackId, reason: "model_selection_limit" });
      }
    }

    const rejectedIds = new Set(rejected.map((candidate) => candidate.trackId));
    for (const candidate of deterministic.selected) {
      if (selected.some((track) => track.id === candidate.id) || rejectedIds.has(candidate.id)) {
        continue;
      }
      rejected.push({ trackId: candidate.id, reason: "not_selected_by_model" });
    }

    return {
      strategy: this.name,
      candidates: deterministic.candidates,
      selected,
      rejected: this.uniqueRejected(rejected),
      reason: selected.length > 0 ? "model_ranked_shortlist" : "model_no_matching_taste_candidates",
      trace: {
        strategy: this.name,
        model: modelName,
        summary: response.summary,
        decisions: rankedDecisions,
      },
    };
  }

  private withModelRecommendation(
    candidate: AgentCandidateTrack,
    decision: AgentModelRankingDecision,
    summary: string,
    modelName: string,
  ): AgentCandidateTrack {
    const existing = candidate.agentRecommendation;
    const explanation = decision.explanation
      ? [decision.explanation]
      : existing?.explanation?.length
        ? existing.explanation
        : [summary];
    const confidenceWeight = Math.round(Math.min(1, Math.max(0, decision.confidence)) * 20);

    return {
      ...candidate,
      agentRecommendation: {
        score: Math.max(existing?.score ?? 0, confidenceWeight),
        matchedQueries: existing?.matchedQueries ?? [],
        signals: [
          ...(existing?.signals ?? []),
          {
            label: "model_semantic_rank",
            weight: confidenceWeight,
            reason: `${decision.relevance} relevance at ${(decision.confidence * 100).toFixed(0)}% confidence`,
          },
        ],
        explanation,
        ...(existing?.audioFeatures ? { audioFeatures: existing.audioFeatures } : {}),
        trace: {
          model: modelName,
          rank: decision.rank,
          relevance: decision.relevance,
          confidence: decision.confidence,
          summary,
        },
      },
    };
  }

  private parseResponse(text: string): AgentModelRankingResponse {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error("malformed_model_ranking_json");
    }

    if (!this.isRecord(parsed) || typeof parsed.summary !== "string" || !Array.isArray(parsed.decisions)) {
      throw new Error("invalid_model_ranking_shape");
    }

    const decisions = parsed.decisions.map((value) => this.parseDecision(value));
    return {
      summary: parsed.summary,
      decisions,
    };
  }

  private parseDecision(value: unknown): AgentModelRankingDecision {
    if (!this.isRecord(value)) {
      throw new Error("invalid_model_ranking_decision");
    }
    const trackId = typeof value.trackId === "string" ? value.trackId : "";
    const action = value.action === "select" || value.action === "reject" ? value.action : null;
    const relevance = value.relevance === "exact" || value.relevance === "semantic" || value.relevance === "none"
      ? value.relevance
      : null;
    const confidence = typeof value.confidence === "number" ? value.confidence : Number.NaN;
    const rank = typeof value.rank === "number" ? value.rank : Number.MAX_SAFE_INTEGER;

    if (!trackId || !action || !relevance || !Number.isFinite(confidence)) {
      throw new Error("invalid_model_ranking_decision");
    }

    return {
      trackId,
      action,
      relevance,
      confidence,
      rank,
      explanation: typeof value.explanation === "string" ? value.explanation : undefined,
      rejectionReason: typeof value.rejectionReason === "string" ? value.rejectionReason : undefined,
    };
  }

  private systemInstruction(): string {
    return [
      "You rank a bounded list of Resonate catalog candidates for an AI DJ session.",
      "Return only JSON matching the provided schema.",
      "Select only candidates that match the listener taste exactly or semantically.",
      "Reject unrelated candidates even when no better choice exists.",
      "Never invent track IDs; use only IDs from the candidate list.",
      "Prefer listed tracks when taste relevance is comparable.",
      "Use no-match by rejecting every candidate when the catalog does not fit.",
    ].join("\n");
  }

  private userPrompt(input: AgentRecommendationInput, candidates: AgentCandidateTrack[]): string {
    return JSON.stringify({
      preferences: {
        genres: input.preferences.genres ?? [],
        mood: input.preferences.mood ?? null,
        energy: input.preferences.energy ?? null,
        learnedGenreWeights: input.preferences.learnedGenreWeights ?? {},
        allowExplicit: input.preferences.allowExplicit ?? false,
      },
      budgetRemainingUsd: input.budgetRemainingUsd,
      recentTrackIds: input.recentTrackIds,
      targetTrackCount: input.limit,
      candidates: candidates.map((candidate) => ({
        id: candidate.id,
        title: candidate.title ?? null,
        genre: candidate.release?.genre ?? null,
        releaseTitle: candidate.release?.title ?? null,
        hasListing: Boolean(candidate.hasListing),
        deterministicScore: candidate.agentRecommendation?.score ?? 0,
        matchedQueries: candidate.agentRecommendation?.matchedQueries ?? [],
        explanation: candidate.agentRecommendation?.explanation ?? [],
        signals: (candidate.agentRecommendation?.signals ?? []).slice(0, 6).map((signal) => ({
          label: signal.label,
          weight: signal.weight,
          reason: signal.reason,
        })),
        audioFeatures: candidate.agentRecommendation?.audioFeatures
          ? {
            tempoBpm: candidate.agentRecommendation.audioFeatures.tempoBpm,
            energyBand: candidate.agentRecommendation.audioFeatures.energyBand,
            moods: candidate.agentRecommendation.audioFeatures.descriptors.moods,
            confidence: candidate.agentRecommendation.audioFeatures.confidence,
          }
          : null,
      })),
    });
  }

  private limitDeterministic(
    result: AgentRecommendationResult,
    limit: number,
  ): AgentRecommendationResult {
    return {
      ...result,
      selected: result.selected.slice(0, limit),
    };
  }

  private uniqueRejected(rejected: AgentRecommendationResult["rejected"]) {
    const seen = new Set<string>();
    return rejected.filter((candidate) => {
      const key = `${candidate.trackId}:${candidate.reason}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  private modelName(): string {
    return process.env.AGENT_RECOMMENDATION_MODEL?.trim()
      || process.env.VERTEX_AI_MODEL?.trim()
      || "gemini-3-flash-preview";
  }

  private minConfidence(): number {
    const parsed = Number(process.env.AGENT_RECOMMENDATION_MIN_CONFIDENCE);
    if (!Number.isFinite(parsed)) return DEFAULT_MIN_CONFIDENCE;
    return Math.min(1, Math.max(0, parsed));
  }

  private withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`model_ranking_timeout_${ms}ms`)), ms);
      promise
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((error) => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }

  private describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }
}
