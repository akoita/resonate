import { Controller, Get, Req } from "@nestjs/common";
import type { Request } from "express";
import { OpenApiService } from "./openapi.service";

@Controller()
export class OpenApiController {
  constructor(private readonly openApiService: OpenApiService) {}

  @Get("openapi.json")
  async getOpenApiDocument(@Req() req: Request) {
    const origin =
      process.env.PUBLIC_API_URL ||
      `${req.protocol}://${req.get("host")}`;
    return this.openApiService.buildDocument(origin);
  }
}
