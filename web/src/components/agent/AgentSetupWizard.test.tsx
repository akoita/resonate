import React from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AgentSetupWizard from "./AgentSetupWizard";

const FORBIDDEN_COPY = [
  /auto-?buy/i,
  /purchase stems/i,
  /spend per month/i,
  /negotiate/i,
  /monthly budget/i,
  /smart wallet/i,
];

describe("AgentSetupWizard", () => {
  it("renders a listening-only intro with no buying copy", () => {
    const html = renderToStaticMarkup(
      <AgentSetupWizard onComplete={async () => {}} onClose={() => {}} />,
    );

    expect(html).toContain("Name Your DJ");
    expect(html).toContain("curate and play tracks for you");
    for (const pattern of FORBIDDEN_COPY) {
      expect(html).not.toMatch(pattern);
    }
  });

  it("has only the naming and vibe steps", () => {
    const html = renderToStaticMarkup(
      <AgentSetupWizard onComplete={async () => {}} onClose={() => {}} />,
    );

    expect(html.match(/agent-wizard-dot /g)?.length).toBe(2);
  });

  it("carries no buying copy in any step (steps render one at a time, so scan the source)", () => {
    const source = readFileSync(join(__dirname, "AgentSetupWizard.tsx"), "utf8");

    for (const pattern of FORBIDDEN_COPY) {
      expect(source).not.toMatch(pattern);
    }
  });
});
