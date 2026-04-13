import { Module } from "@nestjs/common";
import { OpenApiController, WellKnownController } from "./openapi.controller";
import { OpenApiService } from "./openapi.service";

@Module({
  controllers: [OpenApiController, WellKnownController],
  providers: [OpenApiService],
})
export class OpenApiModule {}
