import { describe, expect, it } from "vitest";
import { legalTemplateValues, renderLegalMarkdown } from "./legalDocuments";

const configuredEnv: NodeJS.ProcessEnv = {
  NODE_ENV: "test",
  LEGAL_PUBLISH_MODE: "required",
  NEXT_PUBLIC_SITE_URL: "https://music.example",
  NEXT_PUBLIC_CHAIN_ID: "84532",
  NEXT_PUBLIC_PAYMENT_ASSETS_JSON: JSON.stringify([{ symbol: "USDC", enabled: true }]),
  NEXT_PUBLIC_OPERATOR_LEGAL_NAME: "Example Music SAS",
  NEXT_PUBLIC_OPERATOR_LEGAL_FORM: "SAS",
  NEXT_PUBLIC_OPERATOR_SHARE_CAPITAL: "1,000 EUR",
  NEXT_PUBLIC_OPERATOR_REGISTERED_OFFICE: "1 Example Street",
  NEXT_PUBLIC_OPERATOR_REGISTRY_ID: "RCS Example 123",
  NEXT_PUBLIC_OPERATOR_CONTACT_EMAIL: "legal@example.test",
  NEXT_PUBLIC_OPERATOR_PUBLICATION_DIRECTOR: "Example Director",
  NEXT_PUBLIC_OPERATOR_HOSTING_PROVIDER: "Example Host, 2 Host Street",
  NEXT_PUBLIC_LEGAL_GOVERNING_LAW: "French law",
  NEXT_PUBLIC_LEGAL_JURISDICTION: "competent French courts",
  NEXT_PUBLIC_LEGAL_SUPERVISORY_AUTHORITY: "CNIL",
  NEXT_PUBLIC_LEGAL_MINIMUM_AGE: "18",
  NEXT_PUBLIC_LEGAL_EFFECTIVE_DATE: "20 September 2026",
  NEXT_PUBLIC_LEGAL_RESPONSE_WINDOW: "14 days",
};

describe("legal documents", () => {
  it("fails closed for a publish build with missing operator configuration", () => {
    expect(() => legalTemplateValues({ NODE_ENV: "test", LEGAL_PUBLISH_MODE: "required" })).toThrow(
      /Missing required legal build variables/,
    );
  });

  it("resolves every placeholder from deployment configuration", () => {
    const markdown = renderLegalMarkdown("imprint", configuredEnv);
    expect(markdown).toContain("Example Music SAS");
    expect(markdown).toContain("Example Host, 2 Host Street");
    expect(markdown).not.toMatch(/\{\{[A-Z_]+\}\}/);
    expect(markdown).not.toContain("Template — not any deployment");
  });

  it("derives public service, chain, asset, and credit values from canonical configuration", () => {
    const values = legalTemplateValues(configuredEnv);
    expect(values).toMatchObject({
      SERVICE_URL: "https://music.example",
      ACCEPTED_PAYMENT_ASSETS: "USDC",
      CHAIN_NAME: "Base Sepolia",
      CREDIT_CURRENCY: "USD cents",
    });
  });
});
