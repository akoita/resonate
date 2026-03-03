/**
 * AuthController — E2E Test
 *
 * Tests the HTTP contract:
 *   - Correct routing (POST /auth/login, /auth/nonce, /auth/verify)
 *   - HTTP status codes (201 for POST)
 *   - Response body shape
 */

import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { AuthController } from '../modules/auth/auth.controller';
import { AuthService } from '../modules/auth/auth.service';
import { AuthNonceService } from '../modules/auth/auth_nonce.service';
import { createControllerTestApp } from './e2e-helpers';

const mockAuthService = {
  issueToken: jest.fn().mockReturnValue({ accessToken: 'test-token' }),
  issueTokenForAddress: jest.fn().mockReturnValue({ accessToken: 'test-token-addr' }),
};

const mockNonceService = {
  issue: jest.fn().mockReturnValue('nonce-abc'),
  consume: jest.fn().mockReturnValue(true),
};

const mockPublicClient = {
  getChainId: jest.fn().mockResolvedValue(1),
  verifyMessage: jest.fn().mockResolvedValue(true),
  getCode: jest.fn().mockResolvedValue('0x6080604052'),
};

describe('AuthController (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createControllerTestApp(AuthController, [
      { provide: AuthService, useValue: mockAuthService },
      { provide: AuthNonceService, useValue: mockNonceService },
      { provide: 'PUBLIC_CLIENT', useValue: mockPublicClient },
    ]);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthService.issueToken.mockReturnValue({ accessToken: 'test-token' });
    mockAuthService.issueTokenForAddress.mockReturnValue({ accessToken: 'test-token-addr' });
    mockNonceService.issue.mockReturnValue('nonce-abc');
    mockNonceService.consume.mockReturnValue(true);
    mockPublicClient.getChainId.mockResolvedValue(1);
    mockPublicClient.verifyMessage.mockResolvedValue(true);
    mockPublicClient.getCode.mockResolvedValue('0x6080604052');
  });

  // ----- POST /auth/login -----
  it('POST /auth/login → 201 with accessToken', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ userId: 'user-1' })
      .expect(201);

    expect(res.body.accessToken).toBe('test-token');
  });

  // ----- POST /auth/nonce -----
  it('POST /auth/nonce → 201 with nonce', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/nonce')
      .send({ address: '0xABC' })
      .expect(201);

    expect(res.body.nonce).toBe('nonce-abc');
  });

  // ----- POST /auth/verify -----
  it('POST /auth/verify → 201 with accessToken on success', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/verify')
      .send({
        address: '0xSmartAccount',
        message: 'Sign in\nNonce: nonce-abc',
        signature: '0xdeadbeef',
      })
      .expect(201);

    expect(res.body.accessToken).toBeDefined();
  });

  it('POST /auth/verify → 201 with error status on RPC failure', async () => {
    mockPublicClient.getChainId.mockRejectedValue(new Error('RPC down'));

    const res = await request(app.getHttpServer())
      .post('/auth/verify')
      .send({
        address: '0xSmartAccount',
        message: 'Sign in\nNonce: nonce-abc',
        signature: '0xdeadbeef',
      })
      .expect(201); // controller catches and returns { status: "error" }

    expect(res.body.status).toBe('error');
    expect(res.body.message).toBe('RPC down');
  });
});
