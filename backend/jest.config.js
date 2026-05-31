module.exports = {
  testEnvironment: "node",
  testMatch: ["**/*.spec.ts"],
  testPathIgnorePatterns: ["\\.integration\\.spec\\.ts$"],
  transform: {
    "^.+\\.ts$": ["ts-jest", { tsconfig: { isolatedModules: true }, diagnostics: false }],
  },
  moduleFileExtensions: ["ts", "js", "json"],
  rootDir: "src",
  moduleNameMapper: {
    "^@google/adk(.*)$": "<rootDir>/../jest.stubs/google-adk.js",
    "^@google/genai(.*)$": "<rootDir>/../jest.stubs/google-genai.js",
  },
};
