import { Module } from "@nestjs/common";
import { OpenApiController, WellKnownController } from "./openapi.controller";
import { OpenApiService } from "./openapi.service";
import { X402Module } from "../x402/x402.module";

@Module({
  imports: [X402Module],
  controllers: [OpenApiController, WellKnownController],
  providers: [OpenApiService],
})
export class OpenApiModule {}
