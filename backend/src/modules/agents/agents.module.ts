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
import { IdentityModule } from "../identity/identity.module";
import { CatalogModule } from "../catalog/catalog.module";
import { X402Module } from "../x402/x402.module";
import { PaymentsModule } from "../payments/payments.module";
import { SharedModule } from "../shared/shared.module";
import { RecommendationsModule } from "../recommendations/recommendations.module";
import { CommunityModule } from "../community/community.module";
import { EmbeddingsModule } from "../embeddings/embeddings.module";
import { createCrateRequestParser } from "../crates/model_crate_request_parser";
import { AGENT_SESSION_REQUEST_PARSER } from "./agent_session_request";

@Module({
  imports: [
    SharedModule,
    forwardRef(() => IdentityModule),
    CatalogModule,
    X402Module,
    PaymentsModule,
    RecommendationsModule,
    CommunityModule,
    EmbeddingsModule,
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
    // The Crate Digger request parser, built here because CratesModule imports
    // this module. Same CRATE_REQUEST_PARSER_STRATEGY switch as crate requests.
    { provide: AGENT_SESSION_REQUEST_PARSER, useFactory: () => createCrateRequestParser() },
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
