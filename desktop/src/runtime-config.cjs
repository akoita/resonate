const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_WEB_URL = "http://localhost:3001";
const GENERATED_CONFIG_RELATIVE_PATH = path.join("generated", "runtime-config.json");

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

function normalizeOrigin(input) {
  try {
    return new URL(input).origin;
  } catch {
    return null;
  }
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function loadPackagedRuntimeConfig() {
  const candidates = [
    path.join(__dirname, "..", GENERATED_CONFIG_RELATIVE_PATH),
    path.join(process.resourcesPath || "", "app", GENERATED_CONFIG_RELATIVE_PATH),
    path.join(process.resourcesPath || "", "app.asar", GENERATED_CONFIG_RELATIVE_PATH),
  ];

  for (const candidate of candidates) {
    const config = readJsonFile(candidate);
    if (config && typeof config === "object") {
      return config;
    }
  }

  return {};
}

function loadDesktopConfig(env = process.env, packagedConfig = loadPackagedRuntimeConfig()) {
  const webUrl = env.RESONATE_DESKTOP_WEB_URL || packagedConfig.webUrl || DEFAULT_WEB_URL;
  const webOrigin = normalizeOrigin(webUrl);
  if (!webOrigin) {
    throw new Error(
      `RESONATE_DESKTOP_WEB_URL must be an absolute http(s) URL. Received: ${webUrl}`,
    );
  }

  const allowedOrigins = new Set([
    webOrigin,
    ...parseCsv(packagedConfig.allowedOrigins).map(normalizeOrigin).filter(Boolean),
    ...parseCsv(env.RESONATE_DESKTOP_ALLOWED_ORIGINS)
      .map(normalizeOrigin)
      .filter(Boolean),
  ]);

  return {
    webUrl,
    webOrigin,
    allowedOrigins,
    startWebDevServer: parseBoolean(
      env.RESONATE_DESKTOP_START_WEB,
      packagedConfig.startWebDevServer ?? true,
    ),
    openDevTools: parseBoolean(
      env.RESONATE_DESKTOP_DEVTOOLS,
      packagedConfig.openDevTools ?? false,
    ),
  };
}

function isAllowedNavigation(targetUrl, config) {
  const origin = normalizeOrigin(targetUrl);
  return !!origin && config.allowedOrigins.has(origin);
}

module.exports = {
  DEFAULT_WEB_URL,
  isAllowedNavigation,
  loadDesktopConfig,
  loadPackagedRuntimeConfig,
};
