import { Module } from "@nestjs/common";
import { EventBus } from "../shared/event_bus";
import { CatalogController } from "./catalog.controller";
import { CatalogService } from "./catalog.service";
import { EncryptionModule } from "../encryption/encryption.module";

@Module({
  imports: [EncryptionModule],
  controllers: [CatalogController],
  providers: [CatalogService],
  exports: [CatalogService],
})
export class CatalogModule { }
