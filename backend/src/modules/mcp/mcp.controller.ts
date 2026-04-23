import { Controller, Delete, Get, Post, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { McpService } from "./mcp.service";

@Controller("mcp")
export class McpController {
  constructor(private readonly mcpService: McpService) {}

  @Get()
  getCapabilities(@Req() req: Request, @Res() res: Response) {
    const sessionId = req.headers["mcp-session-id"];
    if (sessionId) {
      return this.mcpService.handleSessionRequest(req, res);
    }

    return res.status(200).json(this.mcpService.getCapabilities());
  }

  @Post()
  handlePost(@Req() req: Request, @Res() res: Response) {
    return this.mcpService.handlePost(req, res);
  }

  @Delete()
  handleDelete(@Req() req: Request, @Res() res: Response) {
    return this.mcpService.handleSessionRequest(req, res);
  }
}
