import { Module } from "@nestjs/common";
import { CommunityModule } from "../community/community.module";
import { SharedModule } from "../shared/shared.module";
import { AgentBigQueryTasteSignalService } from "../agents/agent_bigquery_taste_signal.service";
import { DiscoveryRankingService } from "./discovery-ranking.service";
import { RecommendationsController } from "./recommendations.controller";
import { RecommendationsService } from "./recommendations.service";
import { TasteMemoryService } from "./taste_memory.service";

@Module({
  imports: [SharedModule, CommunityModule],
  controllers: [RecommendationsController],
  providers: [
    RecommendationsService,
    TasteMemoryService,
    // The unified scoring core (#1448 WS-1) shared with the AI DJ.
    DiscoveryRankingService,
    // Env-self-configuring warehouse signal reader so Home inherits the
    // DJ's BigQuery taste signal (consent-gated at call time).
    AgentBigQueryTasteSignalService,
  ],
  exports: [RecommendationsService, TasteMemoryService, DiscoveryRankingService],
})
export class RecommendationsModule {}
