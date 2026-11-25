import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { assertProductionBuild, productionBuildViolations } = require("./productionBuildGuard.cjs") as {
  assertProductionBuild: (env: Record<string, string | undefined>) => void;
  productionBuildViolations: (env: Record<string, string | undefined>) => string[];
};

describe("production build guard (#2660)", () => {
  it("refuses a production build with mock authentication", () => {
    expect(() => assertProductionBuild({ NEXT_PUBLIC_ENV: "production", NEXT_PUBLIC_MOCK_AUTH: "true" })).toThrow(
      /NEXT_PUBLIC_MOCK_AUTH/,
    );
    expect(productionBuildViolations({ NEXT_PUBLIC_ENV: " Prod ", NEXT_PUBLIC_MOCK_AUTH: "TRUE" })).toHaveLength(1);
  });

  it("lets a production build without mock authentication through", () => {
    expect(() => assertProductionBuild({ NEXT_PUBLIC_ENV: "production" })).not.toThrow();
  });

  it("keeps mock authentication for staging, local and test builds", () => {
    for (const label of ["staging", "local", "development", "", undefined]) {
      expect(() => assertProductionBuild({ NEXT_PUBLIC_ENV: label, NEXT_PUBLIC_MOCK_AUTH: "true" })).not.toThrow();
    }
  });
});
