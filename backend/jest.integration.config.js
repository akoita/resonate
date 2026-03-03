/**
 * Jest configuration for Tier 2 Integration Tests.
 *
 * These tests use REAL infrastructure (Postgres, Redis, local storage)
 * started by `make dev-up`. They skip gracefully when infra isn't running.
 *
 * Run: npm run test:integration
 */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["**/*.integration.spec.ts", "**/*.infra.spec.ts"],
  moduleFileExtensions: ["ts", "js", "json"],
  rootDir: "src",
  moduleNameMapper: {
    "^@google/adk(.*)$": "<rootDir>/../jest.stubs/google-adk.js",
    "^@google/genai(.*)$": "<rootDir>/../jest.stubs/google-genai.js",
  },
  // Longer timeout for real DB/network operations
  testTimeout: 30000,
};
