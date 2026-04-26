import { ConfigService } from '@nestjs/config';
import { X402Config } from '../modules/x402/x402.config';
import { X402PublicController } from '../modules/x402/x402.public.controller';

function createController(overrides: Record<string, string> = {}): X402PublicController {
  const config = new ConfigService({
    X402_ENABLED: 'false',
    X402_PAYOUT_ADDRESS: '0x1234567890abcdef1234567890abcdef12345678',
    X402_NETWORK: 'eip155:84532',
    ...overrides,
  });
  return new X402PublicController(new X402Config(config));
}

describe('X402PublicController', () => {
  it('reports enabled=false when x402 is disabled', () => {
    const controller = createController();
    expect(controller.getPublicConfig()).toEqual({ enabled: false });
  });

  it('exposes network, chainId, facilitator, payout, and USDC asset when enabled', () => {
    const controller = createController({
      X402_ENABLED: 'true',
      X402_FACILITATOR_URL: 'https://example.test/facilitator',
    });

    expect(controller.getPublicConfig()).toEqual({
      enabled: true,
      network: 'eip155:84532',
      chainId: 84532,
      facilitatorUrl: 'https://example.test/facilitator',
      payoutAddress: '0x1234567890abcdef1234567890abcdef12345678',
      asset: {
        address: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
        name: 'USDC',
        version: '2',
        decimals: 6,
      },
    });
  });

  it('returns the Base mainnet USDC asset when configured for mainnet', () => {
    const controller = createController({
      X402_ENABLED: 'true',
      X402_NETWORK: 'eip155:8453',
      X402_FACILITATOR_URL: 'https://example.test/facilitator',
    });

    const cfg = controller.getPublicConfig();
    expect(cfg.enabled).toBe(true);
    if (!cfg.enabled) return;
    expect(cfg.chainId).toBe(8453);
    expect(cfg.asset.address).toBe('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');
    expect(cfg.asset.name).toBe('USD Coin');
  });
});
