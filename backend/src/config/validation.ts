import { INestApplication, ValidationPipe } from "@nestjs/common";

/**
 * Global request validation (#1888, CWE-20).
 *
 * Enforces the class-validator decorators declared on DTO classes used as
 * handler parameters (`@Body() dto: SomeDto`) and rejects violations with a
 * 400. Nothing else changes: there is no `whitelist` and no `transform`, so a
 * body that passes is handed to the handler as the original request object —
 * unknown fields are kept and values are not coerced.
 *
 * Deliberately no validator options: Nest's ValidationPipe returns the original
 * value only while its validator options hold nothing beyond its own
 * `forbidUnknownValues` default. Passing any extra option (even
 * `whitelist: false`) makes it return `classToPlain(entity)` instead, which
 * would reshape every validated body.
 *
 * Bodies typed as interfaces or inline object types reach the pipe as `Object`
 * and are not validated here; those handlers keep validating in their services.
 * Evaluating `whitelist: true` (stripping undeclared fields) is tracked in
 * #1890.
 */
export function createGlobalValidationPipe(): ValidationPipe {
  return new ValidationPipe({ transform: false });
}

export function applyGlobalValidation(app: INestApplication): void {
  app.useGlobalPipes(createGlobalValidationPipe());
}
