import {
  Body,
  Controller,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import {
  MintAuthorizationResponse,
  MintAuthorizationService,
} from "./mint-authorization.service";

type MintAuthorizationBody = {
  stemId: string;
  chainId: number;
  minterAddress: string;
  to?: string;
  amount?: string | number;
  royaltyReceiver?: string;
  royaltyBps?: number;
  remixable?: boolean;
  parentIds?: Array<string | number>;
};

@Controller("contracts/mint-authorizations")
export class MintAuthorizationController {
  constructor(
    private readonly mintAuthorizationService: MintAuthorizationService,
  ) {}

  @Post()
  @UseGuards(AuthGuard("jwt"))
  async createAuthorization(
    @Body() body: MintAuthorizationBody,
    @Req() req: {
      protocol?: string;
      headers: Record<string, string | string[] | undefined>;
      get(name: string): string | undefined;
      user: { userId: string };
    },
  ): Promise<MintAuthorizationResponse> {
    return this.mintAuthorizationService.createAuthorization(
      req.user.userId,
      body,
      this.getBackendBaseUrl(req),
    );
  }

  @Post("batch")
  @UseGuards(AuthGuard("jwt"))
  async createBatchAuthorizations(
    @Body() body: { authorizations: MintAuthorizationBody[] },
    @Req() req: {
      protocol?: string;
      headers: Record<string, string | string[] | undefined>;
      get(name: string): string | undefined;
      user: { userId: string };
    },
  ): Promise<{ authorizations: MintAuthorizationResponse[] }> {
    return {
      authorizations:
        await this.mintAuthorizationService.createBatchAuthorizations(
          req.user.userId,
          body.authorizations || [],
          this.getBackendBaseUrl(req),
        ),
    };
  }

  private getBackendBaseUrl(req: {
    protocol?: string;
    headers: Record<string, string | string[] | undefined>;
    get(name: string): string | undefined;
  }): string {
    const configured = process.env.BACKEND_URL;
    if (configured) {
      return configured;
    }

    const forwardedProto = req.headers["x-forwarded-proto"];
    const forwardedHost = req.headers["x-forwarded-host"];
    const protocol =
      typeof forwardedProto === "string"
        ? forwardedProto.split(",")[0].trim()
        : req.protocol || "http";
    const host =
      typeof forwardedHost === "string"
        ? forwardedHost.split(",")[0].trim()
        : req.get("host") || "localhost:3000";

    return `${protocol}://${host}`;
  }
}
