import { ConfigService } from '@nestjs/config';
import { X402Config } from '../modules/x402/x402.config';

function createConfig(overrides: Record<string, string> = {}): X402Config {
  const config = new ConfigService({
    X402_ENABLED: 'false',
    X402_PAYOUT_ADDRESS: '0x1234567890abcdef1234567890abcdef12345678',
    X402_FACILITATOR_URL: 'https://x402.org/facilitator',
    X402_NETWORK: 'eip155:84532',
    ...overrides,
  });
  return new X402Config(config);
}

describe('X402Config', () => {
  it('should default to disabled', () => {
    const cfg = createConfig();
    expect(cfg.enabled).toBe(false);
  });

  it('should enable when X402_ENABLED=true and address is set', () => {
    const cfg = createConfig({ X402_ENABLED: 'true' });
    expect(cfg.enabled).toBe(true);
    expect(cfg.payoutAddress).toBe('0x1234567890abcdef1234567890abcdef12345678');
  });

  it('should throw when enabled without payout address', () => {
    expect(() => {
      createConfig({ X402_ENABLED: 'true', X402_PAYOUT_ADDRESS: '' });
    }).toThrow('X402_PAYOUT_ADDRESS is required');
  });

  it('should use default facilitator URL', () => {
    const cfg = createConfig();
    expect(cfg.facilitatorUrl).toBe('https://x402.org/facilitator');
  });

  it('should allow custom facilitator URL', () => {
    const cfg = createConfig({
      X402_FACILITATOR_URL: 'https://custom.facilitator.example.com',
    });
    expect(cfg.facilitatorUrl).toBe('https://custom.facilitator.example.com');
  });

  it('should default to Base Sepolia network', () => {
    const cfg = createConfig();
    expect(cfg.network).toBe('eip155:84532');
  });

  it('should allow custom network', () => {
    const cfg = createConfig({ X402_NETWORK: 'eip155:8453' });
    expect(cfg.network).toBe('eip155:8453');
  });
});
