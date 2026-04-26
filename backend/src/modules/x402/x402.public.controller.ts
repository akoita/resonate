import { Controller, Get } from '@nestjs/common';
import { X402Config } from './x402.config';
import { getDefaultX402Asset, type X402AssetInfo } from './x402.public';

export type X402PublicConfig =
  | { enabled: false }
  | {
      enabled: true;
      network: string;
      chainId: number;
      facilitatorUrl: string;
      payoutAddress: string;
      asset: X402AssetInfo;
    };

@Controller('api/x402')
export class X402PublicController {
  constructor(private readonly x402Config: X402Config) {}

  @Get('public-config')
  getPublicConfig(): X402PublicConfig {
    if (!this.x402Config.enabled) {
      return { enabled: false };
    }
    return {
      enabled: true,
      network: this.x402Config.network,
      chainId: this.x402Config.chainId,
      facilitatorUrl: this.x402Config.facilitatorUrl,
      payoutAddress: this.x402Config.payoutAddress,
      asset: getDefaultX402Asset(this.x402Config.network),
    };
  }
}
