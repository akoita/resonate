import { Module } from "@nestjs/common";
import { CatalogController } from "./catalog.controller";
import { CatalogService } from "./catalog.service";
import { DiscoveryPopularityService } from "./discovery-popularity.service";
import { StreamRenditionService } from "./stream_rendition.service";
import { StreamRenditionAdminController } from "./stream_rendition.controller";
import { EncryptionModule } from "../encryption/encryption.module";
import { RightsModule } from "../rights/rights.module";

@Module({
  imports: [EncryptionModule, RightsModule],
  controllers: [CatalogController, StreamRenditionAdminController],
  providers: [CatalogService, DiscoveryPopularityService, StreamRenditionService],
  exports: [CatalogService, DiscoveryPopularityService, StreamRenditionService],
})
export class CatalogModule { }
