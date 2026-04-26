import { Module, forwardRef } from "@nestjs/common";
import { AgentIdentityService } from "./agent_identity.service";
import { AGENT_RUNTIME_CORE_PROVIDERS } from "./agent_runtime.providers";
import { AgentStemQualityService } from "./agent_stem_quality.service";
import { AgentWalletService } from "./agent_wallet.service";
import { AgentPurchaseService } from "./agent_purchase.service";
import { AgentCuratorController } from "./agent_curator.controller";
import { AgentsController } from "./agents.controller";
import { AgentConfigController } from "./agent_config.controller";
import { IdentityModule } from "../identity/identity.module";
import { GenerationModule } from "../generation/generation.module";
import { CatalogModule } from "../catalog/catalog.module";

@Module({
  imports: [forwardRef(() => IdentityModule), GenerationModule, CatalogModule],
  controllers: [AgentsController, AgentConfigController, AgentCuratorController],
  providers: [
    ...AGENT_RUNTIME_CORE_PROVIDERS,
    AgentIdentityService,
    AgentStemQualityService,
    AgentWalletService,
    AgentPurchaseService,
  ],
  exports: [AgentWalletService, AgentPurchaseService, AgentStemQualityService],
})
export class AgentsModule { }
