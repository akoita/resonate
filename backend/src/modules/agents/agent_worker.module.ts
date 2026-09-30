import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { ConfigModule } from "@nestjs/config";
import { CatalogModule } from "../catalog/catalog.module";
import { CommunityCohortService } from "../community/community_cohort.service";
import { DiscoveryPolicyContextService } from "../recommendations/discovery-policy-context.service";
import { DiscoveryRankingService } from "../recommendations/discovery-ranking.service";
import { RecommendationsService } from "../recommendations/recommendations.service";
import { TasteMemoryService } from "../recommendations/taste_memory.service";
import { SharedModule } from "../shared/shared.module";
import { AGENT_RUNTIME_CORE_PROVIDERS } from "./agent_runtime.providers";
import { AgentRuntimeWorkerController } from "./agent_runtime_worker.controller";

/**
 * The shared ranking / policy / taste stack that `AgentSelectorService` and
 * `AgentRuntimePolicyService` consume (#1456 WS-9). Provided as classes rather
 * than by importing `RecommendationsModule` / `CommunityModule`: those modules
 * also register HTTP controllers (Home feed, taste memory, community rooms and
 * Discord routes) and providers the worker has no business serving. These
 * classes only need `EventBus` (global `SharedModule`) and Prisma, and start no
 * timers, queues or external connections on init.
 */
const DISCOVERY_POLICY_PROVIDERS = [
  DiscoveryRankingService,
  DiscoveryPolicyContextService,
  TasteMemoryService,
  RecommendationsService,
  CommunityCohortService,
];

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST || "localhost",
        port: parseInt(process.env.REDIS_PORT || "6379"),
      },
    }),
    SharedModule,
    CatalogModule,
  ],
  controllers: [AgentRuntimeWorkerController],
  providers: [...AGENT_RUNTIME_CORE_PROVIDERS, ...DISCOVERY_POLICY_PROVIDERS],
})
export class AgentWorkerModule {}
