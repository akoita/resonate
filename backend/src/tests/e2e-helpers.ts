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
import { Test } from '@nestjs/testing';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { JwtStrategy } from '../modules/auth/jwt.strategy';
import { ConfigModule } from '@nestjs/config';
import { sign } from 'jsonwebtoken';

export const TEST_JWT_SECRET = 'e2e-test-secret';

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
 *   - Any additional providers (mocked services)
 *
 * No database, no Redis, no Docker — fast.
 */
export async function createControllerTestApp(
  controllers: Type<any> | Type<any>[],
  providers: any[] = [],
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
    providers: [JwtStrategy, ...providers],
  }).compile();

  const app = moduleRef.createNestApplication();
  await app.init();
  return app;
}
