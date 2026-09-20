import fs from "node:fs";
import path from "node:path";
import { chainName } from "./shows";
import { configuredChainId } from "./seo";

export type LegalDocumentSlug = "terms" | "privacy" | "refunds" | "imprint";

const FILES: Record<LegalDocumentSlug, string> = {
  terms: "terms-of-service.md",
  privacy: "privacy-policy.md",
  refunds: "refund-policy.md",
  imprint: "imprint.md",
};

const REQUIRED_ENV = {
  OPERATOR_LEGAL_NAME: "NEXT_PUBLIC_OPERATOR_LEGAL_NAME",
  OPERATOR_LEGAL_FORM: "NEXT_PUBLIC_OPERATOR_LEGAL_FORM",
  OPERATOR_SHARE_CAPITAL: "NEXT_PUBLIC_OPERATOR_SHARE_CAPITAL",
  OPERATOR_REGISTERED_OFFICE: "NEXT_PUBLIC_OPERATOR_REGISTERED_OFFICE",
  OPERATOR_REGISTRY_ID: "NEXT_PUBLIC_OPERATOR_REGISTRY_ID",
  OPERATOR_CONTACT_EMAIL: "NEXT_PUBLIC_OPERATOR_CONTACT_EMAIL",
  OPERATOR_PUBLICATION_DIRECTOR: "NEXT_PUBLIC_OPERATOR_PUBLICATION_DIRECTOR",
  HOSTING_PROVIDER: "NEXT_PUBLIC_OPERATOR_HOSTING_PROVIDER",
  GOVERNING_LAW: "NEXT_PUBLIC_LEGAL_GOVERNING_LAW",
  JURISDICTION: "NEXT_PUBLIC_LEGAL_JURISDICTION",
  SUPERVISORY_AUTHORITY: "NEXT_PUBLIC_LEGAL_SUPERVISORY_AUTHORITY",
  MINIMUM_AGE: "NEXT_PUBLIC_LEGAL_MINIMUM_AGE",
  EFFECTIVE_DATE: "NEXT_PUBLIC_LEGAL_EFFECTIVE_DATE",
  RESPONSE_WINDOW: "NEXT_PUBLIC_LEGAL_RESPONSE_WINDOW",
} as const;

function legalDirectory(): string {
  const candidates = [
    path.resolve(process.cwd(), "../docs/legal"),
    path.resolve(process.cwd(), "docs/legal"),
  ];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error("Legal templates directory was not found.");
  return found;
}

function acceptedPaymentAssets(env: NodeJS.ProcessEnv, strict: boolean): string {
  const raw = env.NEXT_PUBLIC_PAYMENT_ASSETS_JSON?.trim();
  if (!raw) {
    if (strict) throw new Error("Missing required legal build variable: NEXT_PUBLIC_PAYMENT_ASSETS_JSON");
    return "[accepted payment assets]";
  }
  try {
    const assets = JSON.parse(raw) as Array<{ symbol?: unknown; enabled?: unknown }>;
    const symbols = [...new Set(assets
      .filter((asset) => asset.enabled !== false && typeof asset.symbol === "string")
      .map((asset) => String(asset.symbol).trim())
      .filter(Boolean))];
    if (symbols.length === 0) throw new Error("no enabled asset symbols");
    return symbols.join(", ");
  } catch (error) {
    throw new Error(`Invalid NEXT_PUBLIC_PAYMENT_ASSETS_JSON for legal pages: ${String(error)}`);
  }
}

export function legalTemplateValues(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const values: Record<string, string> = {};
  const missing: string[] = [];
  const strict = env.LEGAL_PUBLISH_MODE === "required";

  for (const [placeholder, variable] of Object.entries(REQUIRED_ENV)) {
    const value = env[variable]?.trim();
    if (!value) {
      missing.push(variable);
      values[placeholder] = `[${placeholder.toLowerCase().replaceAll("_", " ")}]`;
    }
    else values[placeholder] = value;
  }

  if (strict && missing.length > 0) {
    throw new Error(`Missing required legal build variables: ${missing.join(", ")}`);
  }

  values.ACCEPTED_PAYMENT_ASSETS = acceptedPaymentAssets(env, strict);
  values.CHAIN_NAME = chainName(configuredChainId(env.NEXT_PUBLIC_CHAIN_ID));
  values.CREDIT_CURRENCY = "USD cents";
  return values;
}

function stripFrontmatter(markdown: string): string {
  return markdown.replace(/^---\n[\s\S]*?\n---\n/, "");
}

function stripTemplateNotes(markdown: string): string {
  return markdown
    .replace(/\n\*\*Template[\s\S]*?\[README\]\(README\.md\)\.\n\n/, "\n")
    .replace(/\n---\n\n## Questions for legal review[\s\S]*$/, "")
    .trim();
}

function rewriteLinks(markdown: string): string {
  return markdown
    .replaceAll("(terms-of-service.md)", "(/terms)")
    .replaceAll("(privacy-policy.md)", "(/privacy)")
    .replaceAll("(refund-policy.md)", "(/refunds)")
    .replaceAll("(imprint.md)", "(/imprint)");
}

export function renderLegalMarkdown(slug: LegalDocumentSlug, env: NodeJS.ProcessEnv = process.env): string {
  const source = fs.readFileSync(path.join(legalDirectory(), FILES[slug]), "utf8");
  const values = legalTemplateValues(env);
  const resolved = Object.entries(values).reduce(
    (document, [key, value]) => document.replaceAll(`{{${key}}}`, value),
    rewriteLinks(stripTemplateNotes(stripFrontmatter(source))),
  );
  const unresolved = [...resolved.matchAll(/\{\{([A-Z_]+)\}\}/g)].map((match) => match[1]);
  if (unresolved.length > 0) {
    throw new Error(`Unresolved legal placeholders in ${FILES[slug]}: ${[...new Set(unresolved)].join(", ")}`);
  }
  return resolved;
}
