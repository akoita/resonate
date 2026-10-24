/**
 * Shared helpers for controller e2e tests.
 *
 * Provides a JWT token generator and a standard test module factory
 * that wires up JWT authentication so AuthGuard("jwt") works.
 *
 * Usage:
 *   const app = await createControllerTestApp(CatalogController, [
 *     { provide: CatalogService, useValue: mockService },
 *   ]);
 *   await request(app.getHttpServer())
 *     .get('/catalog/published')
 *     .set('Authorization', `Bearer ${authToken('user-1')}`)
 *     .expect(200);
 */

import { INestApplication, Type } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { JwtStrategy } from '../modules/auth/jwt.strategy';
import { RolesGuard } from '../modules/auth/roles.guard';
import { AdminStepUpGuard } from '../modules/admin_step_up/admin_step_up.guard';
import { AdminStepUpTokenService } from '../modules/admin_step_up/admin_step_up_token.service';
import { ConfigModule } from '@nestjs/config';
import { sign } from 'jsonwebtoken';
import { applyGlobalValidation } from '../config/validation';

export const TEST_JWT_SECRET = 'e2e-test-secret';

/**
 * No-op GenerationCreditsService stub for tests that exercise generation/remix
 * behavior without the #1334 credit meter. `debit`/`refund`/`grant` are no-ops
 * and `costForDurationCents` returns 0, so these tests neither charge nor block.
 * Meter behavior is covered directly by credits.integration.spec.ts and the
 * dedicated block/debit tests.
 */
export function stubGenerationCredits() {
  return {
    costForDurationCents: () => 0,
    getBalance: async () => ({ balanceCents: 0, recentTransactions: [] }),
    grant: async () => 0,
    debit: async () => 0,
    refund: async () => 0,
    refundFailedGenerationJob: async () => undefined,
  };
}

/**
 * Generate a valid JWT token for test requests.
 */
export function authToken(userId: string, role = 'listener'): string {
  return sign({ sub: userId, role }, TEST_JWT_SECRET);
}

/**
 * Create a lightweight NestJS application with:
 *   - The specified controller(s)
 *   - JWT authentication (AuthGuard("jwt") works)
 *   - The global RolesGuard (APP_GUARD), as registered in AppModule, so
 *     @Roles routes are enforced the same way as in production
 *   - The global AdminStepUpGuard (APP_GUARD), so @RequireStepUp() routes
 *     (#2173) need a proof; mint one with `stepUpProof(userId)`
 *   - Any additional providers (mocked services)
 *
 * No database, no Redis, no Docker — fast.
 */
export async function createControllerTestApp(
  controllers: Type<any> | Type<any>[],
  providers: any[] = [],
  options: { rawBody?: boolean } = {},
): Promise<INestApplication> {
  const ctrlArray = Array.isArray(controllers) ? controllers : [controllers];

  const moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        // Override JWT_SECRET so JwtStrategy picks it up
        load: [() => ({ JWT_SECRET: TEST_JWT_SECRET })],
      }),
      PassportModule.register({ defaultStrategy: 'jwt' }),
      JwtModule.register({
        secret: TEST_JWT_SECRET,
        signOptions: { expiresIn: '1h' },
      }),
    ],
    controllers: ctrlArray,
    providers: [
      JwtStrategy,
      { provide: APP_GUARD, useClass: RolesGuard },
      // As AppModule: @RequireStepUp() routes (#2173) are enforced for real.
      { provide: APP_GUARD, useClass: AdminStepUpGuard },
      AdminStepUpTokenService,
      ...providers,
    ],
  }).compile();

  // `rawBody` mirrors main.ts, for routes that verify a signature over the raw request body (#2169).
  const app = moduleRef.createNestApplication(options.rawBody ? { rawBody: true } : undefined);
  // Mirror production bootstrap (main.ts) so DTO validation is exercised.
  applyGlobalValidation(app);
  await app.init();
  return app;
}

/**
 * A valid admin step-up proof (#2173) for `userId`, for the `X-Admin-Step-Up`
 * header of a `@RequireStepUp()` route. Minted by the real token service with
 * the same secret the test app uses, so the guard verifies it for real.
 * Pass `now` in the past to mint an already-stale one.
 */
export function stepUpProof(userId: string, now: number = Date.now()): string {
  const config = { get: (key: string) => (key === 'JWT_SECRET' ? TEST_JWT_SECRET : undefined) };
  return new AdminStepUpTokenService(config as any).issueProof(userId, now).proof;
}

/**
 * Headers for a signed-in `userId` with a fresh step-up proof (#2362), for a
 * `@RequireStepUp()` route.
 */
export function confirmedBearer(userId: string, role: string): Record<string, string> {
  return { Authorization: `Bearer ${authToken(userId, role)}`, 'X-Admin-Step-Up': stepUpProof(userId) };
}

/**
 * Asserts a `@RequireStepUp()` route refuses a request without a proof
 * (`403 step_up_required`), with a stale one (`403 step_up_expired`) and with a
 * proof minted for someone else (`403 step_up_invalid`). The caller asserts the
 * service behind the route was not reached.
 */
export async function expectStepUpRequired(
  app: INestApplication,
  method: 'get' | 'post' | 'patch' | 'put' | 'delete',
  path: string,
  session: { userId: string; role: string },
  body: Record<string, unknown> = {},
): Promise<void> {
  // Loaded here so specs that never call this do not pay for supertest.
  const request = require('supertest');
  const bearer = { Authorization: `Bearer ${authToken(session.userId, session.role)}` };
  const call = (headers: Record<string, string>) =>
    request(app.getHttpServer())[method](path).set({ ...bearer, ...headers }).send(body);

  const missing = await call({});
  expect([missing.status, missing.body.code]).toEqual([403, 'step_up_required']);

  const stale = await call({ 'X-Admin-Step-Up': stepUpProof(session.userId, Date.now() - 60 * 60 * 1000) });
  expect([stale.status, stale.body.code]).toEqual([403, 'step_up_expired']);

  const someoneElses = await call({ 'X-Admin-Step-Up': stepUpProof(`${session.userId}-other`) });
  expect([someoneElses.status, someoneElses.body.code]).toEqual([403, 'step_up_invalid']);
}
