import { Injectable } from "@nestjs/common";

export interface AgentMixerInput {
  trackId: string;
  previousTrackId?: string;
  mood?: string;
  energy?: "low" | "medium" | "high";
}

@Injectable()
export class AgentMixerService {
  plan(input: AgentMixerInput) {
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
