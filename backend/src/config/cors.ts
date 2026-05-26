const DEFAULT_LOCAL_ORIGINS = [
  "http://localhost:3001",
  "http://localhost:3002",
  "http://localhost:3000",
];

function splitEnvList(value: string | undefined) {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeOrigin(value: string) {
  if (value === "*") return value;

  try {
    const url = new URL(value);
    return url.origin;
  } catch {
    return value.replace(/\/+$/, "");
  }
}

export function getCorsAllowedOrigins(env: NodeJS.ProcessEnv = process.env) {
  const configuredOrigins = [
    ...splitEnvList(env.CORS_ORIGIN),
    ...splitEnvList(env.CORS_ORIGINS),
    ...splitEnvList(env.FRONTEND_URL),
    ...splitEnvList(env.WEBAUTHN_ORIGIN),
  ];

  return Array.from(
    new Set([...DEFAULT_LOCAL_ORIGINS, ...configuredOrigins].map(normalizeOrigin)),
  );
}
