import { parseEnvList } from "./env";

const DEFAULT_LOCAL_ORIGINS = [
  "http://localhost:3001",
  "http://localhost:3002",
  "http://localhost:3000",
];

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
    ...parseEnvList(env.CORS_ORIGIN),
    ...parseEnvList(env.CORS_ORIGINS),
    ...parseEnvList(env.FRONTEND_URL),
    ...parseEnvList(env.WEBAUTHN_ORIGIN),
  ];

  return Array.from(
    new Set([...DEFAULT_LOCAL_ORIGINS, ...configuredOrigins].map(normalizeOrigin)),
  );
}
