import { Module } from "@nestjs/common";
import { CatalogController } from "./catalog.controller";
import { CatalogService } from "./catalog.service";
import { EncryptionModule } from "../encryption/encryption.module";
import { RightsModule } from "../rights/rights.module";
import { PlaylistModule } from "../playlist/playlist.module";

@Module({
  imports: [EncryptionModule, RightsModule, PlaylistModule],
  controllers: [CatalogController],
  providers: [CatalogService],
  exports: [CatalogService],
})
export class CatalogModule { }
