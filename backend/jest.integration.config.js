/**
 * Jest configuration for Integration Tests.
 *
 * Uses Testcontainers for self-contained Postgres + Redis.
 * Only Docker is required — no `make dev-up` needed.
 *
 * Run: npm run test:integration
 */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["**/*.integration.spec.ts"],
  moduleFileExtensions: ["ts", "js", "json"],
  rootDir: "src",
  moduleNameMapper: {
    "^@google/adk(.*)$": "<rootDir>/../jest.stubs/google-adk.js",
    "^@google/genai(.*)$": "<rootDir>/../jest.stubs/google-genai.js",
  },
  // Testcontainers lifecycle
  globalSetup: "<rootDir>/tests/globalSetup.js",
  globalTeardown: "<rootDir>/tests/globalTeardown.js",
  setupFiles: ["<rootDir>/tests/testcontainers.setup.ts"],
  // Container startup can be slow on first pull
  testTimeout: 60000,
};
