import { Module } from "@nestjs/common";
import { CatalogController } from "./catalog.controller";
import { CatalogService } from "./catalog.service";
import { DiscoveryPopularityService } from "./discovery-popularity.service";
import { EncryptionModule } from "../encryption/encryption.module";
import { RightsModule } from "../rights/rights.module";

@Module({
  imports: [EncryptionModule, RightsModule],
  controllers: [CatalogController],
  providers: [CatalogService, DiscoveryPopularityService],
  exports: [CatalogService, DiscoveryPopularityService],
})
export class CatalogModule { }
