import { Module, MiddlewareConsumer, NestModule, RequestMethod } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { X402Config } from './x402.config';
import { X402Controller } from './x402.controller';
import { X402Middleware } from './x402.middleware';
import { EncryptionModule } from '../encryption/encryption.module';

/**
 * X402Module — x402 HTTP payment support for stem downloads.
 *
 * Registers:
 *   - X402Config (env var configuration)
 *   - X402Controller (GET /api/stems/:stemId/x402)
 *   - X402Middleware (payment verification on protected routes)
 *
 * Feature-flagged via X402_ENABLED env var.
 */
@Module({
  imports: [ConfigModule, EncryptionModule],
  controllers: [X402Controller],
  providers: [X402Config],
  exports: [X402Config],
})
export class X402Module implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(X402Middleware)
      .forRoutes(
        { path: 'api/stems/:stemId/x402', method: RequestMethod.GET },
      );
  }
}
