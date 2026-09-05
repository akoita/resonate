import { Injectable } from "@nestjs/common";
import {
  GenerationCreditsService,
  type GenerationCreditBalance,
} from "../credits/generation-credits.service";
import {
  METERED_ACTIONS,
  type MeteredActionKind,
} from "../credits/metered-actions";
import { GenerationService } from "../generation/generation.service";
import { RemixProjectService } from "../remix/remix-project.service";

/** One usage-limit row in the unified summary (#1422). */
export interface UsageLimitSummary {
  kind: MeteredActionKind;
  label: string;
  remaining: number;
  limit: number;
  windowSeconds: number;
  /** ISO timestamp; null when no requests are recorded in the window. */
  resetsAt: string | null;
}

/** Canonical `GET /usage/summary` contract (#1422). The frontend codes to this. */
export interface UsageSummary {
  credits: GenerationCreditBalance;
  limits: UsageLimitSummary[];
  plan: { tier: "free"; monthlyAllowanceCents: number | null };
}

/**
 * Aggregates the two distinct usage concepts (RFC docs/rfc/usage-billing.md):
 *   - credits: a buyable monetary balance (GenerationCreditsService)
 *   - usage limits: per-kind sliding-window rate quotas, read side-effect-free
 *     from the enforcing services' peek getters (never recording a hit here).
 * Plus the (currently Free) plan tier. Reads the metered-action registry for
 * labels/window descriptors so limits stay a single typed source.
 */
@Injectable()
export class UsageService {
  constructor(
    private readonly credits: GenerationCreditsService,
    private readonly generation: GenerationService,
    private readonly remix: RemixProjectService,
  ) {}

  async getSummary(userId: string): Promise<UsageSummary> {
    const credits = await this.credits.getBalance(userId);

    const lyriaStatus = this.generation.getGenerationRateLimitStatus(userId);
    const remixStatus = this.remix.getGenerationRateLimitStatus(userId);

    const limits: UsageLimitSummary[] = [
      {
        kind: "lyria",
        label: METERED_ACTIONS.lyria.label,
        remaining: lyriaStatus.remaining,
        limit: lyriaStatus.limit,
        windowSeconds: Math.round(lyriaStatus.windowMs / 1000),
        resetsAt: lyriaStatus.resetsAt ? lyriaStatus.resetsAt.toISOString() : null,
      },
      {
        kind: "remix_draft",
        label: METERED_ACTIONS.remix_draft.label,
        remaining: remixStatus.remaining,
        limit: remixStatus.limit,
        windowSeconds: Math.round(remixStatus.windowMs / 1000),
        resetsAt: remixStatus.resetsAt ? remixStatus.resetsAt.toISOString() : null,
      },
    ];

    return {
      credits,
      limits,
      // Free tier today; Artist Pro + bundled monthly allowance land later
      // (ADR-BM-3). No live-money plan exists yet, so allowance is null.
      plan: { tier: "free", monthlyAllowanceCents: null },
    };
  }
}
