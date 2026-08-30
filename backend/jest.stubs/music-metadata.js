// Jest 29 cannot load music-metadata v11's ESM-only module-sync export.
// Ingestion unit tests exercise the invalid-audio fallback; a separate runtime
// smoke test loads the real package in Node and verifies the APIs we consume.
const unsupportedFixture = async () => {
  throw new Error("Jest music-metadata stub received an unsupported audio fixture");
};

module.exports = {
  parseBuffer: unsupportedFixture,
  parseFile: unsupportedFixture,
};
