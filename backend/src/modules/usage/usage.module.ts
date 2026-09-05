import { Module } from "@nestjs/common";
import { CreditsModule } from "../credits/credits.module";
import { GenerationModule } from "../generation/generation.module";
import { RemixModule } from "../remix/remix.module";
import { UsageController } from "./usage.controller";
import { UsageService } from "./usage.service";

/**
 * Usage & Billing aggregation (#1422). A leaf module: nothing imports it, so
 * importing Credits + Generation + Remix to inject their already-exported
 * services adds no cycle. Each dependency exports the service Usage injects
 * (GenerationCreditsService, GenerationService, RemixProjectService); Usage
 * only reads their public getters — it never back-imports into them.
 */
@Module({
  imports: [CreditsModule, GenerationModule, RemixModule],
  controllers: [UsageController],
  providers: [UsageService],
  exports: [UsageService],
})
export class UsageModule {}
