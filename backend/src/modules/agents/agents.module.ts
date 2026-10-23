import { Module, forwardRef } from "@nestjs/common";
import { AgentIdentityService } from "./agent_identity.service";
import { AgentReputationFeedbackService } from "./agent_reputation_feedback.service";
import { AgentReputationFeedbackController } from "./agent_reputation_feedback.controller";
import { AgentReputationSchedulerService } from "./agent_reputation_scheduler.service";
import { AgentRuntimeService } from "./agent_runtime.service";
import { AgentLearningService } from "./agent_learning.service";
import { AGENT_RUNTIME_CORE_PROVIDERS } from "./agent_runtime.providers";
import { AgentStemQualityService } from "./agent_stem_quality.service";
import { AgentWalletService } from "./agent_wallet.service";
import { AgentPurchaseService } from "./agent_purchase.service";
import { PaymentRouterService } from "./payment_router.service";
import { PolicyGuardService } from "./policy_guard.service";
import { AgentCuratorController } from "./agent_curator.controller";
import { AgentsController } from "./agents.controller";
import { AgentConfigController } from "./agent_config.controller";
import { AgentSoundsService } from "./agent_sounds.service";
import { IdentityModule } from "../identity/identity.module";
import { CatalogModule } from "../catalog/catalog.module";
import { X402Module } from "../x402/x402.module";
import { PaymentsModule } from "../payments/payments.module";
import { SharedModule } from "../shared/shared.module";
import { RecommendationsModule } from "../recommendations/recommendations.module";
import { FirstListenerModule } from "../recommendations/first_listener.module";
import { CommunityModule } from "../community/community.module";
import { EmbeddingsModule } from "../embeddings/embeddings.module";
import { AGENT_SESSION_REQUEST_PARSER } from "./agent_session_request";
import { AgentSessionArtistResolver } from "./agent_session_artist_resolver";
import { createAgentSessionRequestParser } from "./agent_session_parser";
import { SceneScoutModule } from "../scene_scout/scene_scout.module";

@Module({
  imports: [
    SharedModule,
    forwardRef(() => IdentityModule),
    CatalogModule,
    X402Module,
    PaymentsModule,
    RecommendationsModule,
    FirstListenerModule,
    CommunityModule,
    EmbeddingsModule,
    SceneScoutModule,
  ],
  controllers: [
    AgentsController,
    AgentConfigController,
    AgentCuratorController,
    AgentReputationFeedbackController,
  ],
  providers: [
    ...AGENT_RUNTIME_CORE_PROVIDERS,
    AgentIdentityService,
    AgentReputationFeedbackService,
    AgentReputationSchedulerService,
    AgentStemQualityService,
    AgentWalletService,
    AgentPurchaseService,
    // One cached catalog aggregate behind the Sounds row (#2249).
    AgentSoundsService,
    // The session sentence parser (#2037, #2241): Crate Digger rules plus catalog
    // artist names, model-assisted only under AGENT_SESSION_PARSER_STRATEGY
    // (default deterministic). Crate requests keep CRATE_REQUEST_PARSER_STRATEGY.
    AgentSessionArtistResolver,
    {
      provide: AGENT_SESSION_REQUEST_PARSER,
      useFactory: (artists: AgentSessionArtistResolver) => createAgentSessionRequestParser(artists),
      inject: [AgentSessionArtistResolver],
    },
  ],
  exports: [
    AgentRuntimeService,
    AgentLearningService,
    PolicyGuardService,
    PaymentRouterService,
    AgentWalletService,
    AgentPurchaseService,
    AgentStemQualityService,
  ],
})
export class AgentsModule { }
