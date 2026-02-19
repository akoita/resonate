import { Injectable, Logger } from "@nestjs/common";
import { GenerationService } from "../generation/generation.service";

const COST_PER_GENERATION = 0.06;

export interface AgentMixerInput {
  trackId: string;
  previousTrackId?: string;
  mood?: string;
  energy?: "low" | "medium" | "high";
}

export interface AgentMixerGenerateInput extends AgentMixerInput {
  userId: string;
  generationBudgetRemaining: number;
}

export interface MixPlan {
  trackId: string;
  previousTrackId?: string;
  transition: string;
  notes: string;
}

export interface GenerativeMixPlan extends MixPlan {
  /** Job ID for generated transition audio (if any) */
  transitionJobId?: string;
  /** Job ID for generated fill stem (if any) */
  fillJobId?: string;
  /** Total generation cost for this mix plan */
  generationCostUsd: number;
}

@Injectable()
export class AgentMixerService {
  private readonly logger = new Logger(AgentMixerService.name);

  constructor(private readonly generationService: GenerationService) {}

  /**
   * Metadata-only mix plan — no audio generation.
   * Used as fallback when generation budget is exhausted or not enabled.
   */
  plan(input: AgentMixerInput): MixPlan {
    const transition =
      input.energy === "high"
        ? "hard-cut"
        : input.energy === "low"
        ? "crossfade-long"
        : "crossfade";
    return {
      trackId: input.trackId,
      previousTrackId: input.previousTrackId,
      transition,
      notes: input.mood ? `prioritize ${input.mood} texture` : "neutral",
    };
  }

  /**
   * Generative mix plan — generates transition audio and fill stems via Lyria.
   * Falls back to metadata-only plan if budget is exhausted or generation fails.
   */
  async generate(input: AgentMixerGenerateInput): Promise<GenerativeMixPlan> {
    const basePlan = this.plan(input);
    let generationCostUsd = 0;
    let transitionJobId: string | undefined;
    let fillJobId: string | undefined;

    // Generate transition audio if we have a previous track and budget
    if (input.previousTrackId && input.generationBudgetRemaining >= COST_PER_GENERATION) {
      try {
        const transitionPrompt = this.buildTransitionPrompt(input);
        const result = await this.generationService.createGeneration(
          {
            prompt: transitionPrompt,
            negativePrompt: "silence, noise, distortion",
            artistId: process.env.AGENT_ARTIST_ID ?? "agent",
          },
          input.userId
        );
        transitionJobId = result.jobId;
        generationCostUsd += COST_PER_GENERATION;
        this.logger.log(`Generated transition audio: ${result.jobId}`);
      } catch (err: any) {
        this.logger.warn(`Transition generation failed: ${err.message} — using metadata-only`);
      }
    }

    // Generate fill stem if energy is high and we have budget
    if (
      input.energy === "high" &&
      input.generationBudgetRemaining - generationCostUsd >= COST_PER_GENERATION
    ) {
      try {
        const fillPrompt = `Generate a drum fill transition element in ${input.mood ?? "energetic"} style`;
        const result = await this.generationService.createGeneration(
          {
            prompt: fillPrompt,
            negativePrompt: "vocals, melody",
            artistId: process.env.AGENT_ARTIST_ID ?? "agent",
          },
          input.userId
        );
        fillJobId = result.jobId;
        generationCostUsd += COST_PER_GENERATION;
        this.logger.log(`Generated fill stem: ${result.jobId}`);
      } catch (err: any) {
        this.logger.warn(`Fill generation failed: ${err.message}`);
      }
    }

    return {
      ...basePlan,
      transitionJobId,
      fillJobId,
      generationCostUsd,
    };
  }

  private buildTransitionPrompt(input: AgentMixerGenerateInput): string {
    const energy = input.energy ?? "medium";
    const mood = input.mood ?? "neutral";

    if (energy === "high") {
      return `Generate a high-energy DJ transition bridge with building percussion and ${mood} texture, 4 seconds`;
    } else if (energy === "low") {
      return `Generate a smooth ambient transition with gentle ${mood} pads and reverb tail, 6 seconds`;
    }
    return `Generate a crossfade transition element with ${mood} texture, 4 seconds`;
  }
}
