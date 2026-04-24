import { Module } from "@nestjs/common";
import { CatalogModule } from "../catalog/catalog.module";
import { McpController } from "./mcp.controller";
import { McpService } from "./mcp.service";

@Module({
  imports: [CatalogModule],
  controllers: [McpController],
  providers: [McpService],
})
export class McpModule {}
