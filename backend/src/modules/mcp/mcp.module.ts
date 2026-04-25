import { Module } from "@nestjs/common";
import { CatalogModule } from "../catalog/catalog.module";
import { EncryptionModule } from "../encryption/encryption.module";
import { X402Module } from "../x402/x402.module";
import { AgentObservabilityService } from "../agents/agent_observability.service";
import { McpController } from "./mcp.controller";
import { McpService } from "./mcp.service";
import { McpStemService } from "./mcp-stem.service";

@Module({
  imports: [CatalogModule, EncryptionModule, X402Module],
  controllers: [McpController],
  providers: [McpService, McpStemService, AgentObservabilityService],
})
export class McpModule {}
