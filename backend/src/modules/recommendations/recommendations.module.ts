import { Module } from "@nestjs/common";
import { CatalogModule } from "../catalog/catalog.module";
import { CommunityModule } from "../community/community.module";
import { SharedModule } from "../shared/shared.module";
import { AgentBigQueryTasteSignalService } from "../agents/agent_bigquery_taste_signal.service";
import { DiscoveryRankingService } from "./discovery-ranking.service";
import { HomeFeedService } from "./home-feed.service";
import { RecommendationsController } from "./recommendations.controller";
import { RecommendationsService } from "./recommendations.service";
import { TasteMemoryService } from "./taste_memory.service";

@Module({
  // CatalogModule provides the WS-4 popularity serving consumed by the
  // Home feed's trending / catalog-signal rails (#1454 WS-7).
  imports: [SharedModule, CommunityModule, CatalogModule],
  controllers: [RecommendationsController],
  providers: [
    RecommendationsService,
    TasteMemoryService,
    // The unified scoring core (#1448 WS-1) shared with the AI DJ.
    DiscoveryRankingService,
    // Env-self-configuring warehouse signal reader so Home inherits the
    // DJ's BigQuery taste signal (consent-gated at call time).
    AgentBigQueryTasteSignalService,
    // Multi-rail Home feed composition (#1454 WS-7).
    HomeFeedService,
  ],
  exports: [RecommendationsService, TasteMemoryService, DiscoveryRankingService],
})
export class RecommendationsModule {}
