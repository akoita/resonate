import { Module } from "@nestjs/common";
import { OpenApiController } from "./openapi.controller";
import { OpenApiService } from "./openapi.service";

@Module({
  controllers: [OpenApiController],
  providers: [OpenApiService],
})
export class OpenApiModule {}
