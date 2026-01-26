import { Module } from "@nestjs/common";
import { EventBus } from "../shared/event_bus";
import { CatalogController } from "./catalog.controller";
import { CatalogService } from "./catalog.service";

@Module({
  controllers: [CatalogController],
  providers: [CatalogService],
})
export class CatalogModule { }
