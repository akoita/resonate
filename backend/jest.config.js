module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["**/*.spec.ts"],
  moduleFileExtensions: ["ts", "js", "json"],
  rootDir: "src",
  moduleNameMapper: {
    "^@google/adk(.*)$": "<rootDir>/../jest.stubs/google-adk.js",
    "^@google/genai(.*)$": "<rootDir>/../jest.stubs/google-genai.js",
  },
};
