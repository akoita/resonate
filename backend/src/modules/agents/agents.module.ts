import { Module, forwardRef } from "@nestjs/common";
import { AgentIdentityService } from "./agent_identity.service";
import { AgentReputationFeedbackService } from "./agent_reputation_feedback.service";
import { AgentReputationFeedbackController } from "./agent_reputation_feedback.controller";
import { AgentReputationSchedulerService } from "./agent_reputation_scheduler.service";
import { AgentRuntimeService } from "./agent_runtime.service";
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
import { GenerationModule } from "../generation/generation.module";
import { CatalogModule } from "../catalog/catalog.module";
import { X402Module } from "../x402/x402.module";
import { PaymentsModule } from "../payments/payments.module";

@Module({
  imports: [
    forwardRef(() => IdentityModule),
    GenerationModule,
    CatalogModule,
    X402Module,
    PaymentsModule,
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
  ],
  exports: [
    AgentRuntimeService,
    PolicyGuardService,
    PaymentRouterService,
    AgentWalletService,
    AgentPurchaseService,
    AgentStemQualityService,
  ],
})
export class AgentsModule { }
