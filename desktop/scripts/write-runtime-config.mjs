import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const DEFAULT_WEB_URL = "http://localhost:3001";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(__dirname, "..");
const outputPath = path.join(desktopRoot, "generated", "runtime-config.json");

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function parseCsv(value) {
  if (!value) return [];
  return String(value)
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function assertAbsoluteHttpUrl(name, value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute http(s) URL. Received: ${value}`);
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error(`${name} must use http or https. Received: ${value}`);
  }
}

const webUrl = process.env.RESONATE_DESKTOP_WEB_URL || DEFAULT_WEB_URL;
const allowedOrigins = parseCsv(process.env.RESONATE_DESKTOP_ALLOWED_ORIGINS);

assertAbsoluteHttpUrl("RESONATE_DESKTOP_WEB_URL", webUrl);
for (const origin of allowedOrigins) {
  assertAbsoluteHttpUrl("RESONATE_DESKTOP_ALLOWED_ORIGINS entry", origin);
}

const runtimeConfig = {
  webUrl,
  allowedOrigins,
  startWebDevServer: parseBoolean(process.env.RESONATE_DESKTOP_START_WEB, false),
  openDevTools: parseBoolean(process.env.RESONATE_DESKTOP_DEVTOOLS, false),
};

mkdirSync(path.dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(runtimeConfig, null, 2)}\n`);

console.log(`Wrote desktop runtime config for ${webUrl}`);
