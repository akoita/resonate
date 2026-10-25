import { Module } from "@nestjs/common";
import { CreditsController } from "./credits.controller";
import { GenerationAllowanceService } from "./allowance.service";
import { GenerationCreditsService } from "./generation-credits.service";

/**
 * Generation-credit meter (#1334, ADR-BM-3). Exports GenerationCreditsService
 * so the generation and remix modules can debit/refund around their AI
 * generation paths, and GenerationAllowanceService (#2408) for the Artist Pro
 * monthly allowance bucket (granted from the Stripe webhook, reported by
 * Usage & Billing).
 *
 * Deliberately imports NOTHING. The metering events are emitted on the EventBus
 * (provided by the @Global() SharedModule, so it is injectable without an
 * import) and forwarded to analytics by the analytics domain-event bridge. This
 * keeps CreditsModule off both:
 *   - AnalyticsModule — which imports Agents/GenerationModule and would close an
 *     import cycle: generation → credits → analytics → agents → generation;
 *   - SharedModule — which eagerly file-imports GenerationModule, so importing
 *     it here would close another cycle: shared → generation → credits → shared.
 * Either cycle surfaces as a module whose imports array contains `undefined`
 * (see shared_event_bus.spec.ts).
 */
@Module({
  controllers: [CreditsController],
  providers: [GenerationCreditsService, GenerationAllowanceService],
  exports: [GenerationCreditsService, GenerationAllowanceService],
})
export class CreditsModule {}
