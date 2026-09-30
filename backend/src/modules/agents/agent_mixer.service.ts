import { Injectable } from "@nestjs/common";

export interface AgentMixerInput {
  trackId: string;
  previousTrackId?: string;
  mood?: string;
  energy?: "low" | "medium" | "high";
}

export interface MixPlan {
  trackId: string;
  previousTrackId?: string;
  transition: string;
  notes: string;
}

@Injectable()
export class AgentMixerService {
  /**
   * Metadata-only mix plan. Agents never generate audio (ADR-TE-4), so the
   * mixer only chooses a transition style between catalog tracks.
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
}
