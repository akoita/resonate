import { Module } from "@nestjs/common";
import { RecommendationsModule } from "../recommendations/recommendations.module";
import { DiscoveryJournalController } from "./discovery_journal.controller";
import { DiscoveryJournalService } from "./discovery_journal.service";

/**
 * Sonic Radar discovery journal (ADR-TE-5). Reuses the taste-memory consent
 * reads and the discovery policy lookups exported by RecommendationsModule.
 */
@Module({
  imports: [RecommendationsModule],
  controllers: [DiscoveryJournalController],
  providers: [DiscoveryJournalService],
})
export class DiscoveryJournalModule {}
