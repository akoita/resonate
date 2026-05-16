const DEFAULT_WEB_URL = "http://localhost:3001";

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

function loadDesktopConfig(env = process.env) {
  const webUrl = env.RESONATE_DESKTOP_WEB_URL || DEFAULT_WEB_URL;
  const webOrigin = normalizeOrigin(webUrl);
  if (!webOrigin) {
    throw new Error(
      `RESONATE_DESKTOP_WEB_URL must be an absolute http(s) URL. Received: ${webUrl}`,
    );
  }

  const allowedOrigins = new Set([
    webOrigin,
    ...parseCsv(env.RESONATE_DESKTOP_ALLOWED_ORIGINS)
      .map(normalizeOrigin)
      .filter(Boolean),
  ]);

  return {
    webUrl,
    webOrigin,
    allowedOrigins,
    startWebDevServer: parseBoolean(env.RESONATE_DESKTOP_START_WEB, true),
    openDevTools: parseBoolean(env.RESONATE_DESKTOP_DEVTOOLS, false),
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
};
