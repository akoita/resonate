import { ConfigService } from '@nestjs/config';
import { PaymentsService } from '../modules/payments/payments.service';
import { X402Config } from '../modules/x402/x402.config';
import { X402PublicController } from '../modules/x402/x402.public.controller';

const mockEventBus = { publish: jest.fn() };

function createPaymentsService(paymentAssetsJson?: string) {
  return new PaymentsService(
    mockEventBus as any,
    new ConfigService({ PAYMENT_ASSETS_JSON: paymentAssetsJson }),
  );
}

function createController(
  overrides: Record<string, string> = {},
  paymentsService?: PaymentsService,
): X402PublicController {
  const config = new ConfigService({
    X402_ENABLED: 'false',
    X402_PAYOUT_ADDRESS: '0x1234567890abcdef1234567890abcdef12345678',
    X402_NETWORK: 'eip155:84532',
    ...overrides,
  });
  return new X402PublicController(new X402Config(config), paymentsService);
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
      contractSettlementEnabled: false,
      asset: {
        assetId: 'base-sepolia:usdc',
        address: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
        symbol: 'USDC',
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
    expect(cfg.contractSettlementEnabled).toBe(false);
    expect(cfg.chainId).toBe(8453);
    expect(cfg.asset.address).toBe('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');
    expect(cfg.asset.name).toBe('USD Coin');
  });

  it('resolves the USDC asset from shared payment metadata when configured', () => {
    const paymentsService = createPaymentsService(JSON.stringify([
      {
        assetId: 'base-sepolia:usdc',
        chainId: 84532,
        symbol: 'USDC',
        name: 'Circle USDC',
        kind: 'stablecoin',
        tokenAddress: '0x1111111111111111111111111111111111111111',
        decimals: 6,
        enabled: true,
        settlement: ['marketplace', 'x402'],
        pricingStrategy: 'usd_pegged',
      },
      {
        assetId: 'base-sepolia:weth',
        chainId: 84532,
        symbol: 'WETH',
        name: 'Wrapped Ether',
        kind: 'wrapped_native',
        tokenAddress: '0x2222222222222222222222222222222222222222',
        decimals: 18,
        enabled: true,
        settlement: ['marketplace'],
        pricingStrategy: 'chainlink_feed',
      },
    ]));
    const controller = createController({
      X402_ENABLED: 'true',
      X402_FACILITATOR_URL: 'https://example.test/facilitator',
    }, paymentsService);

    const cfg = controller.getPublicConfig();
    expect(cfg.enabled).toBe(true);
    if (!cfg.enabled) return;
    expect(cfg.contractSettlementEnabled).toBe(false);
    expect(cfg.asset).toEqual({
      assetId: 'base-sepolia:usdc',
      address: '0x1111111111111111111111111111111111111111',
      symbol: 'USDC',
      name: 'Circle USDC',
      version: '2',
      decimals: 6,
    });
  });

  it('uses the canonical EIP-712 domain name when shared metadata carries a display name (#1309)', () => {
    // Same token address as the canonical Base Sepolia USDC deployment, but a
    // display name in the registry — the challenge must still advertise the
    // contract's on-chain EIP-712 domain name or no payer can settle.
    const paymentsService = createPaymentsService(JSON.stringify([
      {
        assetId: 'base-sepolia:usdc',
        chainId: 84532,
        symbol: 'USDC',
        name: 'Circle USDC',
        kind: 'stablecoin',
        tokenAddress: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
        decimals: 6,
        enabled: true,
        settlement: ['x402'],
        pricingStrategy: 'usd_pegged',
      },
    ]));
    const controller = createController({
      X402_ENABLED: 'true',
      X402_FACILITATOR_URL: 'https://example.test/facilitator',
    }, paymentsService);

    const cfg = controller.getPublicConfig();
    expect(cfg.enabled).toBe(true);
    if (!cfg.enabled) return;
    expect(cfg.asset.address).toBe('0x036CbD53842c5426634e7929541eC2318f3dCF7e');
    expect(cfg.asset.name).toBe('USDC');
  });

  it('honors an explicit eip712Name for non-canonical tokens (#1309)', () => {
    const paymentsService = createPaymentsService(JSON.stringify([
      {
        assetId: 'base-sepolia:usdc',
        chainId: 84532,
        symbol: 'USDC',
        name: 'Circle USDC',
        eip712Name: 'MockUSDC',
        kind: 'stablecoin',
        tokenAddress: '0x1111111111111111111111111111111111111111',
        decimals: 6,
        enabled: true,
        settlement: ['x402'],
        pricingStrategy: 'usd_pegged',
      },
    ]));
    const controller = createController({
      X402_ENABLED: 'true',
      X402_FACILITATOR_URL: 'https://example.test/facilitator',
    }, paymentsService);

    const cfg = controller.getPublicConfig();
    expect(cfg.enabled).toBe(true);
    if (!cfg.enabled) return;
    expect(cfg.asset.name).toBe('MockUSDC');
  });
});
