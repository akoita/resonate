import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { ConfigModule } from "@nestjs/config";
import { CatalogModule } from "../catalog/catalog.module";
import { GenerationModule } from "../generation/generation.module";
import { SharedModule } from "../shared/shared.module";
import { AGENT_RUNTIME_CORE_PROVIDERS } from "./agent_runtime.providers";
import { AgentRuntimeWorkerController } from "./agent_runtime_worker.controller";

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
    GenerationModule,
  ],
  controllers: [AgentRuntimeWorkerController],
  providers: [...AGENT_RUNTIME_CORE_PROVIDERS],
})
export class AgentWorkerModule {}
