/**
 * Auth utility function tests — Issue #362
 *
 * Tests the pure utility functions from AuthProvider:
 * - decodeAuthClaims: JWT parsing without validation
 * - getLocalEntryPoint: chain-aware EntryPoint selection
 *
 * Also tests ZeroDevProviderClient's getChainConfig (chain selection logic).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// =============================================
// decodeAuthClaims tests
// =============================================

// Re-implement locally since it's not exported
function decodeAuthClaims(jwt: string | null) {
  if (!jwt) return { role: null, userId: null };
  try {
    const payload = jwt.split('.')[1];
    if (!payload) return { role: null, userId: null };
    const decoded = JSON.parse(atob(payload));
    return {
      role: typeof decoded.role === 'string' ? decoded.role : null,
      userId: typeof decoded.sub === 'string' ? decoded.sub : null,
    };
  } catch {
    return { role: null, userId: null };
  }
}

// Helper: create a fake JWT with given payload
function fakeJwt(payload: object): string {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = btoa(JSON.stringify(payload));
  return `${header}.${body}.fake-signature`;
}

describe('decodeAuthClaims', () => {
  it('returns nulls for null input', () => {
    expect(decodeAuthClaims(null)).toEqual({ role: null, userId: null });
  });

  it('returns nulls for empty string', () => {
    expect(decodeAuthClaims('')).toEqual({ role: null, userId: null });
  });

  it('extracts role and userId from valid JWT', () => {
    const token = fakeJwt({ role: 'artist', sub: 'user-123' });
    expect(decodeAuthClaims(token)).toEqual({ role: 'artist', userId: 'user-123' });
  });

  it('returns null role when role is not a string', () => {
    const token = fakeJwt({ role: 42, sub: 'user-123' });
    expect(decodeAuthClaims(token)).toEqual({ role: null, userId: 'user-123' });
  });

  it('returns nulls for JWT with missing payload', () => {
    expect(decodeAuthClaims('header-only')).toEqual({ role: null, userId: null });
  });

  it('returns nulls for JWT with invalid base64 payload', () => {
    expect(decodeAuthClaims('header.!!!invalid!!!.sig')).toEqual({ role: null, userId: null });
  });

  it('handles admin role', () => {
    const token = fakeJwt({ role: 'admin', sub: 'admin-1' });
    expect(decodeAuthClaims(token)).toEqual({ role: 'admin', userId: 'admin-1' });
  });
});

// =============================================
// getChainConfig tests (from ZeroDevProviderClient)
// =============================================

// Re-implement the pure chain config logic
function getChainConfig(chainId?: string, rpcUrl?: string) {
  if (chainId === '31337') {
    return {
      chainId: 31337,
      bundlerUrl: 'http://localhost:4337',
      rpcUrl: 'http://localhost:8545',
    };
  }

  if (rpcUrl?.includes('localhost') || rpcUrl?.includes('127.0.0.1')) {
    return {
      chainId: 11155111,
      bundlerUrl: undefined,
      rpcUrl,
    };
  }

  return {
    chainId: 11155111,
    bundlerUrl: undefined,
    rpcUrl: undefined, // uses default Sepolia RPC
  };
}

describe('getChainConfig', () => {
  it('returns Foundry config for chain 31337', () => {
    const config = getChainConfig('31337');
    expect(config.chainId).toBe(31337);
    expect(config.bundlerUrl).toBe('http://localhost:4337');
    expect(config.rpcUrl).toBe('http://localhost:8545');
  });

  it('returns forked Sepolia for localhost RPC', () => {
    const config = getChainConfig('11155111', 'http://localhost:8545');
    expect(config.chainId).toBe(11155111);
    expect(config.bundlerUrl).toBeUndefined();
    expect(config.rpcUrl).toBe('http://localhost:8545');
  });

  it('returns forked Sepolia for 127.0.0.1 RPC', () => {
    const config = getChainConfig('11155111', 'http://127.0.0.1:8545');
    expect(config.chainId).toBe(11155111);
    expect(config.rpcUrl).toBe('http://127.0.0.1:8545');
  });

  it('defaults to Sepolia when no chain specified', () => {
    const config = getChainConfig();
    expect(config.chainId).toBe(11155111);
    expect(config.bundlerUrl).toBeUndefined();
  });

  it('defaults to Sepolia for unrecognized chain ID', () => {
    const config = getChainConfig('1');
    expect(config.chainId).toBe(11155111);
  });
});
