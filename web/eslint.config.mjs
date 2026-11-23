import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // CJS utility scripts (use require() by design)
    "**/*.cjs",
  ]),
  // Text from the catalog, other users and models renders as plain text only:
  // no raw HTML, and no markdown renderer outside the static legal pages.
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "react/no-danger": "error",
      "no-restricted-properties": [
        "error",
        { property: "innerHTML", message: "Render text as React children, not as HTML." },
        { property: "outerHTML", message: "Render text as React children, not as HTML." },
      ],
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "react-markdown", message: "Markdown rendering is limited to components/legal." },
            { name: "marked", message: "Markdown rendering is limited to components/legal." },
            { name: "markdown-it", message: "Markdown rendering is limited to components/legal." },
          ],
        },
      ],
    },
  },
  {
    files: ["src/components/legal/**/*.{ts,tsx}"],
    rules: { "no-restricted-imports": "off" },
  },
]);

export default eslintConfig;
