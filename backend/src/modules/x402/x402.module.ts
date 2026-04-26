import { Module, MiddlewareConsumer, NestModule, RequestMethod } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { X402Config } from './x402.config';
import { X402Controller } from './x402.controller';
import { X402Middleware } from './x402.middleware';
import { X402PaymentService } from './x402.payment.service';
import { X402PublicController } from './x402.public.controller';
import { EncryptionModule } from '../encryption/encryption.module';

/**
 * X402Module — x402 HTTP payment support for stem downloads.
 *
 * Registers:
 *   - X402Config (env var configuration)
 *   - X402Controller (GET /api/stems/:stemId/x402)
 *   - X402Middleware (payment verification on protected routes)
 *   - X402PaymentService (shared challenge/verify/settle helper for HTTP + MCP)
 *
 * Feature-flagged via X402_ENABLED env var.
 */
@Module({
  imports: [ConfigModule, EncryptionModule],
  controllers: [X402Controller, X402PublicController],
  providers: [X402Config, X402PaymentService, X402Middleware],
  exports: [X402Config, X402PaymentService],
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
