import { Module } from "@nestjs/common";
import { AnalyticsModule } from "../analytics/analytics.module";
import { CreditsController } from "./credits.controller";
import { GenerationCreditsService } from "./generation-credits.service";

/**
 * Generation-credit meter (#1334, ADR-BM-3). Exports GenerationCreditsService
 * so the generation and remix modules can debit/refund around their AI
 * generation paths. AnalyticsModule provides AnalyticsIngestService for the
 * metering events.
 */
@Module({
  imports: [AnalyticsModule],
  controllers: [CreditsController],
  providers: [GenerationCreditsService],
  exports: [GenerationCreditsService],
})
export class CreditsModule {}
