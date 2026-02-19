// Jest stub for @google/adk — the package's CJS bundle requires ESM-only
// dependencies (p-retry, is-network-error) which Jest cannot parse.
// Tests that need real ADK functionality should use dedicated integration tests.
module.exports = {};
